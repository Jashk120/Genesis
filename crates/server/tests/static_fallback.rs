use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use server::{app::build_router, config::Config, routes::AppState};
use tower::ServiceExt;

fn test_config(client_dist: &str) -> Config {
    Config {
        database_url: String::new(),
        bind_addr: "127.0.0.1:0".parse().expect("loopback parses"),
        client_dist: client_dist.to_string(),
    }
}

fn state_without_db() -> AppState {
    AppState { pool: None }
}

fn stage_dist(name: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("genesis-test-dist-{}-{}", std::process::id(), name));
    std::fs::create_dir_all(dir.join("assets")).expect("create staged dist");
    std::fs::write(dir.join("index.html"), "<html>spa</html>").expect("write index");
    std::fs::write(dir.join("assets").join("app.js"), "console.log(1)").expect("write asset");
    dir
}

async fn get_status(router: axum::Router, uri: &str) -> (StatusCode, Vec<u8>) {
    let req = Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("request builds");
    let res = router.oneshot(req).await.expect("service responds");
    let status = res.status();
    let body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .expect("body reads");
    (status, body.to_vec())
}

#[tokio::test]
async fn health_is_served_without_db() {
    let dir = stage_dist("health");
    let router = build_router(
        state_without_db(),
        &test_config(dir.to_str().expect("utf8")),
    );
    let (status, _) = get_status(router, "/api/health").await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn db_route_reports_503_without_db() {
    let dir = stage_dist("unavailable");
    let router = build_router(
        state_without_db(),
        &test_config(dir.to_str().expect("utf8")),
    );
    let (status, _) = get_status(router, "/api/workspaces").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn path_traversal_does_not_serve_outside_dist() {
    let dir = stage_dist("traversal");
    let dist = dir.to_str().expect("utf8").to_string();
    let config = test_config(&dist);

    for uri in [
        "/../../../../../../etc/passwd",
        "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
        "/..%2f..%2fetc/passwd",
    ] {
        let router = build_router(state_without_db(), &config);
        let (status, body) = get_status(router, uri).await;
        assert_ne!(status, StatusCode::OK, "traversal served 200 for {uri}");
        assert!(
            !body.windows(8).any(|w| w == b"root:x:0"),
            "passwd contents leaked for {uri}"
        );
    }
}

#[tokio::test]
async fn missing_asset_with_extension_is_404_not_spa_fallback() {
    let dir = stage_dist("assets");
    let router = build_router(
        state_without_db(),
        &test_config(dir.to_str().expect("utf8")),
    );
    let (status, _) = get_status(router, "/assets/does-not-exist.js").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn extensionless_app_route_falls_back_to_index() {
    let dir = stage_dist("fallback");
    let router = build_router(
        state_without_db(),
        &test_config(dir.to_str().expect("utf8")),
    );
    let (status, body) = get_status(router, "/stories/some-note").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"<html>spa</html>");
}

#[tokio::test]
async fn existing_asset_is_served() {
    let dir = stage_dist("existing");
    let router = build_router(
        state_without_db(),
        &test_config(dir.to_str().expect("utf8")),
    );
    let (status, body) = get_status(router, "/assets/app.js").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"console.log(1)");
}

#[tokio::test]
async fn symlink_pointing_outside_dist_is_404() {
    let dir = stage_dist("symlink-outside");
    let outside = std::env::temp_dir().join(format!(
        "genesis-outside-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    std::fs::write(&outside, "outside-secret-contents").expect("write outside file");
    let link = dir.join("evil.txt");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &link).expect("symlink created");
    let router = build_router(
        state_without_db(),
        &test_config(dir.to_str().expect("utf8")),
    );
    let (status, body) = get_status(router, "/evil.txt").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(
        !body.windows(8).any(|w| w == b"outside-"),
        "symlink target contents leaked"
    );
    assert_eq!(body, b"not found");
    std::fs::remove_file(&link).ok();
    std::fs::remove_file(&outside).ok();
}

#[tokio::test]
async fn symlink_pointing_inside_dist_is_served() {
    let dir = stage_dist("symlink-inside");
    std::fs::write(dir.join("real.txt"), "inside-contents").expect("write real file");
    let link = dir.join("link.txt");
    #[cfg(unix)]
    std::os::unix::fs::symlink(dir.join("real.txt"), &link).expect("symlink created");
    let router = build_router(
        state_without_db(),
        &test_config(dir.to_str().expect("utf8")),
    );
    let (status, body) = get_status(router, "/link.txt").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"inside-contents");
    std::fs::remove_file(&link).ok();
}

#[tokio::test]
async fn very_long_filename_is_404_with_constant_body() {
    let dir = stage_dist("longname");
    let router = build_router(
        state_without_db(),
        &test_config(dir.to_str().expect("utf8")),
    );
    let long = format!("{}.js", "a".repeat(400));
    let (status, body) = get_status(router, &format!("/{long}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, b"not found");
}
