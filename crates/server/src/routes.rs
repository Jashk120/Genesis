use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use domain::{
    block,
    export::{
        diff_to_html, diff_to_markdown, envelope_page_to_html, envelope_page_to_markdown,
        envelope_to_html, envelope_to_markdown, escape_html, ExportFormat,
    },
    version_diff::diff_envelopes,
    BlockNode, Page, PageKind, Snapshot, SnapshotEnvelope, SnapshotMeta, VersionDiff, Workspace,
};
use store::{BlockRepository, PageRepository, SnapshotRepository, WorkspaceRepository};

use crate::export::{
    attachment_response, cluster_entry_paths, concat_flat_bundle, sanitize_filename,
    too_large_response, zip_bytes, ExportDoc, ZipError, BUNDLE_FLAT_MAX, MAX_DOC_BYTES,
};

#[derive(Clone)]
pub struct AppState {
    pub pool: Option<PgPool>,
}

fn db_required(state: &AppState) -> Result<&PgPool, (StatusCode, Json<Value>)> {
    state.pool.as_ref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"error": "database unavailable"})),
    ))
}

fn store_err(e: store::StoreError) -> (StatusCode, Json<Value>) {
    match e {
        store::StoreError::NotFound(msg) => (StatusCode::NOT_FOUND, Json(json!({"error": msg}))),
        store::StoreError::Domain(e) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": e.to_string()})),
        ),
        store::StoreError::Conflict(msg) => (StatusCode::CONFLICT, Json(json!({"error": msg}))),

        store::StoreError::NoChange(_) => {
            (StatusCode::CONFLICT, Json(json!({"error": "no_change"})))
        }
        store::StoreError::Sqlx(ref db_err) if is_restrict_violation(db_err) => (
            StatusCode::CONFLICT,
            Json(json!({"error": "page has snapshots; pass ?with_history=true to delete history"})),
        ),
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": other.to_string()})),
        ),
    }
}

fn is_restrict_violation(e: &sqlx::Error) -> bool {
    e.as_database_error().and_then(|db| db.code()).as_deref() == Some("23001")
}

/// The synthetic `page` root has no stored block row, so it has no natural
/// durable id. Give it the page id: stable across reloads, and distinct from
/// every real content block id.
fn with_root_block_id(mut tree: BlockNode, page_id: Uuid) -> BlockNode {
    if let Some(map) = tree.data.as_object_mut() {
        map.insert("blockId".to_string(), Value::String(page_id.to_string()));
    }
    tree
}

pub async fn health() -> impl IntoResponse {
    (StatusCode::OK, Json(json!({"status": "ok"})))
}

pub async fn list_workspaces(
    State(state): State<AppState>,
) -> Result<Json<Vec<Workspace>>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    WorkspaceRepository::new(pool)
        .list()
        .await
        .map(Json)
        .map_err(store_err)
}

#[derive(Debug, Deserialize)]
pub struct CreateWorkspace {
    pub title: String,
}

pub async fn create_workspace(
    State(state): State<AppState>,
    Json(body): Json<CreateWorkspace>,
) -> Result<(StatusCode, Json<Workspace>), (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    WorkspaceRepository::new(pool)
        .create(&body.title)
        .await
        .map(|w| (StatusCode::CREATED, Json(w)))
        .map_err(store_err)
}

#[derive(Debug, Deserialize)]
pub struct PageListQuery {
    pub workspace_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
}

pub async fn list_pages(
    State(state): State<AppState>,
    Query(q): Query<PageListQuery>,
) -> Result<Json<Vec<Page>>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let workspace_id = q.workspace_id.ok_or((
        StatusCode::BAD_REQUEST,
        Json(json!({"error": "workspace_id is required"})),
    ))?;
    // parent_id present-but-empty is not expressible in query strings;
    // None here means "all pages in workspace".
    let parent_filter = q.parent_id.map(Some);
    PageRepository::new(pool)
        .list(workspace_id, parent_filter)
        .await
        .map(Json)
        .map_err(store_err)
}

#[derive(Debug, Deserialize)]
pub struct CreatePage {
    pub workspace_id: Uuid,
    pub parent_page_id: Option<Uuid>,
    pub kind: String,
    pub title: Option<String>,
    pub ordinal: Option<i32>,
    pub narrative_order: Option<i32>,
}

pub async fn create_page(
    State(state): State<AppState>,
    Json(body): Json<CreatePage>,
) -> Result<(StatusCode, Json<Page>), (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let kind = PageKind::parse(&body.kind).ok_or((
        StatusCode::BAD_REQUEST,
        Json(json!({"error": "kind must be folder|story|version|chapter|note"})),
    ))?;
    let mut page = Page::new(
        body.workspace_id,
        body.parent_page_id,
        kind,
        body.title.unwrap_or_default(),
    );
    if let Some(o) = body.ordinal {
        page.ordinal = o;
    }
    page.narrative_order = body.narrative_order;
    PageRepository::new(pool)
        .create(&page)
        .await
        .map(|p| (StatusCode::CREATED, Json(p)))
        .map_err(store_err)
}

fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(deserializer)?))
}

#[derive(Debug, Deserialize)]
pub struct PatchPage {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub parent_page_id: Option<Option<Uuid>>,
    pub ordinal: Option<i32>,
    #[serde(default, deserialize_with = "double_option")]
    pub narrative_order: Option<Option<i32>>,
}

pub async fn get_page(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Page>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    PageRepository::new(pool)
        .get(id)
        .await
        .map(Json)
        .map_err(store_err)
}

pub async fn patch_page(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchPage>,
) -> Result<Json<Page>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    PageRepository::new(pool)
        .patch(
            id,
            body.title.as_deref(),
            body.parent_page_id,
            body.ordinal,
            body.narrative_order,
        )
        .await
        .map(Json)
        .map_err(store_err)
}

pub async fn delete_page(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<DeletePageQuery>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let count = SnapshotRepository::new(pool)
        .count_for_page(id)
        .await
        .map_err(store_err)?;
    if count > 0 && !q.with_history.unwrap_or(false) {
        return Err(store_err(store::StoreError::Conflict(
            "page has snapshots; pass ?with_history=true to delete history".to_string(),
        )));
    }
    if q.with_history.unwrap_or(false) {
        PageRepository::new(pool)
            .delete_with_history(id)
            .await
            .map(|()| StatusCode::NO_CONTENT)
            .map_err(store_err)
    } else {
        PageRepository::new(pool)
            .delete(id)
            .await
            .map(|()| StatusCode::NO_CONTENT)
            .map_err(store_err)
    }
}

#[derive(Debug, Deserialize)]
pub struct DeletePageQuery {
    pub with_history: Option<bool>,
}

pub async fn get_blocks(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<BlockNode>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    PageRepository::new(pool).get(id).await.map_err(store_err)?;
    let rows = BlockRepository::new(pool)
        .list_for_page(id)
        .await
        .map_err(store_err)?;
    Ok(Json(with_root_block_id(block::assemble_tree(&rows), id)))
}

pub async fn put_blocks(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(tree): Json<BlockNode>,
) -> Result<Json<BlockNode>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    PageRepository::new(pool).get(id).await.map_err(store_err)?;
    let flat = block::flatten_tree(id, &tree).map_err(|e| {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    BlockRepository::new(pool)
        .replace_for_page(id, &flat)
        .await
        .map_err(store_err)?;
    let rows = BlockRepository::new(pool)
        .list_for_page(id)
        .await
        .map_err(store_err)?;
    Ok(Json(with_root_block_id(block::assemble_tree(&rows), id)))
}

#[derive(Debug, Deserialize)]
pub struct CreateSnapshot {
    pub label: String,
}

pub async fn create_snapshot(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<CreateSnapshot>,
) -> Result<(StatusCode, Json<SnapshotMeta>), (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    SnapshotRepository::new(pool)
        .create(id, &body.label)
        .await
        .map(|m| (StatusCode::CREATED, Json(m)))
        .map_err(store_err)
}

pub async fn list_snapshots(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<SnapshotMeta>>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    PageRepository::new(pool).get(id).await.map_err(store_err)?;
    SnapshotRepository::new(pool)
        .list_meta_for_page(id)
        .await
        .map(Json)
        .map_err(store_err)
}

pub async fn get_snapshot(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Snapshot>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    SnapshotRepository::new(pool)
        .get(id)
        .await
        .map(Json)
        .map_err(store_err)
}

fn bad_request(msg: &str) -> (StatusCode, Json<Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({"error": msg})))
}

fn parse_format(raw: &Option<String>) -> Result<ExportFormat, (StatusCode, Json<Value>)> {
    match raw.as_deref() {
        None => Ok(ExportFormat::Markdown),
        Some(s) => ExportFormat::parse(s).ok_or_else(|| bad_request("format must be md|html")),
    }
}

fn parse_envelope(content: &Value) -> Result<SnapshotEnvelope, (StatusCode, Json<Value>)> {
    serde_json::from_value::<SnapshotEnvelope>(content.clone()).map_err(|e| {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": e.to_string()})),
        )
    })
}

fn render_envelope(fmt: ExportFormat, envelope: &SnapshotEnvelope) -> String {
    match fmt {
        ExportFormat::Markdown => envelope_to_markdown(envelope),
        ExportFormat::Html => envelope_to_html(envelope),
    }
}

