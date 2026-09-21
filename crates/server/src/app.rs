use std::{convert::Infallible, path::PathBuf};

use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch},
    Router,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::warn;

use crate::{config::Config, routes::AppState};

fn missing_client_response(client_dist: &str) -> Response {
    (
        StatusCode::NOT_FOUND,
        format!("client bundle not built at {client_dist}; see README to build client/"),
    )
        .into_response()
}

async fn spa_response(req_path: &str, client_dist: &str) -> Response {
    let dist = PathBuf::from(client_dist);
    if !dist.join("index.html").is_file() {
        warn!(
            "static assets missing: {}/index.html not found; /api/* still served",
            client_dist
        );
        return missing_client_response(client_dist);
    }
    let trimmed = req_path.trim_start_matches('/');
    let candidate = dist.join(trimmed);
    let file = if !trimmed.is_empty() && candidate.is_file() {
        candidate
    } else {
        dist.join("index.html")
    };
    match tokio::fs::read(&file).await {
        Ok(body) => {
            let mime = mime_guess::from_path(&file).first_or_octet_stream();
            (
                StatusCode::OK,
                [("content-type", mime.as_ref().to_string())],
                body,
            )
                .into_response()
        }
        Err(e) => (StatusCode::NOT_FOUND, e.to_string()).into_response(),
    }
}

pub fn build_router(state: AppState, config: &Config) -> Router {
    use crate::routes::*;
    let api = Router::new()
        .route("/api/health", get(health))
        .route(
            "/api/workspaces",
            get(list_workspaces).post(create_workspace),
        )
        .route("/api/pages", get(list_pages).post(create_page))
        .route("/api/pages/{id}", patch(patch_page).delete(delete_page))
        .route("/api/pages/{id}/blocks", get(get_blocks).put(put_blocks))
        .with_state(state);

    let dist = config.client_dist.clone();
    let dist_path = PathBuf::from(&dist);
    if !dist_path.join("index.html").is_file() {
        warn!(
            "static assets missing: {}/index.html not found; /api/* still served",
            dist
        );
    }

    let static_service = {
        let dist_clone = dist.clone();
        tower::service_fn(move |req: Request<Body>| {
            let dist_clone = dist_clone.clone();
            async move { Ok::<Response, Infallible>(spa_response(req.uri().path(), &dist_clone).await) }
        })
    };

    let index_dist = dist.clone();
    api.route(
        "/",
        get(move || {
            let index_dist = index_dist.clone();
            async move { spa_response("/", &index_dist).await }
        }),
    )
    .fallback_service(static_service)
    .layer(CorsLayer::permissive())
    .layer(TraceLayer::new_for_http())
}
