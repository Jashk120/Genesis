use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::DomainError;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    Asserted,
    Superseded,
    Retracted,
}

impl ClaimStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Asserted => "asserted",
            Self::Superseded => "superseded",
            Self::Retracted => "retracted",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "asserted" => Some(Self::Asserted),
            "superseded" => Some(Self::Superseded),
            "retracted" => Some(Self::Retracted),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    Authored,
    Extracted,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Addition,
    Correction,
    InStoryChange,
    Retraction,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Verified {
    Unverified,
    Confirmed,
    Rejected,
}

/// Durable anchor for where a claim came from.
/// `page_id` is denormalized from the block for grouping.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceLocation {
    pub block_id: Uuid,
    pub span_start: i32,
    pub span_end: i32,
    pub page_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Claim {
    pub id: Uuid,
    pub entity_id: Uuid,
    /// FK -> FieldDef; None only for free-text notes.
    pub field_key: Option<String>,
    /// "_" for scalar, member key for keyed_set, note block id for notes.
    pub claim_key: String,
    pub value: Value,
    pub source_type: SourceType,
    pub source_location: SourceLocation,
    pub mention_id: Option<Uuid>,
    pub status: ClaimStatus,
    /// May cross claim_key (rename/correction record).
    pub supersedes_id: Option<Uuid>,
    pub change_kind: ChangeKind,
    pub confidence: Option<f64>,
    pub verified: Verified,
    pub extraction_meta: Option<Value>,
    pub discourse_seq: i64,
    pub narrative_order: Option<i32>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

/// Next version for a chain: head.version + 1, or 1 when the chain is new.
pub fn next_version(head_version: Option<i32>) -> i32 {
    head_version.map_or(1, |v| v + 1)
}

/// Validate that `new` is a legal successor of `head` within one chain.
/// Rules: same (entity_id, field_key, claim_key), version = head + 1,
/// supersedes_id points at head, head must be asserted (only the head
/// can be superseded, and a retracted/superseded head is frozen).
pub fn validate_supersede(head: &Claim, new: &Claim) -> Result<(), DomainError> {
    if head.entity_id != new.entity_id {
        return Err(DomainError::InvalidSupersede(
            "entity_id must match chain head".to_string(),
        ));
    }
    if head.field_key != new.field_key {
        return Err(DomainError::InvalidSupersede(
            "field_key must match chain head".to_string(),
        ));
    }
    if head.claim_key != new.claim_key {
        return Err(DomainError::InvalidSupersede(
            "claim_key must match chain head for in-chain supersede".to_string(),
        ));
    }
    if head.status != ClaimStatus::Asserted {
        return Err(DomainError::InvalidSupersede(
            "only an asserted head can be superseded".to_string(),
        ));
    }
    if new.version != head.version + 1 {
        return Err(DomainError::InvalidSupersede(format!(
            "version must be head.version + 1 (head={}, new={})",
            head.version, new.version
        )));
    }
    if new.supersedes_id != Some(head.id) {
        return Err(DomainError::InvalidSupersede(
            "supersedes_id must point at the chain head".to_string(),
        ));
    }
    Ok(())
}

/// Validate a cross-key correction: retract old head + insert under the new
/// key with supersedes_id pointing at the retracted old head. The new claim
/// must differ in (field_key, claim_key) but share entity_id.
pub fn validate_cross_key_correction(
    old_head: &Claim,
    retraction: &Claim,
    corrected: &Claim,
) -> Result<(), DomainError> {
    if old_head.status != ClaimStatus::Asserted {
        return Err(DomainError::InvalidSupersede(
            "cross-key correction requires an asserted old head".to_string(),
        ));
    }
    if retraction.supersedes_id != Some(old_head.id) || retraction.status != ClaimStatus::Retracted
    {
        return Err(DomainError::InvalidSupersede(
            "retraction must point at old head with status retracted".to_string(),
        ));
    }
    if corrected.entity_id != old_head.entity_id {
        return Err(DomainError::InvalidSupersede(
            "corrected claim must share entity_id".to_string(),
        ));
    }
    if corrected.field_key == old_head.field_key && corrected.claim_key == old_head.claim_key {
        return Err(DomainError::InvalidSupersede(
            "cross-key correction must change field_key or claim_key".to_string(),
        ));
    }
    if corrected.supersedes_id != Some(old_head.id) {
        return Err(DomainError::InvalidSupersede(
            "corrected claim supersedes_id must point at the retracted old head".to_string(),
        ));
    }
    Ok(())
}

/// Current-state selection: group by (entity_id, field_key, claim_key),
/// take the head (max version) of each chain, keep heads with status asserted.
/// A retracted head withdraws the field — no fallback to older rows.
pub fn select_current_state<'a>(claims: &'a [Claim]) -> Vec<&'a Claim> {
    let mut heads: HashMap<(Uuid, Option<&str>, &str), &Claim> = HashMap::new();
    for c in claims {
        let key = (c.entity_id, c.field_key.as_deref(), c.claim_key.as_str());
        match heads.get(&key) {
            Some(h) if h.version >= c.version => {}
            _ => {
                heads.insert(key, c);
            }
        }
    }
    heads
        .into_values()
        .filter(|c| c.status == ClaimStatus::Asserted)
        .collect()
}

