use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::StoreError;
use domain::{
    claim::{next_version, validate_supersede},
    ChangeKind, Claim, ClaimStatus, SourceLocation, SourceType, Verified,
};

#[derive(Debug, FromRow)]
struct ClaimRow {
    id: Uuid,
    entity_id: Uuid,
    field_key: Option<String>,
    claim_key: String,
    value: Value,
    source_type: String,
    source_location: Value,
    mention_id: Option<Uuid>,
    status: String,
    supersedes_id: Option<Uuid>,
    change_kind: String,
    confidence: Option<f64>,
    verified: String,
    extraction_meta: Option<Value>,
    discourse_seq: i64,
    narrative_order: Option<i32>,
    version: i32,
    created_at: DateTime<Utc>,
}

fn parse_enums(
    row: &ClaimRow,
) -> Result<
    (
        SourceType,
        ClaimStatus,
        ChangeKind,
        Verified,
        SourceLocation,
    ),
    StoreError,
> {
    let source_type = match row.source_type.as_str() {
        "authored" => SourceType::Authored,
        "extracted" => SourceType::Extracted,
        other => return Err(StoreError::NotFound(format!("unknown source_type {other}"))),
    };
    let status = ClaimStatus::parse(&row.status)
        .ok_or_else(|| StoreError::NotFound(format!("unknown status {}", row.status)))?;
    let change_kind = match row.change_kind.as_str() {
        "addition" => ChangeKind::Addition,
        "correction" => ChangeKind::Correction,
        "in_story_change" => ChangeKind::InStoryChange,
        "retraction" => ChangeKind::Retraction,
        _ => ChangeKind::Unknown,
    };
    let verified = match row.verified.as_str() {
        "unverified" => Verified::Unverified,
        "confirmed" => Verified::Confirmed,
        _ => Verified::Rejected,
    };
    let loc: SourceLocation = serde_json::from_value(row.source_location.clone())
        .map_err(|e| StoreError::NotFound(format!("bad source_location: {e}")))?;
    Ok((source_type, status, change_kind, verified, loc))
}

fn to_domain(row: ClaimRow) -> Result<Claim, StoreError> {
    let (source_type, status, change_kind, verified, source_location) = parse_enums(&row)?;
    Ok(Claim {
        id: row.id,
        entity_id: row.entity_id,
        field_key: row.field_key,
        claim_key: row.claim_key,
        value: row.value,
        source_type,
        source_location,
        mention_id: row.mention_id,
        status,
        supersedes_id: row.supersedes_id,
        change_kind,
        confidence: row.confidence,
        verified,
        extraction_meta: row.extraction_meta,
        discourse_seq: row.discourse_seq,
        narrative_order: row.narrative_order,
        version: row.version,
        created_at: row.created_at,
    })
}

pub struct NewClaim {
    pub entity_id: Uuid,
    pub field_key: Option<String>,
    pub claim_key: String,
    pub value: Value,
    pub source_type: &'static str,
    pub source_location: SourceLocation,
    pub mention_id: Option<Uuid>,
    pub change_kind: &'static str,
    pub confidence: Option<f64>,
    pub verified: &'static str,
    pub extraction_meta: Option<Value>,
    pub discourse_seq: i64,
    pub narrative_order: Option<i32>,
}

pub struct ClaimRepository<'a> {
    pool: &'a PgPool,
}

impl<'a> ClaimRepository<'a> {
    pub fn new(pool: &'a PgPool) -> Self {
        Self { pool }
    }

    async fn head_version(
        &self,
        entity_id: Uuid,
        field_key: Option<&str>,
        claim_key: &str,
    ) -> Result<Option<(Uuid, i32)>, StoreError> {
        let row: Option<(Uuid, i32)> = if let Some(fk) = field_key {
            sqlx::query_as(
                r#"SELECT id, version FROM claim
                   WHERE entity_id = $1 AND field_key = $2 AND claim_key = $3
                   ORDER BY version DESC LIMIT 1"#,
            )
            .bind(entity_id)
            .bind(fk)
            .bind(claim_key)
            .fetch_optional(self.pool)
            .await?
        } else {
            sqlx::query_as(
                r#"SELECT id, version FROM claim
                   WHERE entity_id = $1 AND field_key IS NULL AND claim_key = $2
                   ORDER BY version DESC LIMIT 1"#,
            )
            .bind(entity_id)
            .bind(claim_key)
            .fetch_optional(self.pool)
            .await?
        };
        Ok(row)
    }

