use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Resolution {
    Manual,
    AutoExact,
    AutoAlias,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Mention {
    pub id: Uuid,
    /// None means unresolved.
    pub entity_id: Option<Uuid>,
    pub block_id: Uuid,
    pub span_start: i32,
    pub span_end: i32,
    pub surface_form: String,
    pub resolution: Option<Resolution>,
    pub confidence: Option<f64>,
    pub provenance: Option<Value>,
    pub created_at: DateTime<Utc>,
}
