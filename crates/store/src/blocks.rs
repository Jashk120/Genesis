use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::StoreError;
use domain::{Block, FlatBlock};

#[derive(Debug, FromRow)]
struct BlockRow {
    id: Uuid,
    page_id: Uuid,
    parent_block_id: Option<Uuid>,
    #[sqlx(rename = "type")]
    block_type: String,
    data: Value,
    ordinal: i32,
}

fn to_domain(r: BlockRow) -> Block {
    Block {
        id: r.id,
        page_id: r.page_id,
        parent_block_id: r.parent_block_id,
        block_type: r.block_type,
        data: r.data,
        ordinal: r.ordinal,
    }
}

pub struct BlockRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> BlockRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_for_page(&self, page_id: Uuid) -> Result<Vec<Block>, StoreError> {
        let rows: Vec<BlockRow> = sqlx::query_as(
            r#"SELECT id, page_id, parent_block_id, type, data, ordinal
               FROM block WHERE page_id = $1 ORDER BY ordinal"#,
        )
        .bind(page_id)
        .fetch_all(self.pool)
        .await?;
        Ok(rows.into_iter().map(to_domain).collect())
    }

    /// Replace all blocks of a page with `flat` in one transaction.
    /// Block ids are preserved so claims/mentions stay anchored.
    pub async fn replace_for_page(
        &self,
        page_id: Uuid,
        flat: &[FlatBlock],
    ) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(r#"DELETE FROM block WHERE page_id = $1"#)
            .bind(page_id)
            .execute(&mut *tx)
            .await?;
        for b in flat {
            sqlx::query(
                r#"INSERT INTO block (id, page_id, parent_block_id, type, data, ordinal)
                   VALUES ($1,$2,$3,$4,$5,$6)"#,
            )
            .bind(b.id)
            .bind(page_id)
            .bind(b.parent_block_id)
            .bind(&b.block_type)
            .bind(&b.data)
            .bind(b.ordinal)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }
}