fn render_envelope_page(fmt: ExportFormat, envelope: &SnapshotEnvelope, page_id: Uuid) -> String {
    match fmt {
        ExportFormat::Markdown => envelope_page_to_markdown(envelope, page_id),
        ExportFormat::Html => envelope_page_to_html(envelope, page_id),
    }
}

fn root_title(envelope: &SnapshotEnvelope) -> &str {
    envelope
        .pages
        .iter()
        .find(|p| p.id == envelope.root_page_id)
        .map(|p| p.title.as_str())
        .unwrap_or("export")
}

pub async fn restore_snapshot(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let snap = SnapshotRepository::new(pool)
        .get(id)
        .await
        .map_err(store_err)?;
    let envelope = parse_envelope(&snap.content)?;
    let restored = SnapshotRepository::new(pool)
        .restore_into_live(&envelope)
        .await
        .map_err(store_err)?;
    if restored == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "snapshot has no restorable pages"})),
        ));
    }
    Ok(Json(json!({"restored": restored})))
}

#[derive(Debug, Deserialize)]
pub struct FormatQuery {
    pub format: Option<String>,
}

pub async fn export_page(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<FormatQuery>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let fmt = parse_format(&q.format)?;
    let envelope = SnapshotRepository::new(pool)
        .build_envelope(id)
        .await
        .map_err(store_err)?;
    let rendered = render_envelope(fmt, &envelope);
    if rendered.len() > MAX_DOC_BYTES {
        return Ok(too_large_response());
    }
    let filename = format!(
        "{}.{}",
        sanitize_filename(root_title(&envelope)),
        fmt.extension()
    );
    Ok(attachment_response(
        &filename,
        fmt.content_type(),
        rendered.into_bytes(),
    ))
}