/// Scalar claim_key convention.
pub fn scalar_claim_key() -> String {
    "_".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn claim(
        entity: Uuid,
        field: Option<&str>,
        key: &str,
        version: i32,
        status: ClaimStatus,
    ) -> Claim {
        let page = Uuid::new_v4();
        Claim {
            id: Uuid::new_v4(),
            entity_id: entity,
            field_key: field.map(str::to_string),
            claim_key: key.to_string(),
            value: json!("blue"),
            source_type: SourceType::Authored,
            source_location: SourceLocation {
                block_id: Uuid::new_v4(),
                span_start: 0,
                span_end: 4,
                page_id: page,
            },
            mention_id: None,
            status,
            supersedes_id: None,
            change_kind: ChangeKind::Addition,
            confidence: None,
            verified: Verified::Confirmed,
            extraction_meta: None,
            discourse_seq: 1,
            narrative_order: None,
            version,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn next_version_starts_at_one() {
        assert_eq!(next_version(None), 1);
        assert_eq!(next_version(Some(3)), 4);
    }

    #[test]
    fn supersede_validation_accepts_legal_successor() {
        let e = Uuid::new_v4();
        let head = claim(e, Some("eyes"), "_", 1, ClaimStatus::Asserted);
        let mut next = claim(e, Some("eyes"), "_", 2, ClaimStatus::Asserted);
        next.supersedes_id = Some(head.id);
        assert!(validate_supersede(&head, &next).is_ok());
    }

    #[test]
    fn supersede_rejects_wrong_version_or_link() {
        let e = Uuid::new_v4();
        let head = claim(e, Some("eyes"), "_", 1, ClaimStatus::Asserted);
        let mut bad = claim(e, Some("eyes"), "_", 3, ClaimStatus::Asserted);
        bad.supersedes_id = Some(head.id);
        assert!(validate_supersede(&head, &bad).is_err());

        let mut bad2 = claim(e, Some("eyes"), "_", 2, ClaimStatus::Asserted);
        bad2.supersedes_id = Some(Uuid::new_v4());
        assert!(validate_supersede(&head, &bad2).is_err());
    }

    #[test]
    fn supersede_rejects_non_asserted_head() {
        let e = Uuid::new_v4();
        let head = claim(e, Some("eyes"), "_", 1, ClaimStatus::Retracted);
        let mut next = claim(e, Some("eyes"), "_", 2, ClaimStatus::Asserted);
        next.supersedes_id = Some(head.id);
        assert!(validate_supersede(&head, &next).is_err());
    }

    #[test]
    fn current_state_is_head_then_filter_asserted() {
        let e = Uuid::new_v4();
        let mut v1 = claim(e, Some("eyes"), "_", 1, ClaimStatus::Superseded);
        let mut v2 = claim(e, Some("eyes"), "_", 2, ClaimStatus::Asserted);
        v2.supersedes_id = Some(v1.id);
        // Retracted sole chain must NOT fall back.
        let r1 = claim(e, Some("status"), "_", 1, ClaimStatus::Retracted);
        // Keyed set: two members, one retracted.
        let m1 = claim(e, Some("ally"), "bob", 1, ClaimStatus::Asserted);
        let m2 = claim(e, Some("ally"), "rob", 1, ClaimStatus::Retracted);
        let _ = &mut v1;
        let all = [v1, v2.clone(), r1, m1, m2];
        let state = select_current_state(&all);
        let keys: Vec<_> = state
            .iter()
            .map(|c| (c.field_key.clone(), c.claim_key.clone()))
            .collect();
        assert!(keys.contains(&(Some("eyes".to_string()), "_".to_string())));
        assert!(keys.contains(&(Some("ally".to_string()), "bob".to_string())));
        assert!(!keys.iter().any(|(f, _)| f.as_deref() == Some("status")));
        assert_eq!(
            state
                .iter()
                .find(|c| c.field_key.as_deref() == Some("eyes"))
                .unwrap()
                .id,
            v2.id
        );
    }

    #[test]
    fn cross_key_correction_validates() {
        let e = Uuid::new_v4();
        let old = claim(e, Some("ally"), "bob", 1, ClaimStatus::Asserted);
        let mut retr = claim(e, Some("ally"), "bob", 2, ClaimStatus::Retracted);
        retr.supersedes_id = Some(old.id);
        retr.change_kind = ChangeKind::Correction;
        let mut fixed = claim(e, Some("ally"), "robert", 1, ClaimStatus::Asserted);
        fixed.supersedes_id = Some(old.id);
        fixed.change_kind = ChangeKind::Correction;
        assert!(validate_cross_key_correction(&old, &retr, &fixed).is_ok());
    }

    #[test]
    fn scalar_key_convention() {
        assert_eq!(scalar_claim_key(), "_");
    }
}
