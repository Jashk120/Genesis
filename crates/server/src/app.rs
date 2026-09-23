use std::{
    convert::Infallible,
    path::{Component, Path, PathBuf},
};

use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
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

/// Percent-decode `%XX` sequences (handles `%2e%2e` style encoded traversal).
/// Invalid sequences are left as-is so the path still fails safe below.
fn percent_decode(input: &str) -> String {
    let mut out = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && bytes[i + 1].is_ascii_hexdigit()
            && bytes[i + 2].is_ascii_hexdigit()
        {
            let hex = &input[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolve an already-decoded request path to a file inside `dist`, or
/// `None` if the path escapes the bundle (traversal, absolute, or prefix
/// components). Callers must percent-decode exactly once before calling.
fn safe_join(dist: &Path, decoded_req_path: &str) -> Option<PathBuf> {
    let trimmed = decoded_req_path.trim_start_matches('/');
    let mut candidate = PathBuf::from(dist);
    for component in Path::new(trimmed).components() {
        match component {
            Component::Normal(part) => candidate.push(part),
            // `..`, `/`, and Windows prefixes would escape `dist`.
            _ => return None,
        }
    }
    // Belt-and-braces: the normalized join must stay inside `dist`.
    if candidate.starts_with(dist) {
        Some(candidate)
    } else {
        None
    }
}

/// Serve a file only if its canonical path stays inside the canonical dist
/// root. Covers symlinked files and symlinked intermediate directories.
/// Returns `None` when the candidate cannot be canonicalized, escapes the
/// root, or is not a regular file.
async fn contained_contents(canonical_dist: &Path, candidate: &Path) -> Option<Vec<u8>> {
    let canonical_file = tokio::fs::canonicalize(candidate).await.ok()?;
    if !canonical_file.starts_with(canonical_dist) {
        return None;
    }
    let meta = tokio::fs::metadata(&canonical_file).await.ok()?;
    if !meta.is_file() {
        return None;
    }
    tokio::fs::read(&canonical_file).await.ok()
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
    let canonical_dist = match tokio::fs::canonicalize(&dist).await {
        Ok(p) => p,
        Err(_) => return (StatusCode::NOT_FOUND, "not found").into_response(),
    };
    // Decode exactly once; `safe_join` operates on this decoded value.
    let decoded = percent_decode(req_path);
    let trimmed = decoded.trim_start_matches('/');
    let lexical = match safe_join(&dist, &decoded) {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, "not found").into_response(),
    };
    if trimmed.is_empty() {
        let index = dist.join("index.html");
        match contained_contents(&canonical_dist, &index).await {
            Some(body) => {
                let mime = mime_guess::from_path(&index).first_or_octet_stream();
                return (
                    StatusCode::OK,
                    [("content-type", mime.as_ref().to_string())],
                    body,
                )
                    .into_response();
            }
            None => return (StatusCode::NOT_FOUND, "not found").into_response(),
        }
    }
    // If the lexical path resolves to a contained regular file (following
    // symlinks via canonicalization), serve it. Otherwise fall through to
    // SPA fallback / 404 without ever serving the raw lexical path.
    if let Some(body) = contained_contents(&canonical_dist, &lexical).await {
        let canonical_file = match tokio::fs::canonicalize(&lexical).await {
            Ok(p) => p,
            Err(_) => return (StatusCode::NOT_FOUND, "not found").into_response(),
        };
        let mime = mime_guess::from_path(&canonical_file).first_or_octet_stream();
        return (
            StatusCode::OK,
            [("content-type", mime.as_ref().to_string())],
            body,
        )
            .into_response();
    }
    // The lexical target exists but is not a servable contained file
    // (e.g. a symlink escaping dist, or a directory): fail closed with 404.
    // Only genuinely missing paths fall back to the SPA or 404 below.
    if tokio::fs::symlink_metadata(&lexical).await.is_ok() {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    if Path::new(trimmed).extension().is_none() {
        let index = dist.join("index.html");
        match contained_contents(&canonical_dist, &index).await {
            Some(body) => {
                let mime = mime_guess::from_path(&index).first_or_octet_stream();
                return (
                    StatusCode::OK,
                    [("content-type", mime.as_ref().to_string())],
                    body,
                )
                    .into_response();
            }
            None => return (StatusCode::NOT_FOUND, "not found").into_response(),
        }
    }
    (StatusCode::NOT_FOUND, "not found").into_response()
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
        .route(
            "/api/pages/{id}",
            get(get_page).patch(patch_page).delete(delete_page),
        )
        .route("/api/pages/{id}/blocks", get(get_blocks).put(put_blocks))
        .route("/api/pages/{id}/export", get(export_page))
        .route("/api/pages/{id}/history-bundle", get(history_bundle))
        .route("/api/pages/{id}/cluster-export", get(cluster_export))
        .route(
            "/api/pages/{id}/snapshots",
            get(list_snapshots).post(create_snapshot),
        )
        .route("/api/snapshots/diff", get(diff_snapshots))
        .route("/api/snapshots/diff/export", get(export_diff))
        .route("/api/snapshots/{id}", get(get_snapshot))
        .route("/api/snapshots/{id}/export", get(export_snapshot))
        .route("/api/snapshots/{id}/restore", post(restore_snapshot))
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
