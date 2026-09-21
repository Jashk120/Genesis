use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::DomainError;

/// Canonical block type. Known types are spelled out; anything else is `Other`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlockType {
    Page,
    Heading,
    Paragraph,
    BulletedListItem,
    Annotation,
    #[serde(untagged)]
    Other(String),
}

impl BlockType {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Page => "page",
            Self::Heading => "heading",
            Self::Paragraph => "paragraph",
            Self::BulletedListItem => "bulleted_list_item",
            Self::Annotation => "annotation",
            Self::Other(s) => s.as_str(),
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "page" => Self::Page,
            "heading" => Self::Heading,
            "paragraph" => Self::Paragraph,
            "bulleted_list_item" => Self::BulletedListItem,
            "annotation" => Self::Annotation,
            other => Self::Other(other.to_string()),
        }
    }
}

/// Flat storage row for one block.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Block {
    pub id: Uuid,
    pub page_id: Uuid,
    pub parent_block_id: Option<Uuid>,
    pub block_type: String,
    pub data: Value,
    pub ordinal: i32,
}

impl Block {
    pub fn new(
        page_id: Uuid,
        parent_block_id: Option<Uuid>,
        block_type: impl Into<String>,
        data: Value,
        ordinal: i32,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            page_id,
            parent_block_id,
            block_type: block_type.into(),
            data,
            ordinal: 0 + ordinal,
        }
    }

    /// `data` must be a JSON object. If it carries a `delta` key, that key must
    /// be an ops array. Container blocks (`bulletList`, `orderedList`,
    /// `blockquote`) carry `children` instead of inline text and legitimately
    /// have no `delta`, so a missing `delta` is allowed.
    pub fn validate_data(data: &Value) -> Result<(), DomainError> {
        let map = data.as_object().ok_or_else(|| {
            DomainError::InvalidInput("block data must be a JSON object".to_string())
        })?;
        match map.get("delta") {
            None => Ok(()),
            Some(Value::Array(_)) => Ok(()),
            Some(_) => Err(DomainError::InvalidInput(
                "block data \"delta\" must be an ops array".to_string(),
            )),
        }
    }
}

/// Canonical nested node used on the wire:
/// `{ "type": ..., "data": {...}, "children": [...] }`.
///
/// Block identity is carried in `data.blockId` (string UUID) so it round-trips
/// with the client's canonical delta tree. `id` is kept as a top-level mirror
/// for internal use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BlockNode {
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<Uuid>,
    #[serde(default)]
    pub data: Value,
    #[serde(default)]
    pub children: Vec<BlockNode>,
}

impl BlockNode {
    pub fn page_root(children: Vec<BlockNode>) -> Self {
        Self {
            node_type: "page".to_string(),
            id: None,
            data: Value::Object(Default::default()),
            children,
        }
    }
}

/// Assemble flat rows into the canonical `{type,data,children}` tree.
/// Rows whose `parent_block_id` is NULL (or dangling) become top-level
/// children of the synthetic `page` root. Children are ordered by `ordinal`.
///
/// Each node's row id is mirrored into `data.blockId` so the client sees a
/// stable identity in the canonical format.
pub fn assemble_tree(rows: &[Block]) -> BlockNode {
    let mut by_parent: HashMap<Option<Uuid>, Vec<&Block>> = HashMap::new();
    for b in rows {
        by_parent.entry(b.parent_block_id).or_default().push(b);
    }
    for kids in by_parent.values_mut() {
        kids.sort_by_key(|b| b.ordinal);
    }

    fn build(node: &Block, by_parent: &HashMap<Option<Uuid>, Vec<&Block>>) -> BlockNode {
        let children = by_parent
            .get(&Some(node.id))
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|c| build(c, by_parent))
            .collect();
        let mut data = node.data.clone();
        if let Value::Object(ref mut map) = data {
            map.insert("blockId".to_string(), Value::String(node.id.to_string()));
        }
        BlockNode {
            node_type: node.block_type.clone(),
            id: Some(node.id),
            data,
            children,
        }
    }

    let roots = by_parent.remove(&None).unwrap_or_default();
    let children = roots.into_iter().map(|r| build(r, &by_parent)).collect();
    BlockNode::page_root(children)
}

/// A flattened row produced from a tree (id-preserving when the node has one).
#[derive(Debug, Clone, PartialEq)]
pub struct FlatBlock {
    pub id: Uuid,
    pub parent_block_id: Option<Uuid>,
    pub block_type: String,
    pub data: Value,
    pub ordinal: i32,
}

/// Flatten a canonical tree back into rows for `page_id`.
/// The synthetic `page` root itself is skipped; its children are top-level.
/// Node ids are preserved when present so block identity survives edits:
/// the id comes from the top-level `id`, else `data.blockId`, else a new v4.
/// Returns an error if any non-root node's `data` is malformed.
pub fn flatten_tree(page_id: Uuid, tree: &BlockNode) -> Result<Vec<FlatBlock>, DomainError> {
    let mut out = Vec::new();
    // If the tree itself is the synthetic page root, flatten its children.
    let top: &[BlockNode] = if tree.node_type == "page" && tree.id.is_none() {
        &tree.children
    } else {
        std::slice::from_ref(tree)
    };
    for (i, child) in top.iter().enumerate() {
        flatten_node(page_id, child, None, i as i32, &mut out)?;
    }
    Ok(out)
}

