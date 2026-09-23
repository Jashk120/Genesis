use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use server::{
    app::build_router,
    config::Config,
    routes::{AppState, PatchPage},
};
use tower::ServiceExt;
use uuid::Uuid;

#[test]
fn patch_page_null_means_clear_while_absent_means_unchanged() {
    let absent: PatchPage = serde_json::from_value(serde_json::json!({})).expect("parses");
    assert!(absent.narrative_order.is_none());
    assert!(absent.parent_page_id.is_none());

    let explicit_null: PatchPage =
        serde_json::from_value(serde_json::json!({"narrative_order": null})).expect("parses");
    assert_eq!(explicit_null.narrative_order, Some(None));

    let explicit_null_parent: PatchPage =
        serde_json::from_value(serde_json::json!({"parent_page_id": null})).expect("parses");
    assert_eq!(explicit_null_parent.parent_page_id, Some(None));

    let value: PatchPage =
        serde_json::from_value(serde_json::json!({"narrative_order": 3})).expect("parses");
    assert_eq!(value.narrative_order, Some(Some(3)));
}

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

async fn request(
    router: axum::Router,
    method: &str,
    uri: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
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
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .expect("body reads");
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

#[tokio::test]
async fn patch_null_clears_nullable_fields_and_get_returns_page() {
    let Some(url) = db_url() else {
        eprintln!("SKIP patch_null_clears_nullable_fields: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.expect("db connects");
    let state = AppState {
        pool: Some(pool.clone()),
    };
    let config = test_config();

    let ws_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspace (id, title) VALUES ($1, 'page-api-test')")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("workspace inserts");

    let page_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO page (id, workspace_id, kind, title, narrative_order) VALUES ($1,$2,'chapter','t',3)",
    )
    .bind(page_id)
    .bind(ws_id)
    .execute(&pool)
    .await
    .expect("page inserts");

    let router = build_router(state.clone(), &config);
    let (status, body) = request(
        router,
        "PATCH",
        &format!("/api/pages/{page_id}"),
        Some(serde_json::json!({"narrative_order": null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["narrative_order"], serde_json::Value::Null);

    let router = build_router(state.clone(), &config);
    let (status, body) = request(router, "GET", &format!("/api/pages/{page_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], serde_json::json!(page_id.to_string()));
    assert_eq!(body["narrative_order"], serde_json::Value::Null);

    let missing = Uuid::new_v4();
    let router = build_router(state.clone(), &config);
    let (status, _) = request(router, "GET", &format!("/api/pages/{missing}"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let router = build_router(state, &config);
    let (status, _) = request(router, "GET", "/api/pages/not-a-uuid", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    sqlx::query("DELETE FROM page WHERE id = $1")
        .bind(page_id)
        .execute(&pool)
        .await
        .expect("cleanup page");
    sqlx::query("DELETE FROM workspace WHERE id = $1")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("cleanup workspace");
}

#[tokio::test]
async fn page_root_block_id_equals_page_id_and_is_stable() {
    let Some(url) = db_url() else {
        eprintln!("SKIP root_block_id: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.expect("db connects");
    let state = AppState {
        pool: Some(pool.clone()),
    };
    let config = test_config();

    let ws_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspace (id, title) VALUES ($1, 'root-id-test')")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("workspace inserts");
    let page_id = Uuid::new_v4();
    sqlx::query("INSERT INTO page (id, workspace_id, kind, title) VALUES ($1,$2,'chapter','t')")
        .bind(page_id)
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("page inserts");

    let write = serde_json::json!({
        "type": "page",
        "children": [
            {"type": "paragraph", "data": {"delta": [{"insert": "hi"}]}}
        ]
    });
    let router = build_router(state.clone(), &config);
    let (status, _) = request(
        router,
        "PUT",
        &format!("/api/pages/{page_id}/blocks"),
        Some(write),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let router = build_router(state.clone(), &config);
    let (_, first) = request(router, "GET", &format!("/api/pages/{page_id}/blocks"), None).await;
    let router = build_router(state, &config);
    let (_, second) = request(router, "GET", &format!("/api/pages/{page_id}/blocks"), None).await;

    assert_eq!(
        first["data"]["blockId"],
        serde_json::json!(page_id.to_string())
    );
    assert_eq!(first["data"]["blockId"], second["data"]["blockId"]);

    sqlx::query("DELETE FROM page WHERE id = $1")
        .bind(page_id)
        .execute(&pool)
        .await
        .expect("cleanup page");
    sqlx::query("DELETE FROM workspace WHERE id = $1")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("cleanup workspace");
}

#[tokio::test]
async fn patch_self_parent_is_422() {
    let Some(url) = db_url() else {
        eprintln!("SKIP patch_self_parent_is_422: TEST_DATABASE_URL/DATABASE_URL unset");
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.expect("db connects");
    let state = AppState {
        pool: Some(pool.clone()),
    };
    let config = test_config();

    let ws_id = Uuid::new_v4();
    sqlx::query("INSERT INTO workspace (id, title) VALUES ($1, 'self-parent-422')")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("workspace inserts");
    let page_id = Uuid::new_v4();
    sqlx::query("INSERT INTO page (id, workspace_id, kind, title) VALUES ($1,$2,'chapter','t')")
        .bind(page_id)
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("page inserts");

    let router = build_router(state.clone(), &config);
    let (status, _) = request(
        router,
        "PATCH",
        &format!("/api/pages/{page_id}"),
        Some(serde_json::json!({"parent_page_id": page_id.to_string()})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    sqlx::query("DELETE FROM page WHERE id = $1")
        .bind(page_id)
        .execute(&pool)
        .await
        .expect("cleanup page");
    sqlx::query("DELETE FROM workspace WHERE id = $1")
        .bind(ws_id)
        .execute(&pool)
        .await
        .expect("cleanup workspace");
}
