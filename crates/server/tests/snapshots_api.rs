use axum::{
    body::Body,
    http::{HeaderMap, Request, StatusCode},
    Router,
};
use domain::FlatBlock;
use server::{app::build_router, config::Config, routes::AppState};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

fn db_url() -> Option<String> {
    std::env::var("TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .ok()
}

fn test_config() -> Config {
    Config {
        database_url: String::new(),
        bind_addr: "127.0.0.1:0".parse().expect("loopback parses"),
        client_dist: "/tmp/genesis-test-no-dist".to_string(),
    }
}

fn router_with(pool: &PgPool) -> Router {
    build_router(
        AppState {
            pool: Some(pool.clone()),
        },
        &test_config(),
    )
}

async fn req(
    router: Router,
    method: &str,
    uri: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let builder = Request::builder().method(method).uri(uri);
    let req = match body {
        Some(v) => builder
            .header("content-type", "application/json")
            .body(Body::from(v.to_string()))
            .expect("request builds"),
        None => builder.body(Body::empty()).expect("request builds"),
    };
    let res = router.oneshot(req).await.expect("service responds");
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .expect("body reads")
        .to_vec();
    (status, headers, bytes)
}

fn json_of(bytes: &[u8]) -> serde_json::Value {
    serde_json::from_slice(bytes).expect("response is json")
}

async fn setup_story(pool: &PgPool, title: &str) -> (Uuid, Uuid, Uuid) {
    let ws_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspace (id, title) VALUES ($1, 'snapshots-api-test')")
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("workspace inserts");
    let story_id = Uuid::new_v4();
    sqlx::query("INSERT INTO page (id, workspace_id, kind, title) VALUES ($1,$2,'story',$3)")
        .bind(story_id)
        .bind(ws_id)
        .bind(title)
        .execute(pool)
        .await
        .expect("story inserts");
    let block_id = Uuid::new_v4();
    set_text(pool, story_id, block_id, "alpha beginning").await;
    (ws_id, story_id, block_id)
}

async fn setup_story_with_chapter(pool: &PgPool) -> (Uuid, Uuid, Uuid) {
    let (ws_id, story_id, _) = setup_story(pool, "Novel").await;
    let chapter_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO page (id, workspace_id, parent_page_id, kind, title) VALUES ($1,$2,$3,'chapter','Ch1')",
    )
    .bind(chapter_id)
    .bind(ws_id)
    .bind(story_id)
    .execute(pool)
    .await
    .expect("chapter inserts");
    set_text(pool, chapter_id, Uuid::new_v4(), "chapter one body").await;
    (ws_id, story_id, chapter_id)
}

async fn set_text(pool: &PgPool, page_id: Uuid, block_id: Uuid, text: &str) {
    let flat = vec![FlatBlock {
        id: block_id,
        parent_block_id: None,
        block_type: "paragraph".to_string(),
        data: serde_json::json!({"delta": [{"insert": text}]}),
        ordinal: 0,
    }];
    store::BlockRepository::new(pool)
        .replace_for_page(page_id, &flat)
        .await
        .expect("blocks save");
}

