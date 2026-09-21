mod app;
mod config;
mod routes;

use sqlx::postgres::PgPoolOptions;
use tracing::info;

use crate::{app::build_router, config::Config, routes::AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "server=info,tower_http=info".into()),
        )
        .init();
    dotenvy::dotenv().ok();

    let config = Config::from_env();
    info!("genesis server binding {}", config.bind_addr);

    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(3))
        .connect(&config.database_url)
        .await
    {
        Ok(p) => {
            info!("connected to postgres");
            if let Err(e) = store::run_migrations(&p).await {
                tracing::warn!("migrations failed (continuing without DB writes): {e}");
                None
            } else {
                Some(p)
            }
        }
        Err(e) => {
            tracing::warn!(
                "database unavailable at startup ({e}); /api/health still served, DB routes return 503"
            );
            None
        }
    };

    let state = AppState { pool };
    let router = build_router(state, &config);
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    info!("listening on {}", config.bind_addr);
    axum::serve(listener, router).await?;
    Ok(())
}
