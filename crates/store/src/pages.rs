use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::StoreError;
use domain::{Page, PageKind};

#[derive(Debug, FromRow)]
struct PageRow {
    id: Uuid,
    workspace_id: Uuid,
    parent_page_id: Option<Uuid>,
    kind: String,
    title: String,
    discourse_index: Option<i32>,
    narrative_order: Option<i32>,
    ordinal: i32,
    created_at: DateTime<Utc>,
}

fn page_to_domain(r: PageRow) -> Result<Page, StoreError> {
    let kind = PageKind::parse(&r.kind)
        .ok_or_else(|| StoreError::NotFound(format!("unknown page kind {}", r.kind)))?;
    Ok(Page {
        id: r.id,
        workspace_id: r.workspace_id,
        parent_page_id: r.parent_page_id,
        kind,
        title: r.title,
        discourse_index: r.discourse_index,
        narrative_order: r.narrative_order,
        ordinal: r.ordinal,
        created_at: r.created_at,
    })
}

pub struct PageQuery {
    pub workspace_id: Uuid,
    pub parent_id: Option<Option<Uuid>>,
}

pub struct PageRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> PageRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(
        &self,
        workspace_id: Uuid,
        parent_id: Option<Option<Uuid>>,
    ) -> Result<Vec<Page>, StoreError> {
        let rows: Vec<PageRow> = match parent_id {
            None => {
                sqlx::query_as(
                    r#"SELECT id, workspace_id, parent_page_id, kind, title, discourse_index,
                          narrative_order, ordinal, created_at
                   FROM page WHERE workspace_id = $1 ORDER BY ordinal, created_at"#,
                )
                .bind(workspace_id)
                .fetch_all(self.pool)
                .await?
            }
            Some(None) => {
                sqlx::query_as(
                    r#"SELECT id, workspace_id, parent_page_id, kind, title, discourse_index,
                          narrative_order, ordinal, created_at
                   FROM page WHERE workspace_id = $1 AND parent_page_id IS NULL
                   ORDER BY ordinal, created_at"#,
                )
                .bind(workspace_id)
                .fetch_all(self.pool)
                .await?
            }
            Some(Some(pid)) => {
                sqlx::query_as(
                    r#"SELECT id, workspace_id, parent_page_id, kind, title, discourse_index,
                          narrative_order, ordinal, created_at
                   FROM page WHERE workspace_id = $1 AND parent_page_id = $2
                   ORDER BY ordinal, created_at"#,
                )
                .bind(workspace_id)
                .bind(pid)
                .fetch_all(self.pool)
                .await?
            }
        };
        rows.into_iter().map(page_to_domain).collect()
    }

    pub async fn create(&self, page: &Page) -> Result<Page, StoreError> {
        let row: PageRow = sqlx::query_as(
            r#"INSERT INTO page (id, workspace_id, parent_page_id, kind, title,
                                 discourse_index, narrative_order, ordinal, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               RETURNING id, workspace_id, parent_page_id, kind, title, discourse_index,
                         narrative_order, ordinal, created_at"#,
        )
        .bind(page.id)
        .bind(page.workspace_id)
        .bind(page.parent_page_id)
        .bind(page.kind.as_str())
        .bind(&page.title)
        .bind(page.discourse_index)
        .bind(page.narrative_order)
        .bind(page.ordinal)
        .bind(page.created_at)
        .fetch_one(self.pool)
        .await?;
        page_to_domain(row)
    }

    pub async fn get(&self, id: Uuid) -> Result<Page, StoreError> {
        let row: Option<PageRow> = sqlx::query_as(
            r#"SELECT id, workspace_id, parent_page_id, kind, title, discourse_index,
                      narrative_order, ordinal, created_at FROM page WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(self.pool)
        .await?;
        match row {
            Some(r) => page_to_domain(r),
            None => Err(StoreError::NotFound(format!("page {id}"))),
        }
    }

    pub async fn update_title(&self, id: Uuid, title: &str) -> Result<Page, StoreError> {
        let row: Option<PageRow> = sqlx::query_as(
            r#"UPDATE page SET title = $2 WHERE id = $1
               RETURNING id, workspace_id, parent_page_id, kind, title, discourse_index,
                         narrative_order, ordinal, created_at"#,
        )
        .bind(id)
        .bind(title)
        .fetch_optional(self.pool)
        .await?;
        match row {
            Some(r) => page_to_domain(r),
            None => Err(StoreError::NotFound(format!("page {id}"))),
        }
    }

    pub async fn patch(
        &self,
        id: Uuid,
        title: Option<&str>,
        parent_page_id: Option<Option<Uuid>>,
        ordinal: Option<i32>,
        narrative_order: Option<Option<i32>>,
    ) -> Result<Page, StoreError> {
        let current = self.get(id).await?;
        let title = title.unwrap_or(&current.title).to_string();
        let parent = parent_page_id.unwrap_or(current.parent_page_id);
        if let Some(Some(new_parent)) = parent_page_id {
            if new_parent == id {
                return Err(StoreError::Domain(domain::DomainError::InvalidInput(
                    "page cannot be its own parent".to_string(),
                )));
            }
            let mut cursor: Option<Uuid> = Some(new_parent);
            for _ in 0..1000 {
                let cur = match cursor {
                    Some(c) => c,
                    None => break,
                };
                let row: Option<Option<Uuid>> =
                    sqlx::query_scalar(r#"SELECT parent_page_id FROM page WHERE id = $1"#)
                        .bind(cur)
                        .fetch_optional(self.pool)
                        .await?;
                match row {
                    None => break,
                    Some(next) => {
                        if next == Some(id) {
                            return Err(StoreError::Domain(domain::DomainError::InvalidInput(
                                "page parent would create a cycle".to_string(),
                            )));
                        }
                        cursor = next;
                    }
                }
            }
        }
        let ordinal = ordinal.unwrap_or(current.ordinal);
        let narrative = narrative_order.unwrap_or(current.narrative_order);
        let row: PageRow = sqlx::query_as(
            r#"UPDATE page SET title=$2, parent_page_id=$3, ordinal=$4, narrative_order=$5
               WHERE id=$1
               RETURNING id, workspace_id, parent_page_id, kind, title, discourse_index,
                         narrative_order, ordinal, created_at"#,
        )
        .bind(id)
        .bind(&title)
        .bind(parent)
        .bind(ordinal)
        .bind(narrative)
        .fetch_one(self.pool)
        .await?;
        page_to_domain(row)
    }

    pub async fn delete(&self, id: Uuid) -> Result<(), StoreError> {
        let res = sqlx::query(r#"DELETE FROM page WHERE id = $1"#)
            .bind(id)
            .execute(self.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(StoreError::NotFound(format!("page {id}")));
        }
        Ok(())
    }

    pub async fn delete_with_history(&self, page_id: Uuid) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(r#"DELETE FROM snapshot WHERE source_page_id = $1"#)
            .bind(page_id)
            .execute(&mut *tx)
            .await?;
        let res = sqlx::query(r#"DELETE FROM page WHERE id = $1"#)
            .bind(page_id)
            .execute(&mut *tx)
            .await?;
        if res.rows_affected() == 0 {
            tx.rollback().await?;
            return Err(StoreError::NotFound(format!("page {page_id}")));
        }
        tx.commit().await?;
        Ok(())
    }
}
