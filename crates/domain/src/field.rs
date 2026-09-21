use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ValueType {
    Enum,
    String,
    Number,
    Boolean,
    EntityRef,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Cardinality {
    Scalar,
    KeyedSet,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FieldStatus {
    Active,
    Deprecated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldDef {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub field_key: String,
    pub value_type: ValueType,
    pub cardinality: Cardinality,
    pub enum_values: Option<Value>,
    pub applies_to: Value,
    pub status: FieldStatus,
    pub successor_field_key: Option<String>,
    pub created_at: DateTime<Utc>,
}
