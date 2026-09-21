use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    pub id: Uuid,
    pub source_page_id: Uuid,
    pub label: String,
    pub content: Value,
    pub content_hash: String,
    pub created_at: DateTime<Utc>,
}