async fn create_snapshot(pool: &PgPool, page_id: Uuid, label: &str) -> Uuid {
    let (status, _, bytes) = req(
        router_with(pool),
        "POST",
        &format!("/api/pages/{page_id}/snapshots"),
        Some(serde_json::json!({"label": label})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "snapshot {label} creates");
    let v = json_of(&bytes);
    v["id"]
        .as_str()
        .expect("meta has id")
        .parse()
        .expect("id is uuid")
}

async fn teardown(pool: &PgPool, ws_id: Uuid) {
    sqlx::query("DELETE FROM snapshot WHERE workspace_id = $1")
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("cleanup snapshots");
    sqlx::query("DELETE FROM workspace WHERE id = $1")
        .bind(ws_id)
        .execute(pool)
        .await
        .expect("cleanup workspace");
}

#[tokio::test]
async fn restore_is_non_destructive() {
    let Some(url) = db_url() else {
        eprintln!("SKIP restore_is_non_destructive: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, block_id) = setup_story(&pool, "Novel").await;

    let v1 = create_snapshot(&pool, story_id, "v1").await;
    set_text(&pool, story_id, block_id, "beta rewritten").await;
    let v2 = create_snapshot(&pool, story_id, "v2").await;

    let (status, _, bytes) = req(
        router_with(&pool),
        "POST",
        &format!("/api/snapshots/{v1}/restore"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_of(&bytes)["restored"], serde_json::json!(1));

    // Live blocks now match v1 content.
    let live = store::BlockRepository::new(&pool)
        .list_for_page(story_id)
        .await
        .expect("live blocks read");
    assert_eq!(live.len(), 1);
    assert!(live[0].data.to_string().contains("alpha beginning"));

    // v2 still present and unchanged.
    let (status, _, bytes) = req(
        router_with(&pool),
        "GET",
        &format!("/api/snapshots/{v2}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&bytes).contains("beta rewritten"));

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn delete_guarded_until_with_history() {
    let Some(url) = db_url() else {
        eprintln!("SKIP delete_guarded_until_with_history: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_story(&pool, "Novel").await;
    create_snapshot(&pool, story_id, "v1").await;

    let (status, _, bytes) = req(
        router_with(&pool),
        "DELETE",
        &format!("/api/pages/{story_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(String::from_utf8_lossy(&bytes).contains("with_history"));

    let (status, _, _) = req(
        router_with(&pool),
        "DELETE",
        &format!("/api/pages/{story_id}?with_history=true"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM snapshot WHERE source_page_id = $1")
        .bind(story_id)
        .fetch_one(&pool)
        .await
        .expect("count reads");
    assert_eq!(n, 0, "history deleted with the page");

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn page_export_returns_attachment_with_rendered_markdown() {
    let Some(url) = db_url() else {
        eprintln!("SKIP page_export_returns_attachment: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_story(&pool, "Novel").await;

    let (status, headers, bytes) = req(
        router_with(&pool),
        "GET",
        &format!("/api/pages/{story_id}/export?format=md"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers
        .get("content-type")
        .expect("content-type")
        .to_str()
        .expect("ascii")
        .contains("text/markdown"));
    assert!(headers
        .get("content-disposition")
        .expect("content-disposition")
        .to_str()
        .expect("ascii")
        .contains("attachment"));
    assert!(String::from_utf8_lossy(&bytes).contains("alpha beginning"));

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn diff_and_diff_export() {
    let Some(url) = db_url() else {
        eprintln!("SKIP diff_and_diff_export: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, block_id) = setup_story(&pool, "Novel").await;
    let v1 = create_snapshot(&pool, story_id, "v1").await;
    set_text(&pool, story_id, block_id, "alpha rewritten ending").await;
    let v2 = create_snapshot(&pool, story_id, "v2").await;

    let (status, _, bytes) = req(
        router_with(&pool),
        "GET",
        &format!("/api/snapshots/diff?from={v1}&to={v2}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let diff = json_of(&bytes);
    assert!(diff.get("summary").is_some(), "diff has summary");
    assert!(diff.get("hunks").is_some(), "diff has hunks");
    assert!(!diff["hunks"].as_array().expect("hunks array").is_empty());

    let (status, _, bytes) = req(
        router_with(&pool),
        "GET",
        &format!("/api/snapshots/diff/export?from={v1}&to={v2}&format=md"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = String::from_utf8_lossy(&bytes).into_owned();
    assert!(
        body.contains('v') && body.contains("1"),
        "changelog body names versions"
    );

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn history_bundle_flat_for_three_versions() {
    let Some(url) = db_url() else {
        eprintln!("SKIP history_bundle_flat: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, block_id) = setup_story(&pool, "Novel").await;
    create_snapshot(&pool, story_id, "v1").await;
    set_text(&pool, story_id, block_id, "second draft text").await;
    create_snapshot(&pool, story_id, "v2").await;
    set_text(&pool, story_id, block_id, "third draft text").await;
    create_snapshot(&pool, story_id, "v3").await;

    let (status, headers, bytes) = req(
        router_with(&pool),
        "GET",
        &format!("/api/pages/{story_id}/history-bundle?format=md"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers
        .get("content-type")
        .expect("content-type")
        .to_str()
        .expect("ascii")
        .contains("text/markdown"));
    let body = String::from_utf8_lossy(&bytes).into_owned();
    assert!(body.contains("V-1"), "flat bundle contains V-1");
    assert!(body.contains("V-3"), "flat bundle contains V-3");
    assert!(
        body.find("V-1").unwrap() < body.find("V-3").unwrap(),
        "ascending seq order"
    );

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn restore_of_corrupt_snapshot_is_422_not_500() {
    let Some(url) = db_url() else {
        eprintln!("SKIP restore_corrupt_is_422: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_story(&pool, "Novel").await;
    let v1 = create_snapshot(&pool, story_id, "v1").await;
    sqlx::query("UPDATE snapshot SET content = $1 WHERE id = $2")
        .bind(serde_json::json!({"bogus": "not-an-envelope"}))
        .bind(v1)
        .execute(&pool)
        .await
        .expect("content corrupts");

    let (status, _, _) = req(
        router_with(&pool),
        "POST",
        &format!("/api/snapshots/{v1}/restore"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn cluster_export_returns_zip_with_nested_paths() {
    let Some(url) = db_url() else {
        eprintln!("SKIP cluster_export_returns_zip: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_story_with_chapter(&pool).await;

    let (status, headers, bytes) = req(
        router_with(&pool),
        "GET",
        &format!("/api/pages/{story_id}/cluster-export?format=md"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(headers
        .get("content-type")
        .expect("content-type")
        .to_str()
        .expect("ascii")
        .contains("application/zip"));
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).expect("bytes parse as zip");
    let mut names = Vec::new();
    for i in 0..archive.len() {
        let f = archive.by_index(i).expect("entry reads");
        names.push(f.name().to_string());
    }
    assert!(
        names.iter().any(|n| n.contains('/')),
        "nested paths present: {names:?}"
    );
    assert!(
        names.iter().all(|n| n.ends_with(".md")),
        "md entries: {names:?}"
    );

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn restore_with_no_restorable_pages_is_404() {
    let Some(url) = db_url() else {
        eprintln!("SKIP restore_no_pages_is_404: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_story(&pool, "Novel").await;
    let v1 = create_snapshot(&pool, story_id, "v1").await;

    let full = store::SnapshotRepository::new(&pool)
        .get(v1)
        .await
        .expect("snapshot gets");
    let mut env: domain::SnapshotEnvelope =
        serde_json::from_value(full.content).expect("content is an envelope");
    let ghost = Uuid::new_v4();
    env.root_page_id = ghost;
    env.pages = vec![domain::SnapshotPageMeta {
        id: ghost,
        kind: "story".to_string(),
        title: "Ghost".to_string(),
        parent_page_id: None,
        ordinal: 0,
        narrative_order: None,
    }];
    env.trees = Default::default();
    sqlx::query("UPDATE snapshot SET content = $1 WHERE id = $2")
        .bind(serde_json::to_value(&env).expect("envelope serializes"))
        .bind(v1)
        .execute(&pool)
        .await
        .expect("content rewrites");

    let (status, _, bytes) = req(
        router_with(&pool),
        "POST",
        &format!("/api/snapshots/{v1}/restore"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(
        String::from_utf8_lossy(&bytes).contains("no restorable pages"),
        "body names the failure: {}",
        String::from_utf8_lossy(&bytes)
    );

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn restore_reverts_page_title_and_blocks() {
    let Some(url) = db_url() else {
        eprintln!("SKIP restore_reverts_title: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, block_id) = setup_story(&pool, "Novel").await;
    let v1 = create_snapshot(&pool, story_id, "v1").await;

    let (status, _, _) = req(
        router_with(&pool),
        "PATCH",
        &format!("/api/pages/{story_id}"),
        Some(serde_json::json!({"title": "Renamed"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    set_text(&pool, story_id, block_id, "rewritten live text").await;

    let (status, _, bytes) = req(
        router_with(&pool),
        "POST",
        &format!("/api/snapshots/{v1}/restore"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_of(&bytes)["restored"], serde_json::json!(1));

    let (status, _, bytes) = req(
        router_with(&pool),
        "GET",
        &format!("/api/pages/{story_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_of(&bytes)["title"], serde_json::json!("Novel"));
    let live = store::BlockRepository::new(&pool)
        .list_for_page(story_id)
        .await
        .expect("live blocks read");
    assert!(live[0].data.to_string().contains("alpha beginning"));

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn delete_missing_with_history_is_404_and_preserves_history() {
    let Some(url) = db_url() else {
        eprintln!("SKIP delete_missing_with_history: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_story(&pool, "Novel").await;
    let v1 = create_snapshot(&pool, story_id, "v1").await;

    let missing = Uuid::new_v4();
    let (status, _, _) = req(
        router_with(&pool),
        "DELETE",
        &format!("/api/pages/{missing}?with_history=true"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _, _) = req(
        router_with(&pool),
        "GET",
        &format!("/api/snapshots/{v1}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "history survives a 404 delete");

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn history_bundle_with_unknown_versions_is_400() {
    let Some(url) = db_url() else {
        eprintln!("SKIP history_bundle_unknown_versions: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_story(&pool, "Novel").await;
    create_snapshot(&pool, story_id, "v1").await;

    let unknown = Uuid::new_v4();
    let (status, _, bytes) = req(
        router_with(&pool),
        "GET",
        &format!("/api/pages/{story_id}/history-bundle?versions={unknown}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        String::from_utf8_lossy(&bytes).contains("no matching versions"),
        "body names the failure: {}",
        String::from_utf8_lossy(&bytes)
    );

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn history_bundle_with_blank_versions_is_400_and_absent_is_full() {
    let Some(url) = db_url() else {
        eprintln!("SKIP history_bundle_blank_versions: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_story(&pool, "Novel").await;
    create_snapshot(&pool, story_id, "v1").await;

    for query in ["versions=,,,", "versions=%20%20%20"] {
        let (status, _, bytes) = req(
            router_with(&pool),
            "GET",
            &format!("/api/pages/{story_id}/history-bundle?{query}"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "query {query} is 400");
        assert!(
            String::from_utf8_lossy(&bytes).contains("no matching versions"),
            "body names the failure for {query}: {}",
            String::from_utf8_lossy(&bytes)
        );
    }

    let (status, _, bytes) = req(
        router_with(&pool),
        "GET",
        &format!("/api/pages/{story_id}/history-bundle?format=md"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        String::from_utf8_lossy(&bytes).contains("V-1"),
        "absent versions returns the full bundle"
    );

    teardown(&pool, ws_id).await;
}

#[tokio::test]
async fn zip_too_large_contract_and_export_413() {
    let too_big = "y".repeat(50 * 1024 * 1024 + 1);
    let err = server::export::zip_bytes(&[("v-1.md".to_string(), too_big)])
        .expect_err("oversized bundle must fail");
    assert_eq!(err, server::export::ZipError::TooLarge);
    assert_eq!(
        server::export::too_large_response().status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn oversized_page_export_is_413() {
    let Some(url) = db_url() else {
        eprintln!("SKIP oversized_page_export_is_413: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("db connects");
    let (ws_id, story_id, _) = setup_story(&pool, "Novel").await;

    let big = "x".repeat(53 * 1024 * 1024);
    let data = serde_json::json!({"delta": [{"insert": big}]});
    sqlx::query(
        "INSERT INTO block (id, page_id, parent_block_id, type, data, ordinal) VALUES ($1,$2,NULL,'paragraph',$3,0)",
    )
    .bind(Uuid::new_v4())
    .bind(story_id)
    .bind(data)
    .execute(&pool)
    .await
    .expect("big block inserts");

    let (status, _, _) = req(
        router_with(&pool),
        "GET",
        &format!("/api/pages/{story_id}/export?format=md"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);

    teardown(&pool, ws_id).await;
}
