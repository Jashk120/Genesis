use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConflictTier {
    #[serde(rename = "t1_structured")]
    T1Structured,
    #[serde(rename = "t2_extracted")]
    T2Extracted,
    #[serde(rename = "t3_soft")]
    T3Soft,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConflictStatus {
    Open,
    Suggested,
    Dismissed,
    ResolvedAsChange,
    ResolvedAsCorrection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Conflict {
    pub id: Uuid,
    pub entity_id: Uuid,
    pub field_key: Option<String>,
    pub claim_key: Option<String>,
    pub prior_claim_id: Uuid,
    pub new_claim_id: Uuid,
    pub tier: ConflictTier,
    pub status: ConflictStatus,
    pub created_at: DateTime<Utc>,
}