pub async fn export_snapshot(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<FormatQuery>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let fmt = parse_format(&q.format)?;
    let snap = SnapshotRepository::new(pool)
        .get(id)
        .await
        .map_err(store_err)?;
    let envelope = parse_envelope(&snap.content)?;
    let rendered = render_envelope(fmt, &envelope);
    if rendered.len() > MAX_DOC_BYTES {
        return Ok(too_large_response());
    }
    let filename = format!("{}.{}", sanitize_filename(&snap.label), fmt.extension());
    Ok(attachment_response(
        &filename,
        fmt.content_type(),
        rendered.into_bytes(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct DiffQuery {
    pub from: Option<Uuid>,
    pub to: Option<Uuid>,
    pub limit: Option<usize>,
    pub cursor: Option<usize>,
}

async fn load_diff_pair(
    pool: &PgPool,
    q_from: Option<Uuid>,
    q_to: Option<Uuid>,
    limit: Option<usize>,
    cursor: Option<usize>,
) -> Result<(domain::Snapshot, domain::Snapshot, VersionDiff), (StatusCode, Json<Value>)> {
    let from_id = q_from.ok_or_else(|| bad_request("from is required"))?;
    let to_id = q_to.ok_or_else(|| bad_request("to is required"))?;
    let repo = SnapshotRepository::new(pool);
    let from_snap = repo.get(from_id).await.map_err(store_err)?;
    let to_snap = repo.get(to_id).await.map_err(store_err)?;
    let from_env = parse_envelope(&from_snap.content)?;
    let to_env = parse_envelope(&to_snap.content)?;
    let lim = match limit {
        Some(0) | None => None,
        Some(n) => Some(n),
    };
    let diff = diff_envelopes(&from_env, &to_env, lim, Some(cursor.unwrap_or(0)));
    Ok((from_snap, to_snap, diff))
}

pub async fn diff_snapshots(
    State(state): State<AppState>,
    Query(q): Query<DiffQuery>,
) -> Result<Json<VersionDiff>, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let (_, _, diff) = load_diff_pair(pool, q.from, q.to, q.limit, q.cursor).await?;
    Ok(Json(diff))
}

#[derive(Debug, Deserialize)]
pub struct DiffExportQuery {
    pub from: Option<Uuid>,
    pub to: Option<Uuid>,
    pub format: Option<String>,
}

pub async fn export_diff(
    State(state): State<AppState>,
    Query(q): Query<DiffExportQuery>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let fmt = parse_format(&q.format)?;
    let (from_snap, to_snap, diff) = load_diff_pair(pool, q.from, q.to, Some(10_000), None).await?;
    let rendered = match fmt {
        ExportFormat::Markdown => diff_to_markdown(&diff, &from_snap.label, &to_snap.label),
        ExportFormat::Html => diff_to_html(&diff, &from_snap.label, &to_snap.label),
    };
    if rendered.len() > MAX_DOC_BYTES {
        return Ok(too_large_response());
    }
    let filename = format!("diff-{}-{}.{}", from_snap.seq, to_snap.seq, fmt.extension());
    Ok(attachment_response(
        &filename,
        fmt.content_type(),
        rendered.into_bytes(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct HistoryBundleQuery {
    pub format: Option<String>,
    pub versions: Option<String>,
}

pub async fn history_bundle(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<HistoryBundleQuery>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let fmt = parse_format(&q.format)?;
    let page = PageRepository::new(pool).get(id).await.map_err(store_err)?;
    let metas = SnapshotRepository::new(pool)
        .list_meta_for_page(id)
        .await
        .map_err(store_err)?;
    let selected: Vec<SnapshotMeta> = match &q.versions {
        Some(raw) => {
            let mut wanted = std::collections::HashSet::new();
            for part in raw.split(',') {
                let part = part.trim();
                if part.is_empty() {
                    continue;
                }
                let uid: Uuid = part
                    .parse()
                    .map_err(|_| bad_request("versions must be comma-separated snapshot ids"))?;
                wanted.insert(uid);
            }
            if wanted.is_empty() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "no matching versions"})),
                ));
            }
            let filtered: Vec<SnapshotMeta> = metas
                .into_iter()
                .filter(|m| wanted.contains(&m.id))
                .collect();
            if filtered.is_empty() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "no matching versions"})),
                ));
            }
            filtered
        }
        None => metas,
    };
    let repo = SnapshotRepository::new(pool);
    let mut docs: Vec<ExportDoc> = Vec::with_capacity(selected.len());
    let mut manifest: Vec<Value> = Vec::with_capacity(selected.len());
    for meta in &selected {
        let snap = repo.get(meta.id).await.map_err(store_err)?;
        let envelope = parse_envelope(&snap.content)?;
        let rendered = render_envelope(fmt, &envelope);
        if rendered.len() > MAX_DOC_BYTES {
            return Ok(too_large_response());
        }
        let date = snap.created_at.format("%Y-%m-%d").to_string();
        let heading = match fmt {
            ExportFormat::Markdown => format!("## V-{} · {} · {date}", snap.seq, snap.label),
            ExportFormat::Html => format!(
                "<h2>V-{} · {} · {date}</h2>",
                snap.seq,
                escape_html(&snap.label)
            ),
        };
        docs.push(ExportDoc {
            entry_path: format!("v-{}.{}", snap.seq, fmt.extension()),
            heading: Some(heading),
            content: rendered,
        });
        manifest.push(json!({
            "label": snap.label,
            "seq": snap.seq,
            "content_hash": snap.content_hash,
            "created_at": snap.created_at.to_rfc3339(),
            "byte_size": snap.byte_size,
        }));
    }
    let stem = sanitize_filename(&page.title);
    if docs.len() >= BUNDLE_FLAT_MAX {
        let mut entries: Vec<(String, String)> = docs
            .into_iter()
            .map(|d| (d.entry_path, d.content))
            .collect();
        let manifest_str =
            serde_json::to_string_pretty(&manifest).unwrap_or_else(|_| "[]".to_string());
        entries.push(("manifest.json".to_string(), manifest_str));
        match zip_bytes(&entries) {
            Ok(bytes) => Ok(attachment_response(
                &format!("{stem}-history.zip"),
                "application/zip",
                bytes,
            )),
            Err(ZipError::TooLarge) => Ok(too_large_response()),
            Err(ZipError::Io(msg)) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": msg})),
            )),
        }
    } else {
        let flat = concat_flat_bundle(fmt, &docs);
        if flat.len() > MAX_DOC_BYTES {
            return Ok(too_large_response());
        }
        Ok(attachment_response(
            &format!("{stem}-history.{}", fmt.extension()),
            fmt.content_type(),
            flat.into_bytes(),
        ))
    }
}

#[derive(Debug, Deserialize)]
pub struct ClusterExportQuery {
    pub format: Option<String>,
}

pub async fn cluster_export(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<ClusterExportQuery>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    let fmt = parse_format(&q.format)?;
    let envelope = SnapshotRepository::new(pool)
        .build_envelope(id)
        .await
        .map_err(store_err)?;
    let paths = cluster_entry_paths(&envelope, fmt);
    let mut entries: Vec<(String, String)> = Vec::with_capacity(paths.len());
    for (page_id, entry_path) in paths {
        entries.push((entry_path, render_envelope_page(fmt, &envelope, page_id)));
    }
    let stem = sanitize_filename(root_title(&envelope));
    match zip_bytes(&entries) {
        Ok(bytes) => Ok(attachment_response(
            &format!("{stem}-cluster.zip"),
            "application/zip",
            bytes,
        )),
        Err(ZipError::TooLarge) => Ok(too_large_response()),
        Err(ZipError::Io(msg)) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": msg})),
        )),
    }
}
