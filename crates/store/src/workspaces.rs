use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::StoreError;
use domain::Workspace;

#[derive(Debug, FromRow)]
struct WorkspaceRow {
    id: Uuid,
    title: String,
    created_at: DateTime<Utc>,
}

fn to_domain(r: WorkspaceRow) -> Workspace {
    Workspace {
        id: r.id,
        title: r.title,
        created_at: r.created_at,
    }
}

pub struct WorkspaceRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> WorkspaceRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> Result<Vec<Workspace>, StoreError> {
        let rows: Vec<WorkspaceRow> =
            sqlx::query_as(r#"SELECT id, title, created_at FROM workspace ORDER BY created_at"#)
                .fetch_all(self.pool)
                .await?;
        Ok(rows.into_iter().map(to_domain).collect())
    }

    pub async fn create(&self, title: &str) -> Result<Workspace, StoreError> {
        let ws = Workspace::new(title);
        let row: WorkspaceRow = sqlx::query_as(
            r#"INSERT INTO workspace (id, title, created_at) VALUES ($1, $2, $3)
               RETURNING id, title, created_at"#,
        )
        .bind(ws.id)
        .bind(&ws.title)
        .bind(ws.created_at)
        .fetch_one(self.pool)
        .await?;
        Ok(to_domain(row))
    }

    pub async fn get(&self, id: Uuid) -> Result<Workspace, StoreError> {
        let row: Option<WorkspaceRow> =
            sqlx::query_as(r#"SELECT id, title, created_at FROM workspace WHERE id = $1"#)
                .bind(id)
                .fetch_optional(self.pool)
                .await?;
        row.map(to_domain)
            .ok_or_else(|| StoreError::NotFound(format!("workspace {id}")))
    }
}
