use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::block::BlockNode;

/// Full snapshot row: content is the [`SnapshotEnvelope`] serialized as JSON.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    pub id: Uuid,
    pub source_page_id: Uuid,
    pub workspace_id: Uuid,
    pub label: String,
    pub seq: i32,
    pub content: Value,
    pub content_hash: String,
    pub scope_page_ids: Vec<Uuid>,
    pub byte_size: Option<i32>,
    pub block_count: Option<i32>,
    pub base_snapshot_id: Option<Uuid>,
    pub delta: Option<Value>,
    pub is_materialized: bool,
    pub created_at: DateTime<Utc>,
}

/// Metadata projection for list responses. Deliberately has NO `content`
/// field so list endpoints can never leak full envelopes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SnapshotMeta {
    pub id: Uuid,
    pub source_page_id: Uuid,
    pub label: String,
    pub seq: i32,
    pub content_hash: String,
    pub byte_size: Option<i32>,
    pub block_count: Option<i32>,
    pub created_at: DateTime<Utc>,
}

/// Page metadata captured inside an envelope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SnapshotPageMeta {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub parent_page_id: Option<Uuid>,
    pub ordinal: i32,
    pub narrative_order: Option<i32>,
}

/// Self-contained capture of a page subtree: root + descendants metadata
/// plus one assembled [`BlockNode`] tree per page, keyed by page id string.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SnapshotEnvelope {
    pub version: u32,
    pub root_page_id: Uuid,
    pub pages: Vec<SnapshotPageMeta>,
    pub trees: BTreeMap<String, BlockNode>,
}

/// Canonical form hashed by [`canonical_hash`]:
/// - flatten every block across all pages to
///   `{id, type, page_id, parent_block_id, ordinal, data}`;
/// - merge adjacent delta ops with equal attributes (op fragmentation
///   must not change the hash), while keeping marks hash-relevant;
/// - STRIP the mirrored `data.blockId` injected by `assemble_tree`
///   (else identical docs hash differently);
/// - sort blocks by `id`;
/// - include page metadata
///   `{id, kind, title, parent_page_id, ordinal, narrative_order}`
///   (sorted by `id` so insertion order does not matter);
/// - serialize deterministically (sorted keys; `serde_json` without
///   `preserve_order` uses `BTreeMap`), then sha256 hex.
///
/// Block identity invariant: real blocks always carry a UUID
/// (`flatten_tree` guarantees it) as top-level `id` or as a parseable
/// `data.blockId`. Blocks without a valid UUID are excluded from the
/// hash (and, symmetrically, from the version diff).
pub fn canonical_hash(envelope: &SnapshotEnvelope) -> String {
    let mut pages: Vec<Value> = envelope
        .pages
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id.to_string(),
                "kind": p.kind,
                "title": p.title,
                "parent_page_id": p.parent_page_id.map(|u| u.to_string()),
                "ordinal": p.ordinal,
                "narrative_order": p.narrative_order,
            })
        })
        .collect();
    pages.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));

    let mut blocks: Vec<Value> = Vec::new();
    for (page_key, tree) in &envelope.trees {
        flatten_for_hash(tree, page_key, None, &mut blocks);
    }
    blocks.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));

    let canonical = serde_json::json!({"pages": pages, "blocks": blocks});
    // Serialization of a BTreeMap-backed Value cannot realistically fail,
    // but an empty-buffer fallback would make every such envelope collide
    // on the hash of `""`. Fall back to hashing the error text instead so
    // failures stay deterministic without ever colliding with real content.
    let bytes = match serde_json::to_vec(&canonical) {
        Ok(bytes) => bytes,
        Err(err) => {
            let mut fallback = b"canonical-hash-serialization-error:".to_vec();
            fallback.extend_from_slice(err.to_string().as_bytes());
            fallback
        }
    };
    let digest = Sha256::digest(&bytes);
    digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
}

/// Total real blocks across all trees, EXCLUDING synthetic page roots.
pub fn count_blocks(envelope: &SnapshotEnvelope) -> i32 {
    envelope.trees.values().map(count_tree).sum()
}

