pub mod blocks;
pub mod claims;
pub mod db;
pub mod pages;
pub mod workspaces;

pub use blocks::BlockRepository;
pub use claims::ClaimRepository;
pub use db::{create_pool, create_pool_with_url, run_migrations};
pub use pages::{PageQuery, PageRepository};
pub use workspaces::WorkspaceRepository;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error("env error: {0}")]
    Env(#[from] std::env::VarError),
    #[error("domain error: {0}")]
    Domain(#[from] domain::DomainError),
    #[error("not found: {0}")]
    NotFound(String),
}
