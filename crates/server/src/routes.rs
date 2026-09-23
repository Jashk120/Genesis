use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use domain::{block, BlockNode, Page, PageKind, Workspace};
use store::{BlockRepository, PageRepository, WorkspaceRepository};

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
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": other.to_string()})),
        ),
    }
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
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let pool = db_required(&state)?;
    PageRepository::new(pool)
        .delete(id)
        .await
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(store_err)
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