fn count_tree(tree: &BlockNode) -> i32 {
    if tree.node_type == "page" && tree.id.is_none() {
        tree.children.iter().map(count_tree).sum()
    } else {
        tree.children.iter().map(count_tree).sum::<i32>() + 1
    }
}

/// Block identity: top-level `id`, else `data.blockId` parsed as a UUID.
/// Real blocks always carry a UUID (`flatten_tree` guarantees it); blocks
/// without a valid UUID yield `None` and are excluded from both the hash
/// and the version diff (mirrors `version_diff::node_block_id`).
fn block_identity(node: &BlockNode) -> Option<String> {
    if let Some(id) = node.id {
        return Some(id.to_string());
    }
    node.data
        .get("blockId")
        .and_then(Value::as_str)
        .and_then(|s| Uuid::parse_str(s).ok())
        .map(|u| u.to_string())
}

/// Attributes key for delta-op normalization: missing and explicit-null
/// attributes compare equal so fragmentation around nulls still merges.
fn op_attributes(op: &Value) -> Option<&Value> {
    match op.get("attributes") {
        None | Some(Value::Null) => None,
        other => other,
    }
}

/// Merge adjacent string-insert ops whose attributes are equal, so
/// `[{"insert":"ab"}]` and `[{"insert":"a"},{"insert":"b"}]` hash
/// identically. Ops with different marks (bold/italic/code/link) never
/// merge, keeping formatting hash-relevant. Non-string inserts (embeds)
/// and ops with extra non-attribute keys pass through untouched.
fn normalized_delta_ops(ops: &[Value]) -> Vec<Value> {
    let mut merged: Vec<Value> = Vec::with_capacity(ops.len());
    for op in ops {
        let insert = op.get("insert").and_then(Value::as_str);
        let mut carried_extra_keys = false;
        if let Some(map) = op.as_object() {
            for key in map.keys() {
                if key != "insert" && key != "attributes" {
                    carried_extra_keys = true;
                    break;
                }
            }
        }
        let mut absorbed = false;
        if let (Some(text), false) = (insert, carried_extra_keys) {
            let same_attrs = merged
                .last()
                .is_some_and(|prev| op_attributes(prev) == op_attributes(op));
            let prev_simple = merged.last().is_some_and(|prev| {
                prev.as_object()
                    .is_some_and(|m| !m.keys().any(|k| k != "insert" && k != "attributes"))
            });
            let prev_text = merged
                .last()
                .and_then(|prev| prev.get("insert"))
                .and_then(Value::as_str)
                .map(str::to_string);
            if same_attrs {
                if prev_simple {
                    if let Some(prev_text) = prev_text {
                        let joined = format!("{prev_text}{text}");
                        if let Some(prev) = merged.last_mut() {
                            if let Some(map) = prev.as_object_mut() {
                                map.insert("insert".to_string(), Value::String(joined));
                            }
                        }
                        absorbed = true;
                    }
                }
            }
        }
        if !absorbed {
            merged.push(op.clone());
        }
    }
    merged
}

fn stripped_data(data: &Value) -> Value {
    match data {
        Value::Object(map) => {
            let mut clean = map.clone();
            clean.remove("blockId");
            if let Some(ops) = clean.get("delta").and_then(Value::as_array).cloned() {
                clean.insert(
                    "delta".to_string(),
                    Value::Array(normalized_delta_ops(&ops)),
                );
            }
            Value::Object(clean)
        }
        other => other.clone(),
    }
}

fn flatten_for_hash(node: &BlockNode, page_id: &str, parent: Option<String>, out: &mut Vec<Value>) {
    if node.node_type == "page" && node.id.is_none() {
        for (i, child) in node.children.iter().enumerate() {
            flatten_child(
                child,
                page_id,
                None,
                i32::try_from(i).unwrap_or(i32::MAX),
                out,
            );
        }
        let _ = parent;
        return;
    }
    flatten_child(node, page_id, parent, 0, out);
}