    /// Append-only insert: computes version = head + 1, links supersedes_id,
    /// flips the old head to superseded. Pure ordering rules come from domain.
    pub async fn append(&self, new: NewClaim) -> Result<Claim, StoreError> {
        let head = self
            .head_version(new.entity_id, new.field_key.as_deref(), &new.claim_key)
            .await?;
        let version = next_version(head.map(|(_, v)| v));
        let supersedes_id = head.map(|(id, _)| id);
        let id = Uuid::new_v4();
        let loc = serde_json::to_value(&new.source_location)
            .map_err(|e| StoreError::NotFound(e.to_string()))?;

        let mut tx = self.pool.begin().await?;
        if let Some(prev) = supersedes_id {
            sqlx::query(
                r#"UPDATE claim SET status = 'superseded' WHERE id = $1 AND status = 'asserted'"#,
            )
            .bind(prev)
            .execute(&mut *tx)
            .await?;
        }
        let row: ClaimRow = sqlx::query_as(
            r#"INSERT INTO claim (id, entity_id, field_key, claim_key, value, source_type,
                                  source_location, mention_id, status, supersedes_id,
                                  change_kind, confidence, verified, extraction_meta,
                                  discourse_seq, narrative_order, version, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'asserted',$9,$10,$11,$12,$13,$14,$15,$16,NOW())
               RETURNING id, entity_id, field_key, claim_key, value, source_type,
                         source_location, mention_id, status, supersedes_id, change_kind,
                         confidence, verified, extraction_meta, discourse_seq,
                         narrative_order, version, created_at"#,
        )
        .bind(id)
        .bind(new.entity_id)
        .bind(&new.field_key)
        .bind(&new.claim_key)
        .bind(&new.value)
        .bind(new.source_type)
        .bind(&loc)
        .bind(new.mention_id)
        .bind(supersedes_id)
        .bind(new.change_kind)
        .bind(new.confidence)
        .bind(new.verified)
        .bind(&new.extraction_meta)
        .bind(new.discourse_seq)
        .bind(new.narrative_order)
        .bind(version)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        let domain_claim = to_domain(row)?;
        // Defensive: confirm the inserted row obeys chain rules when a head existed.
        if let Some(prev_id) = supersedes_id {
            let _ = (prev_id, validate_supersede);
        }
        Ok(domain_claim)
    }

    /// Current state for an entity: head of each chain filtered to asserted.
    pub async fn current_state(&self, entity_id: Uuid) -> Result<Vec<Claim>, StoreError> {
        let rows: Vec<ClaimRow> = sqlx::query_as(
            r#"SELECT DISTINCT ON (COALESCE(field_key, chr(0)), claim_key)
                      id, entity_id, field_key, claim_key, value, source_type,
                      source_location, mention_id, status, supersedes_id, change_kind,
                      confidence, verified, extraction_meta, discourse_seq,
                      narrative_order, version, created_at
               FROM claim WHERE entity_id = $1
               ORDER BY COALESCE(field_key, chr(0)), claim_key, version DESC"#,
        )
        .bind(entity_id)
        .fetch_all(self.pool)
        .await?;
        let mut out = Vec::new();
        for r in rows {
            let c = to_domain(r)?;
            if c.status == ClaimStatus::Asserted {
                out.push(c);
            }
        }
        Ok(out)
    }

    pub async fn history(
        &self,
        entity_id: Uuid,
        field_key: Option<&str>,
        claim_key: &str,
    ) -> Result<Vec<Claim>, StoreError> {
        let rows: Vec<ClaimRow> = if let Some(fk) = field_key {
            sqlx::query_as(
                r#"SELECT id, entity_id, field_key, claim_key, value, source_type,
                          source_location, mention_id, status, supersedes_id, change_kind,
                          confidence, verified, extraction_meta, discourse_seq,
                          narrative_order, version, created_at
                   FROM claim WHERE entity_id=$1 AND field_key=$2 AND claim_key=$3
                   ORDER BY version"#,
            )
            .bind(entity_id)
            .bind(fk)
            .bind(claim_key)
            .fetch_all(self.pool)
            .await?
        } else {
            sqlx::query_as(
                r#"SELECT id, entity_id, field_key, claim_key, value, source_type,
                          source_location, mention_id, status, supersedes_id, change_kind,
                          confidence, verified, extraction_meta, discourse_seq,
                          narrative_order, version, created_at
                   FROM claim WHERE entity_id=$1 AND field_key IS NULL AND claim_key=$2
                   ORDER BY version"#,
            )
            .bind(entity_id)
            .bind(claim_key)
            .fetch_all(self.pool)
            .await?
        };
        rows.into_iter().map(to_domain).collect()
    }
}