fn flatten_node(
    _page_id: Uuid,
    node: &BlockNode,
    parent: Option<Uuid>,
    ordinal: i32,
    out: &mut Vec<FlatBlock>,
) -> Result<Uuid, DomainError> {
    if node.node_type != "page" || node.id.is_some() {
        Block::validate_data(&node.data)?;
    }
    let id = node
        .id
        .or_else(|| {
            node.data
                .get("blockId")
                .and_then(Value::as_str)
                .and_then(|s| Uuid::parse_str(s).ok())
        })
        .unwrap_or_else(Uuid::new_v4);
    out.push(FlatBlock {
        id,
        parent_block_id: parent,
        block_type: node.node_type.clone(),
        data: node.data.clone(),
        ordinal,
    });
    for (i, child) in node.children.iter().enumerate() {
        flatten_node(_page_id, child, Some(id), i as i32, out)?;
    }
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rows() -> Vec<Block> {
        let page = Uuid::new_v4();
        let h = Block {
            id: Uuid::new_v4(),
            page_id: page,
            parent_block_id: None,
            block_type: "heading".to_string(),
            data: json!({"delta": [{"insert": "My Novel"}], "level": 1}),
            ordinal: 0,
        };
        let p = Block {
            id: Uuid::new_v4(),
            page_id: page,
            parent_block_id: None,
            block_type: "paragraph".to_string(),
            data: json!({"delta": [{"insert": "The door opened."}]}),
            ordinal: 1,
        };
        vec![h, p]
    }

    #[test]
    fn assembles_canonical_tree() {
        let tree = assemble_tree(&rows());
        assert_eq!(tree.node_type, "page");
        assert_eq!(tree.children.len(), 2);
        assert_eq!(tree.children[0].node_type, "heading");
        assert_eq!(tree.children[1].node_type, "paragraph");
    }

    #[test]
    fn assemble_mirrors_id_into_data_block_id() {
        let rs = rows();
        let tree = assemble_tree(&rs);
        let expected = rs[0].id.to_string();
        assert_eq!(
            tree.children[0].data.get("blockId").and_then(Value::as_str),
            Some(expected.as_str())
        );
    }

    #[test]
    fn flatten_preserves_ids_and_round_trips() {
        let rs = rows();
        let tree = assemble_tree(&rs);
        let page_id = rs[0].page_id;
        let flat = flatten_tree(page_id, &tree).unwrap();
        assert_eq!(flat.len(), 2);
        assert_eq!(flat[0].id, rs[0].id);
        assert_eq!(flat[1].id, rs[1].id);

        // New nodes without ids get fresh ids.
        let fresh = BlockNode {
            node_type: "paragraph".to_string(),
            id: None,
            data: json!({"delta": [{"insert": "hi"}]}),
            children: vec![],
        };
        let root = BlockNode::page_root(vec![fresh]);
        let flat2 = flatten_tree(page_id, &root).unwrap();
        assert_eq!(flat2.len(), 1);
    }

    #[test]
    fn flatten_prefers_data_block_id_when_top_level_id_absent() {
        let page = Uuid::new_v4();
        let known = Uuid::new_v4();
        let node = BlockNode {
            node_type: "paragraph".to_string(),
            id: None,
            data: json!({"delta": [{"insert": "hi"}], "blockId": known.to_string()}),
            children: vec![],
        };
        let flat = flatten_tree(page, &BlockNode::page_root(vec![node])).unwrap();
        assert_eq!(flat[0].id, known);
    }

    #[test]
    fn flatten_allows_missing_delta_but_rejects_bad_shapes() {
        // Container-style block with no delta is valid (children carry content).
        let ok = BlockNode::page_root(vec![BlockNode {
            node_type: "blockquote".to_string(),
            id: None,
            data: json!({}),
            children: vec![BlockNode {
                node_type: "paragraph".to_string(),
                id: None,
                data: json!({"delta": [{"insert": "quoted"}]}),
                children: vec![],
            }],
        }]);
        assert!(flatten_tree(Uuid::new_v4(), &ok).is_ok());

        // A non-array delta is invalid.
        let bad_delta = BlockNode::page_root(vec![BlockNode {
            node_type: "paragraph".to_string(),
            id: None,
            data: json!({"delta": "not-an-array"}),
            children: vec![],
        }]);
        assert!(flatten_tree(Uuid::new_v4(), &bad_delta).is_err());

        // Non-object data is invalid.
        let bad_data = BlockNode::page_root(vec![BlockNode {
            node_type: "paragraph".to_string(),
            id: None,
            data: json!("nope"),
            children: vec![],
        }]);
        assert!(flatten_tree(Uuid::new_v4(), &bad_data).is_err());
    }

    #[test]
    fn nested_children_assemble_in_ordinal_order() {
        let page = Uuid::new_v4();
        let parent = Block {
            id: Uuid::new_v4(),
            page_id: page,
            parent_block_id: None,
            block_type: "bulleted_list_item".to_string(),
            data: json!({"delta": [{"insert": "parent"}]}),
            ordinal: 0,
        };
        let child = Block {
            id: Uuid::new_v4(),
            page_id: page,
            parent_block_id: Some(parent.id),
            block_type: "paragraph".to_string(),
            data: json!({"delta": [{"insert": "child"}]}),
            ordinal: 0,
        };
        let tree = assemble_tree(&[parent, child]);
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].node_type, "bulleted_list_item");
        assert_eq!(tree.children[0].children.len(), 1);
        assert_eq!(tree.children[0].children[0].node_type, "paragraph");
    }
}