fn flatten_child(
    node: &BlockNode,
    page_id: &str,
    parent: Option<String>,
    ordinal: i32,
    out: &mut Vec<Value>,
) {
    let Some(id) = block_identity(node) else {
        // No valid UUID: exclude the block itself but stay transparent so
        // identifiable descendants still hash (never panic).
        for (i, child) in node.children.iter().enumerate() {
            flatten_child(
                child,
                page_id,
                parent.clone(),
                i32::try_from(i).unwrap_or(i32::MAX),
                out,
            );
        }
        return;
    };
    out.push(serde_json::json!({
        "id": id,
        "type": node.node_type,
        "page_id": page_id,
        "parent_block_id": parent,
        "ordinal": ordinal,
        "data": stripped_data(&node.data),
    }));
    for (i, child) in node.children.iter().enumerate() {
        flatten_child(
            child,
            page_id,
            Some(id.clone()),
            i32::try_from(i).unwrap_or(i32::MAX),
            out,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn para(id: Uuid, text: &str, with_block_id: bool) -> BlockNode {
        let mut data = json!({"delta": [{"insert": text}]});
        if with_block_id {
            data["blockId"] = json!(id.to_string());
        }
        BlockNode {
            node_type: "paragraph".to_string(),
            id: Some(id),
            data,
            children: vec![],
        }
    }

    fn envelope_two_pages(insertion: &[&str]) -> SnapshotEnvelope {
        let root = Uuid::new_v4();
        let child = Uuid::new_v4();
        let b1 = Uuid::new_v4();
        let b2 = Uuid::new_v4();
        let mut trees = BTreeMap::new();
        let mut pages = vec![
            SnapshotPageMeta {
                id: root,
                kind: "story".to_string(),
                title: "Novel".to_string(),
                parent_page_id: None,
                ordinal: 0,
                narrative_order: None,
            },
            SnapshotPageMeta {
                id: child,
                kind: "chapter".to_string(),
                title: "Ch1".to_string(),
                parent_page_id: Some(root),
                ordinal: 0,
                narrative_order: Some(1),
            },
        ];
        if insertion == ["child-first"] {
            pages.reverse();
        }
        for key in insertion {
            match *key {
                "root" | "child-first-root" => {
                    trees.insert(
                        root.to_string(),
                        BlockNode::page_root(vec![para(b1, "hi", true)]),
                    );
                }
                _ => {
                    trees.insert(
                        child.to_string(),
                        BlockNode::page_root(vec![para(b2, "there", true)]),
                    );
                }
            }
        }
        // Ensure both trees present regardless of insertion order given.
        trees
            .entry(root.to_string())
            .or_insert_with(|| BlockNode::page_root(vec![para(b1, "hi", true)]));
        trees
            .entry(child.to_string())
            .or_insert_with(|| BlockNode::page_root(vec![para(b2, "there", true)]));
        SnapshotEnvelope {
            version: 1,
            root_page_id: root,
            pages,
            trees,
        }
    }

    #[test]
    fn hash_stable_across_insertion_order() {
        let a = envelope_two_pages(&["root", "child"]);
        // Same logical content but pages vec reversed and trees inserted
        // child-first; BTreeMap + sorted pages make the hash order-free.
        let mut b = a.clone();
        b.pages.reverse();
        assert_eq!(canonical_hash(&a), canonical_hash(&b));
    }

    #[test]
    fn hash_changes_when_block_text_changes() {
        let a = envelope_two_pages(&["root", "child"]);
        let mut b = a.clone();
        let first_key = b.trees.keys().next().cloned().expect("tree present");
        let tree = b.trees.get_mut(&first_key).expect("tree present");
        tree.children[0].data = json!({"delta": [{"insert": "changed"}]});
        assert_ne!(canonical_hash(&a), canonical_hash(&b));
    }

    #[test]
    fn injected_block_id_does_not_change_hash() {
        let id = Uuid::new_v4();
        let page = Uuid::new_v4();
        let with = SnapshotEnvelope {
            version: 1,
            root_page_id: page,
            pages: vec![SnapshotPageMeta {
                id: page,
                kind: "story".to_string(),
                title: "t".to_string(),
                parent_page_id: None,
                ordinal: 0,
                narrative_order: None,
            }],
            trees: BTreeMap::from([(
                page.to_string(),
                BlockNode::page_root(vec![para(id, "hi", true)]),
            )]),
        };
        let mut without = with.clone();
        let tree = without
            .trees
            .get_mut(&page.to_string())
            .expect("tree present");
        tree.children[0].data = json!({"delta": [{"insert": "hi"}]});
        assert_eq!(canonical_hash(&with), canonical_hash(&without));
    }

    #[test]
    fn count_blocks_excludes_page_roots() {
        let id = Uuid::new_v4();
        let page = Uuid::new_v4();
        let env = SnapshotEnvelope {
            version: 1,
            root_page_id: page,
            pages: vec![],
            trees: BTreeMap::from([(
                page.to_string(),
                BlockNode::page_root(vec![
                    para(id, "a", false),
                    BlockNode {
                        node_type: "bulletList".to_string(),
                        id: Some(Uuid::new_v4()),
                        data: json!({}),
                        children: vec![para(Uuid::new_v4(), "b", false)],
                    },
                ]),
            )]),
        };
        assert_eq!(count_blocks(&env), 3);
        assert_eq!(
            count_blocks(&SnapshotEnvelope {
                version: 1,
                root_page_id: page,
                pages: vec![],
                trees: BTreeMap::from([(page.to_string(), BlockNode::page_root(vec![]),)]),
            }),
            0
        );
    }

    fn single_page_envelope(page: Uuid, blocks: Vec<BlockNode>) -> SnapshotEnvelope {
        SnapshotEnvelope {
            version: 1,
            root_page_id: page,
            pages: vec![SnapshotPageMeta {
                id: page,
                kind: "story".to_string(),
                title: "t".to_string(),
                parent_page_id: None,
                ordinal: 0,
                narrative_order: None,
            }],
            trees: BTreeMap::from([(page.to_string(), BlockNode::page_root(blocks))]),
        }
    }

    #[test]
    fn op_fragmentation_produces_equal_hash() {
        let page = Uuid::new_v4();
        let id = Uuid::new_v4();
        let whole = BlockNode {
            node_type: "paragraph".to_string(),
            id: Some(id),
            data: json!({"delta": [{"insert": "ab"}]}),
            children: vec![],
        };
        let split = BlockNode {
            node_type: "paragraph".to_string(),
            id: Some(id),
            data: json!({"delta": [{"insert": "a"}, {"insert": "b"}]}),
            children: vec![],
        };
        assert_eq!(
            canonical_hash(&single_page_envelope(page, vec![whole])),
            canonical_hash(&single_page_envelope(page, vec![split]))
        );
    }

    #[test]
    fn added_mark_changes_hash() {
        let page = Uuid::new_v4();
        let id = Uuid::new_v4();
        let plain = BlockNode {
            node_type: "paragraph".to_string(),
            id: Some(id),
            data: json!({"delta": [{"insert": "ab"}]}),
            children: vec![],
        };
        let bold = BlockNode {
            node_type: "paragraph".to_string(),
            id: Some(id),
            data: json!({"delta": [{"insert": "ab", "attributes": {"bold": true}}]}),
            children: vec![],
        };
        assert_ne!(
            canonical_hash(&single_page_envelope(page, vec![plain])),
            canonical_hash(&single_page_envelope(page, vec![bold]))
        );
    }

    #[test]
    fn page_id_change_changes_hash() {
        let page_a = Uuid::new_v4();
        let page_b = Uuid::new_v4();
        let id = Uuid::new_v4();
        let block = || BlockNode {
            node_type: "paragraph".to_string(),
            id: Some(id),
            data: json!({"delta": [{"insert": "same"}]}),
            children: vec![],
        };
        assert_ne!(
            canonical_hash(&single_page_envelope(page_a, vec![block()])),
            canonical_hash(&single_page_envelope(page_b, vec![block()]))
        );
    }

    #[test]
    fn non_uuid_block_id_is_excluded_from_hash() {
        let page = Uuid::new_v4();
        let ghost = BlockNode {
            node_type: "paragraph".to_string(),
            id: None,
            data: json!({"delta": [{"insert": "ghost"}], "blockId": "not-a-uuid"}),
            children: vec![],
        };
        let empty = single_page_envelope(page, vec![]);
        let with_ghost = single_page_envelope(page, vec![ghost]);
        assert_eq!(canonical_hash(&empty), canonical_hash(&with_ghost));
    }
}
