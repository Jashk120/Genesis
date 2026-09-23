use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use domain::{Snapshot, SnapshotEnvelope, SnapshotMeta, SnapshotPageMeta};

use crate::{BlockRepository, PageRepository, StoreError};

#[derive(Debug, FromRow)]
struct PageMetaRow {
    id: Uuid,
    parent_page_id: Option<Uuid>,
    kind: String,
    title: String,
    ordinal: i32,
    narrative_order: Option<i32>,
}

#[derive(Debug, FromRow)]
struct SnapshotMetaRow {
    id: Uuid,
    source_page_id: Uuid,
    label: String,
    seq: i32,
    content_hash: String,
    byte_size: Option<i32>,
    block_count: Option<i32>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct SnapshotRow {
    id: Uuid,
    source_page_id: Uuid,
    workspace_id: Uuid,
    label: String,
    seq: i32,
    content: Value,
    content_hash: String,
    scope_page_ids: Vec<Uuid>,
    byte_size: Option<i32>,
    block_count: Option<i32>,
    base_snapshot_id: Option<Uuid>,
    delta: Option<Value>,
    is_materialized: bool,
    created_at: DateTime<Utc>,
}

fn meta_to_domain(r: SnapshotMetaRow) -> SnapshotMeta {
    SnapshotMeta {
        id: r.id,
        source_page_id: r.source_page_id,
        label: r.label,
        seq: r.seq,
        content_hash: r.content_hash,
        byte_size: r.byte_size,
        block_count: r.block_count,
        created_at: r.created_at,
    }
}

fn snapshot_to_domain(r: SnapshotRow) -> Snapshot {
    Snapshot {
        id: r.id,
        source_page_id: r.source_page_id,
        workspace_id: r.workspace_id,
        label: r.label,
        seq: r.seq,
        content: r.content,
        content_hash: r.content_hash,
        scope_page_ids: r.scope_page_ids,
        byte_size: r.byte_size,
        block_count: r.block_count,
        base_snapshot_id: r.base_snapshot_id,
        delta: r.delta,
        is_materialized: r.is_materialized,
        created_at: r.created_at,
    }
}

pub struct SnapshotRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> SnapshotRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    /// Capture the root page plus ALL descendants as a self-contained envelope.
    pub async fn build_envelope(&self, page_id: Uuid) -> Result<SnapshotEnvelope, StoreError> {
        let root = PageRepository::new(self.pool).get(page_id).await?;
        let rows: Vec<PageMetaRow> = sqlx::query_as(
            r#"WITH RECURSIVE subtree AS (
                 SELECT id, parent_page_id, kind, title, ordinal, narrative_order, 0 AS depth
                   FROM page WHERE id = $1
                 UNION ALL
                 SELECT p.id, p.parent_page_id, p.kind, p.title, p.ordinal, p.narrative_order,
                        s.depth + 1
                   FROM page p JOIN subtree s ON p.parent_page_id = s.id
               )
               SELECT id, parent_page_id, kind, title, ordinal, narrative_order
                 FROM subtree ORDER BY depth, ordinal, id"#,
        )
        .bind(page_id)
        .fetch_all(self.pool)
        .await?;
        if rows.is_empty() {
            return Err(StoreError::NotFound(format!("page {page_id}")));
        }
        let mut pages = Vec::with_capacity(rows.len());
        let mut trees = std::collections::BTreeMap::new();
        for r in &rows {
            pages.push(SnapshotPageMeta {
                id: r.id,
                kind: r.kind.clone(),
                title: r.title.clone(),
                parent_page_id: r.parent_page_id,
                ordinal: r.ordinal,
                narrative_order: r.narrative_order,
            });
        }
        for r in &rows {
            let blocks = BlockRepository::new(self.pool).list_for_page(r.id).await?;
            trees.insert(r.id.to_string(), domain::block::assemble_tree(&blocks));
        }
        Ok(SnapshotEnvelope {
            version: 1,
            root_page_id: root.id,
            pages,
            trees,
        })
    }

    pub async fn create(
        &self,
        source_page_id: Uuid,
        label: &str,
    ) -> Result<SnapshotMeta, StoreError> {
        if label.trim().is_empty() {
            return Err(StoreError::Domain(domain::DomainError::InvalidInput(
                "snapshot label must not be blank".to_string(),
            )));
        }
        let root = PageRepository::new(self.pool).get(source_page_id).await?;
        let envelope = self.build_envelope(source_page_id).await?;
        let content: Value = serde_json::to_value(&envelope)
            .map_err(|e| StoreError::Domain(domain::DomainError::InvalidInput(e.to_string())))?;
        let content_hash = domain::snapshot::canonical_hash(&envelope);
        let byte_size = serde_json::to_vec(&content)
            .map(|b| b.len() as i32)
            .unwrap_or(0);
        let block_count = domain::snapshot::count_blocks(&envelope);
        let scope_page_ids: Vec<Uuid> = envelope.pages.iter().map(|p| p.id).collect();

        let dup: Option<Uuid> = sqlx::query_scalar(
            r#"SELECT id FROM snapshot WHERE source_page_id = $1 AND label = $2"#,
        )
        .bind(source_page_id)
        .bind(label)
        .fetch_optional(self.pool)
        .await?;
        if dup.is_some() {
            return Err(StoreError::Conflict(format!(
                "snapshot label '{label}' already exists for page {source_page_id}"
            )));
        }

        if let Some(latest) = self.latest_for_page(source_page_id).await? {
            if latest.content_hash == content_hash {
                return Err(StoreError::NoChange("no_change".to_string()));
            }
        }

        let mut attempts = 0;
        loop {
            attempts += 1;
            let seq: i32 = sqlx::query_scalar(
                r#"SELECT COALESCE(MAX(seq), 0) + 1 FROM snapshot WHERE source_page_id = $1"#,
            )
            .bind(source_page_id)
            .fetch_one(self.pool)
            .await?;
            let id = Uuid::new_v4();
            let row: Result<SnapshotMetaRow, sqlx::Error> = sqlx::query_as(
                r#"INSERT INTO snapshot
                     (id, source_page_id, workspace_id, label, seq, content, content_hash,
                      scope_page_ids, byte_size, block_count, base_snapshot_id, delta,
                      is_materialized)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,TRUE)
                   RETURNING id, source_page_id, label, seq, content_hash, byte_size,
                             block_count, created_at"#,
            )
            .bind(id)
            .bind(source_page_id)
            .bind(root.workspace_id)
            .bind(label)
            .bind(seq)
            .bind(&content)
            .bind(&content_hash)
            .bind(&scope_page_ids)
            .bind(byte_size)
            .bind(block_count)
            .fetch_one(self.pool)
            .await;
            match row {
                Ok(r) => return Ok(meta_to_domain(r)),
                Err(e) => {
                    let seq_hit = is_unique_violation(&e)
                        && violation_constraint(&e).as_deref() == Some("snapshot_source_seq_uidx");
                    if seq_hit && attempts < MAX_SEQ_ATTEMPTS {
                        continue;
                    }
                    if is_unique_violation(&e) && !seq_hit {
                        return Err(StoreError::Conflict(format!(
                            "snapshot label '{label}' already exists for page {source_page_id}"
                        )));
                    }
                    return Err(StoreError::Sqlx(e));
                }
            }
        }
    }

    pub async fn restore_into_live(&self, envelope: &SnapshotEnvelope) -> Result<u32, StoreError> {
        let mut tx = self.pool.begin().await?;
        let block_repo = BlockRepository::new(self.pool);
        let mut restored: u32 = 0;
        for page in &envelope.pages {
            let live: Option<(Uuid, String)> =
                sqlx::query_as(r#"SELECT id, title FROM page WHERE id = $1"#)
                    .bind(page.id)
                    .fetch_optional(&mut *tx)
                    .await?;
            let Some((_, live_title)) = live else {
                continue;
            };
            let Some(tree) = envelope.trees.get(&page.id.to_string()) else {
                continue;
            };
            let flat = domain::block::flatten_tree(page.id, tree)?;
            block_repo
                .replace_for_page_tx(&mut tx, page.id, &flat)
                .await?;
            if live_title != page.title {
                sqlx::query(r#"UPDATE page SET title = $2 WHERE id = $1"#)
                    .bind(page.id)
                    .bind(&page.title)
                    .execute(&mut *tx)
                    .await?;
            }
            restored += 1;
        }
        tx.commit().await?;
        Ok(restored)
    }

    pub async fn list_meta_for_page(&self, page_id: Uuid) -> Result<Vec<SnapshotMeta>, StoreError> {
        let rows: Vec<SnapshotMetaRow> = sqlx::query_as(
            r#"SELECT id, source_page_id, label, seq, content_hash, byte_size, block_count,
                      created_at
               FROM snapshot WHERE source_page_id = $1 ORDER BY seq ASC"#,
        )
        .bind(page_id)
        .fetch_all(self.pool)
        .await?;
        Ok(rows.into_iter().map(meta_to_domain).collect())
    }

    pub async fn get(&self, id: Uuid) -> Result<Snapshot, StoreError> {
        let row: Option<SnapshotRow> = sqlx::query_as(
            r#"SELECT id, source_page_id, workspace_id, label, seq, content, content_hash,
                      scope_page_ids, byte_size, block_count, base_snapshot_id, delta,
                      is_materialized, created_at
               FROM snapshot WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(self.pool)
        .await?;
        match row {
            Some(r) => Ok(snapshot_to_domain(r)),
            None => Err(StoreError::NotFound(format!("snapshot {id}"))),
        }
    }

    pub async fn latest_for_page(&self, page_id: Uuid) -> Result<Option<Snapshot>, StoreError> {
        let row: Option<SnapshotRow> = sqlx::query_as(
            r#"SELECT id, source_page_id, workspace_id, label, seq, content, content_hash,
                      scope_page_ids, byte_size, block_count, base_snapshot_id, delta,
                      is_materialized, created_at
               FROM snapshot WHERE source_page_id = $1 ORDER BY seq DESC LIMIT 1"#,
        )
        .bind(page_id)
        .fetch_optional(self.pool)
        .await?;
        Ok(row.map(snapshot_to_domain))
    }

    pub async fn count_for_page(&self, page_id: Uuid) -> Result<i64, StoreError> {
        let n: i64 =
            sqlx::query_scalar(r#"SELECT COUNT(*) FROM snapshot WHERE source_page_id = $1"#)
                .bind(page_id)
                .fetch_one(self.pool)
                .await?;
        Ok(n)
    }

    pub async fn delete_for_page(&self, page_id: Uuid) -> Result<u64, StoreError> {
        let res = sqlx::query(r#"DELETE FROM snapshot WHERE source_page_id = $1"#)
            .bind(page_id)
            .execute(self.pool)
            .await?;
        Ok(res.rows_affected())
    }
}

fn is_unique_violation(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Database(db) => db.code().as_deref() == Some("23505"),
        _ => false,
    }
}

const MAX_SEQ_ATTEMPTS: u32 = 5;

fn violation_constraint(e: &sqlx::Error) -> Option<String> {
    e.as_database_error()
        .and_then(|db| db.constraint().map(str::to_string))
}
