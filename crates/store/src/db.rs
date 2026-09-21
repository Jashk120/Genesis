use sqlx::postgres::{PgPool, PgPoolOptions};

use crate::StoreError;

/// Create a Postgres pool from `DATABASE_URL`.
/// Reads the env var directly so `server` config stays thin.
pub async fn create_pool() -> Result<PgPool, StoreError> {
    let url = std::env::var("DATABASE_URL")?;
    create_pool_with_url(&url).await
}

pub async fn create_pool_with_url(url: &str) -> Result<PgPool, StoreError> {
    let pool = PgPoolOptions::new().max_connections(5).connect(url).await?;
    Ok(pool)
}

/// Run embedded sqlx migrations in `crates/store/migrations`.
pub async fn run_migrations(pool: &PgPool) -> Result<(), StoreError> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}
