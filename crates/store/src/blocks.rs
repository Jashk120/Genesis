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
    /// Rows whose ids persist are upserted in place so claims/mentions stay
    /// anchored; only blocks absent from `flat` are deleted (cascading).
    /// Upsert runs before prune so reparented blocks are not cascaded away
    /// by the removal of an old parent.
    pub async fn replace_for_page(
        &self,
        page_id: Uuid,
        flat: &[FlatBlock],
    ) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        self.replace_for_page_tx(&mut tx, page_id, flat).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Tx-scoped variant of [`Self::replace_for_page`] so multi-page restores
    /// can share one transaction with the caller.
    pub async fn replace_for_page_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        page_id: Uuid,
        flat: &[FlatBlock],
    ) -> Result<(), StoreError> {
        if !flat.is_empty() {
            let ids: Vec<Uuid> = flat.iter().map(|b| b.id).collect();
            let conflicts: Vec<Uuid> =
                sqlx::query_scalar(r#"SELECT id FROM block WHERE id = ANY($1) AND page_id <> $2"#)
                    .bind(&ids)
                    .bind(page_id)
                    .fetch_all(&mut **tx)
                    .await?;
            if !conflicts.is_empty() {
                return Err(StoreError::Domain(domain::DomainError::InvalidInput(
                    format!("block id {} already belongs to another page", conflicts[0]),
                )));
            }
        }
        // `flat` arrives parent-first from `flatten_tree`, satisfying the
        // `parent_block_id` self-FK in a single pass.
        for b in flat {
            sqlx::query(
                r#"INSERT INTO block (id, page_id, parent_block_id, type, data, ordinal)
                   VALUES ($1,$2,$3,$4,$5,$6)
                   ON CONFLICT (id) DO UPDATE SET
                       parent_block_id = EXCLUDED.parent_block_id,
                       type = EXCLUDED.type,
                       data = EXCLUDED.data,
                       ordinal = EXCLUDED.ordinal
                   WHERE block.page_id = EXCLUDED.page_id"#,
            )
            .bind(b.id)
            .bind(page_id)
            .bind(b.parent_block_id)
            .bind(&b.block_type)
            .bind(&b.data)
            .bind(b.ordinal)
            .execute(&mut **tx)
            .await?;
        }
        let ids: Vec<Uuid> = flat.iter().map(|b| b.id).collect();
        sqlx::query(r#"DELETE FROM block WHERE page_id = $1 AND id <> ALL($2)"#)
            .bind(page_id)
            .bind(&ids)
            .execute(&mut **tx)
            .await?;
        Ok(())
    }
}
