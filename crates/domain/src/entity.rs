use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    Character,
    Place,
    Object,
    Faction,
    Concept,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entity {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub canonical_name: String,
    pub kind: EntityKind,
    pub merged_into_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityAlias {
    pub id: Uuid,
    pub entity_id: Uuid,
    pub surface_form: String,
    pub alias_kind: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LineageKind {
    Merge,
    Split,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntityLineage {
    pub id: Uuid,
    pub from_entity_id: Uuid,
    pub to_entity_id: Uuid,
    pub kind: LineageKind,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Follow `merged_into_id` transitively to the surviving entity.
pub fn resolve_entity(entity_id: Uuid, lookup: &dyn Fn(Uuid) -> Option<Option<Uuid>>) -> Uuid {
    let mut current = entity_id;
    let mut hops = 0;
    while let Some(next) = lookup(current).flatten() {
        current = next;
        hops += 1;
        if hops > 64 {
            break;
        }
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn resolves_merge_chain_transitively() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let c = Uuid::new_v4();
        let mut m: HashMap<Uuid, Option<Uuid>> = HashMap::new();
        m.insert(a, Some(b));
        m.insert(b, Some(c));
        m.insert(c, None);
        assert_eq!(resolve_entity(a, &|id| m.get(&id).cloned()), c);
        assert_eq!(resolve_entity(c, &|id| m.get(&id).cloned()), c);
    }
}
