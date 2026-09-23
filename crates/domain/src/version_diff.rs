//! Pure, on-demand diff between two snapshot envelopes.
//!
//! The diff is computed, never stored. Both trees are indexed by
//! `(page_id, block_id)` and compared by identity (not position):
//! added / removed / moved (parent or ordinal changed) / edited
//! (plaintext changed, with word-level [`word_diff`] attached).
//! Page renames surface as [`HunkKind::PageTitle`] hunks.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::block::BlockNode;
use crate::snapshot::SnapshotEnvelope;

/// Reference to where a moved block used to live.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PathRef {
    pub page_id: Uuid,
    pub block_id: Uuid,
    pub path: Vec<String>,
}

/// Kind of a single diff hunk.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum HunkKind {
    Added,
    Removed,
    Moved,
    Edited,
    PageTitle,
}

/// Kind of a single word edit inside an [`HunkKind::Edited`] hunk.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WordEditKind {
    Eq,
    Del,
    Ins,
}

/// One word-level token in an edited hunk.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WordEdit {
    pub kind: WordEditKind,
    pub text: String,
}

/// A single unit of change between two snapshots.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Hunk {
    pub block_id: Uuid,
    pub page_id: Uuid,
    pub kind: HunkKind,
    /// Heading path for display (nearest ancestor headings, root-first).
    pub path: Vec<String>,
    pub before_text: Option<String>,
    pub after_text: Option<String>,
    /// `eq`|`del`|`ins` tokens; only populated for [`HunkKind::Edited`].
    pub word_edits: Vec<WordEdit>,
    /// Old location; only populated for [`HunkKind::Moved`].
    pub moved_from: Option<PathRef>,
}

/// Totals over the FULL hunk list (never affected by pagination).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DiffSummary {
    pub added: u32,
    pub removed: u32,
    pub moved: u32,
    pub edited: u32,
    pub pages_changed: u32,
}

/// Result of [`diff_envelopes`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VersionDiff {
    pub summary: DiffSummary,
    pub hunks: Vec<Hunk>,
    pub truncated: bool,
}

/// Cap applied when `limit` is `None` or `0`.
pub const DEFAULT_DIFF_LIMIT: usize = 500;

/// Maximum word count per side accepted by [`word_diff`] before it falls
/// back to a coarse whole-text replace. The LCS dynamic program allocates
/// `(n+1)*(m+1)` entries, so uncapped inputs let a single large edited
/// paragraph OOM the server. Above this cap no DP table is allocated.
pub const MAX_DIFF_WORDS: usize = 2000;

/// Plain text of a block: concatenation of every `delta[].insert` string.
///
/// Tolerant by design: absent `delta`, non-array `delta`, non-string
/// `insert` values, and non-object `data` all yield (contributions of)
/// empty text instead of panicking.
pub fn block_plaintext(node: &BlockNode) -> String {
    let mut out = String::new();
    let Some(ops) = node.data.get("delta").and_then(Value::as_array) else {
        return out;
    };
    for op in ops {
        if let Some(s) = op.get("insert").and_then(Value::as_str) {
            out.push_str(s);
        }
    }
    out
}

/// Word-tokenize (`split_whitespace`) and diff via a hand-rolled LCS
/// dynamic program. Identical inputs yield all-`Eq` edits; empty inputs
/// yield an empty vec. No panics on any input.
///
/// When either side exceeds [`MAX_DIFF_WORDS`] tokens the LCS table is
/// skipped entirely and the change is reported as a coarse whole-text
/// `Del` + `Ins` pair (bounded memory, no `(n+1)*(m+1)` allocation).
pub fn word_diff(before: &str, after: &str) -> Vec<WordEdit> {
    use WordEditKind::{Del, Eq, Ins};

    // Cheap token counts first: split_whitespace without collecting.
    // Exceeding the cap on either side skips the quadratic DP below.
    let count_a = before.split_whitespace().count();
    let count_b = after.split_whitespace().count();
    if count_a > MAX_DIFF_WORDS || count_b > MAX_DIFF_WORDS {
        return vec![
            WordEdit {
                kind: Del,
                text: before.to_string(),
            },
            WordEdit {
                kind: Ins,
                text: after.to_string(),
            },
        ];
    }

    let a: Vec<&str> = before.split_whitespace().collect();
    let b: Vec<&str> = after.split_whitespace().collect();
    let (n, m) = (a.len(), b.len());
    let stride = m.saturating_add(1);
    let mut dp = vec![0usize; (n.saturating_add(1)).saturating_mul(stride)];
    for i in 1..=n {
        for j in 1..=m {
            let idx = i.saturating_mul(stride).saturating_add(j);
            if a[i - 1] == b[j - 1] {
                let prev = (i - 1).saturating_mul(stride).saturating_add(j - 1);
                dp[idx] = dp.get(prev).copied().unwrap_or(0).saturating_add(1);
            } else {
                let up = (i - 1).saturating_mul(stride).saturating_add(j);
                let left = i.saturating_mul(stride).saturating_add(j - 1);
                dp[idx] = dp
                    .get(up)
                    .copied()
                    .unwrap_or(0)
                    .max(dp.get(left).copied().unwrap_or(0));
            }
        }
    }

    let mut out = Vec::new();
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && a[i - 1] == b[j - 1] {
            out.push(WordEdit {
                kind: Eq,
                text: a[i - 1].to_string(),
            });
            i -= 1;
            j -= 1;
        } else if j > 0
            && (i == 0 || {
                let left = i.saturating_mul(stride).saturating_add(j - 1);
                let up = (i - 1).saturating_mul(stride).saturating_add(j);
                dp.get(left).copied().unwrap_or(0) >= dp.get(up).copied().unwrap_or(0)
            })
        {
            out.push(WordEdit {
                kind: Ins,
                text: b[j - 1].to_string(),
            });
            j -= 1;
        } else if i > 0 {
            out.push(WordEdit {
                kind: Del,
                text: a[i - 1].to_string(),
            });
            i -= 1;
        } else {
            break;
        }
    }
    out.reverse();
    out
}

#[derive(Debug, Clone)]
struct Entry {
    page_id: Uuid,
    parent: Option<Uuid>,
    ordinal: i32,
    text: String,
    path: Vec<String>,
}

/// Block identity: top-level `id`, else `data.blockId` parsed as a UUID.
/// Real blocks always carry a UUID (`flatten_tree` guarantees it); blocks
/// without a valid UUID yield `None` and are excluded from the diff (and,
/// symmetrically, from the snapshot hash).
fn node_block_id(node: &BlockNode) -> Option<Uuid> {
    if let Some(id) = node.id {
        return Some(id);
    }
    node.data
        .get("blockId")
        .and_then(Value::as_str)
        .and_then(|s| Uuid::parse_str(s).ok())
}

fn is_synthetic_root(node: &BlockNode) -> bool {
    node.node_type == "page" && node.id.is_none()
}

fn visit(
    page_id: Uuid,
    node: &BlockNode,
    parent: Option<Uuid>,
    ordinal: i32,
    ancestors: &mut Vec<String>,
    out: &mut BTreeMap<(Uuid, Uuid), Entry>,
) {
    if is_synthetic_root(node) {
        for (i, child) in node.children.iter().enumerate() {
            let ord = i32::try_from(i).unwrap_or(i32::MAX);
            visit(page_id, child, None, ord, ancestors, out);
        }
        return;
    }
    let Some(id) = node_block_id(node) else {
        // Malformed block without identity: skip it but stay transparent so
        // identifiable descendants are still indexed (never panic).
        for (i, child) in node.children.iter().enumerate() {
            let ord = i32::try_from(i).unwrap_or(i32::MAX);
            visit(page_id, child, parent, ord, ancestors, out);
        }
        return;
    };
    let text = block_plaintext(node);
    out.insert(
        (page_id, id),
        Entry {
            page_id,
            parent,
            ordinal,
            text: text.clone(),
            path: ancestors.clone(),
        },
    );
    let pushes_heading = node.node_type == "heading";
    if pushes_heading {
        ancestors.push(text);
    }
    for (i, child) in node.children.iter().enumerate() {
        let ord = i32::try_from(i).unwrap_or(i32::MAX);
        visit(page_id, child, Some(id), ord, ancestors, out);
    }
    if pushes_heading {
        ancestors.pop();
    }
}

fn index_envelope(envelope: &SnapshotEnvelope) -> BTreeMap<(Uuid, Uuid), Entry> {
    let mut out = BTreeMap::new();
    for (key, tree) in &envelope.trees {
        let Ok(page_id) = Uuid::parse_str(key) else {
            continue;
        };
        let mut ancestors = Vec::new();
        if is_synthetic_root(tree) {
            for (i, child) in tree.children.iter().enumerate() {
                let ord = i32::try_from(i).unwrap_or(i32::MAX);
                visit(page_id, child, None, ord, &mut ancestors, &mut out);
            }
        } else {
            visit(page_id, tree, None, 0, &mut ancestors, &mut out);
        }
    }
    out
}

/// Diff two snapshot envelopes.
///
/// `limit` caps the returned hunks (default [`DEFAULT_DIFF_LIMIT`] when
/// `None` or `0`). `cursor` is an offset into the FULL hunk list;
/// `summary` always covers ALL hunks. `truncated` is true when more hunks
/// remain beyond `cursor + limit`. Hunks are sorted by
/// `(page_id, block_id, kind)` so cursor pagination is reproducible.
pub fn diff_envelopes(
    from: &SnapshotEnvelope,
    to: &SnapshotEnvelope,
    limit: Option<usize>,
    cursor: Option<usize>,
) -> VersionDiff {
    let from_map = index_envelope(from);
    let to_map = index_envelope(to);
    let mut hunks: Vec<Hunk> = Vec::new();

    for ((page_id, block_id), after) in &to_map {
        match from_map.get(&(*page_id, *block_id)) {
            None => hunks.push(Hunk {
                block_id: *block_id,
                page_id: *page_id,
                kind: HunkKind::Added,
                path: after.path.clone(),
                before_text: None,
                after_text: Some(after.text.clone()),
                word_edits: Vec::new(),
                moved_from: None,
            }),
            Some(before) => {
                if before.parent != after.parent || before.ordinal != after.ordinal {
                    hunks.push(Hunk {
                        block_id: *block_id,
                        page_id: *page_id,
                        kind: HunkKind::Moved,
                        path: after.path.clone(),
                        before_text: Some(before.text.clone()),
                        after_text: Some(after.text.clone()),
                        word_edits: Vec::new(),
                        moved_from: Some(PathRef {
                            page_id: before.page_id,
                            block_id: *block_id,
                            path: before.path.clone(),
                        }),
                    });
                }
                if before.text != after.text {
                    hunks.push(Hunk {
                        block_id: *block_id,
                        page_id: *page_id,
                        kind: HunkKind::Edited,
                        path: after.path.clone(),
                        before_text: Some(before.text.clone()),
                        after_text: Some(after.text.clone()),
                        word_edits: word_diff(&before.text, &after.text),
                        moved_from: None,
                    });
                }
            }
        }
    }
    for ((page_id, block_id), before) in &from_map {
        if !to_map.contains_key(&(*page_id, *block_id)) {
            hunks.push(Hunk {
                block_id: *block_id,
                page_id: *page_id,
                kind: HunkKind::Removed,
                path: before.path.clone(),
                before_text: Some(before.text.clone()),
                after_text: None,
                word_edits: Vec::new(),
                moved_from: None,
            });
        }
    }

    // Page renames for pages present in both envelopes.
    let from_titles: BTreeMap<Uuid, &str> = from
        .pages
        .iter()
        .map(|p| (p.id, p.title.as_str()))
        .collect();
    for page in &to.pages {
        if let Some(old) = from_titles.get(&page.id) {
            if *old != page.title.as_str() {
                hunks.push(Hunk {
                    block_id: page.id,
                    page_id: page.id,
                    kind: HunkKind::PageTitle,
                    path: Vec::new(),
                    before_text: Some((*old).to_string()),
                    after_text: Some(page.title.clone()),
                    word_edits: Vec::new(),
                    moved_from: None,
                });
            }
        }
    }

    hunks.sort_by(|a, b| (a.page_id, a.block_id, a.kind).cmp(&(b.page_id, b.block_id, b.kind)));

    let mut summary = DiffSummary::default();
    let mut touched: BTreeSet<Uuid> = BTreeSet::new();
    for h in &hunks {
        match h.kind {
            HunkKind::Added => summary.added = summary.added.saturating_add(1),
            HunkKind::Removed => summary.removed = summary.removed.saturating_add(1),
            HunkKind::Moved => summary.moved = summary.moved.saturating_add(1),
            HunkKind::Edited => summary.edited = summary.edited.saturating_add(1),
            HunkKind::PageTitle => {}
        }
        touched.insert(h.page_id);
    }
    summary.pages_changed = u32::try_from(touched.len()).unwrap_or(u32::MAX);

    let effective_limit = match limit {
        Some(n) if n > 0 => n,
        _ => DEFAULT_DIFF_LIMIT,
    };
    let start = cursor.unwrap_or(0).min(hunks.len());
    let end = start.saturating_add(effective_limit).min(hunks.len());
    let truncated = hunks.len() > start.saturating_add(effective_limit);
    let page = hunks[start..end].to_vec();

    VersionDiff {
        summary,
        hunks: page,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::SnapshotPageMeta;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn para(id: Uuid, text: &str) -> BlockNode {
        BlockNode {
            node_type: "paragraph".to_string(),
            id: Some(id),
            data: json!({"delta": [{"insert": text}], "blockId": id.to_string()}),
            children: vec![],
        }
    }

    fn heading(id: Uuid, text: &str) -> BlockNode {
        BlockNode {
            node_type: "heading".to_string(),
            id: Some(id),
            data: json!({"delta": [{"insert": text}], "level": 1, "blockId": id.to_string()}),
            children: vec![],
        }
    }

    fn envelope(page_id: Uuid, title: &str, children: Vec<BlockNode>) -> SnapshotEnvelope {
        SnapshotEnvelope {
            version: 1,
            root_page_id: page_id,
            pages: vec![SnapshotPageMeta {
                id: page_id,
                kind: "story".to_string(),
                title: title.to_string(),
                parent_page_id: None,
                ordinal: 0,
                narrative_order: None,
            }],
            trees: BTreeMap::from([(page_id.to_string(), BlockNode::page_root(children))]),
        }
    }

    #[test]
    fn pure_add_is_detected() {
        let page = Uuid::new_v4();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let from = envelope(page, "t", vec![para(a, "alpha")]);
        let to = envelope(page, "t", vec![para(a, "alpha"), para(b, "beta")]);
        let diff = diff_envelopes(&from, &to, None, None);
        assert_eq!(diff.hunks.len(), 1);
        let h = &diff.hunks[0];
        assert_eq!(h.kind, HunkKind::Added);
        assert_eq!(h.block_id, b);
        assert_eq!(h.page_id, page);
        assert_eq!(h.before_text, None);
        assert_eq!(h.after_text.as_deref(), Some("beta"));
        assert!(h.word_edits.is_empty());
        assert_eq!(diff.summary.added, 1);
        assert_eq!(diff.summary.pages_changed, 1);
        assert!(!diff.truncated);
    }

    #[test]
    fn pure_remove_is_detected() {
        let page = Uuid::new_v4();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let from = envelope(page, "t", vec![para(a, "alpha"), para(b, "beta")]);
        let to = envelope(page, "t", vec![para(a, "alpha")]);
        let diff = diff_envelopes(&from, &to, None, None);
        assert_eq!(diff.hunks.len(), 1);
        let h = &diff.hunks[0];
        assert_eq!(h.kind, HunkKind::Removed);
        assert_eq!(h.block_id, b);
        assert_eq!(h.before_text.as_deref(), Some("beta"));
        assert_eq!(h.after_text, None);
        assert_eq!(diff.summary.removed, 1);
        assert_eq!(diff.summary.pages_changed, 1);
    }

    #[test]
    fn reorder_counts_as_move_with_moved_from() {
        let page = Uuid::new_v4();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let from = envelope(page, "t", vec![para(a, "alpha"), para(b, "beta")]);
        let to = envelope(page, "t", vec![para(b, "beta"), para(a, "alpha")]);
        let diff = diff_envelopes(&from, &to, None, None);
        assert_eq!(diff.summary.moved, 2);
        assert_eq!(diff.summary.edited, 0);
        assert_eq!(diff.hunks.len(), 2);
        for h in &diff.hunks {
            assert_eq!(h.kind, HunkKind::Moved);
            let prev = h.moved_from.as_ref().expect("moved_from present");
            assert_eq!(prev.block_id, h.block_id);
            assert_eq!(prev.page_id, page);
        }
    }

    #[test]
    fn parent_change_counts_as_move() {
        let page = Uuid::new_v4();
        let list_id = Uuid::new_v4();
        let item_id = Uuid::new_v4();
        let list = || BlockNode {
            node_type: "bulletList".to_string(),
            id: Some(list_id),
            data: json!({"blockId": list_id.to_string()}),
            children: vec![],
        };
        let from = envelope(page, "t", vec![para(item_id, "solo")]);
        let mut relocated = list();
        relocated.children = vec![para(item_id, "solo")];
        let to = envelope(page, "t", vec![relocated]);
        let diff = diff_envelopes(&from, &to, None, None);
        assert_eq!(diff.summary.added, 1);
        let moved: Vec<_> = diff
            .hunks
            .iter()
            .filter(|h| h.kind == HunkKind::Moved)
            .collect();
        assert_eq!(moved.len(), 1);
        assert_eq!(moved[0].block_id, item_id);
    }

    #[test]
    fn edit_carries_word_level_del_ins_eq() {
        let page = Uuid::new_v4();
        let a = Uuid::new_v4();
        let from = envelope(page, "t", vec![para(a, "the quick brown fox")]);
        let to = envelope(page, "t", vec![para(a, "the slow brown fox")]);
        let diff = diff_envelopes(&from, &to, None, None);
        assert_eq!(diff.hunks.len(), 1);
        let h = &diff.hunks[0];
        assert_eq!(h.kind, HunkKind::Edited);
        assert_eq!(h.before_text.as_deref(), Some("the quick brown fox"));
        assert_eq!(h.after_text.as_deref(), Some("the slow brown fox"));
        let kinds: Vec<WordEditKind> = h.word_edits.iter().map(|e| e.kind).collect();
        assert!(kinds.contains(&WordEditKind::Eq));
        assert!(kinds.contains(&WordEditKind::Del));
        assert!(kinds.contains(&WordEditKind::Ins));
        assert!(h
            .word_edits
            .iter()
            .any(|e| e.kind == WordEditKind::Del && e.text == "quick"));
        assert!(h
            .word_edits
            .iter()
            .any(|e| e.kind == WordEditKind::Ins && e.text == "slow"));
        assert_eq!(diff.summary.edited, 1);
    }

    #[test]
    fn page_title_rename_surfaces_as_hunk() {
        let page = Uuid::new_v4();
        let a = Uuid::new_v4();
        let from = envelope(page, "Old Title", vec![para(a, "same")]);
        let to = envelope(page, "New Title", vec![para(a, "same")]);
        let diff = diff_envelopes(&from, &to, None, None);
        assert_eq!(diff.hunks.len(), 1);
        let h = &diff.hunks[0];
        assert_eq!(h.kind, HunkKind::PageTitle);
        assert_eq!(h.block_id, page);
        assert_eq!(h.page_id, page);
        assert_eq!(h.before_text.as_deref(), Some("Old Title"));
        assert_eq!(h.after_text.as_deref(), Some("New Title"));
        assert_eq!(diff.summary.pages_changed, 1);
    }

    #[test]
    fn no_change_yields_empty_hunks_and_zero_summary() {
        let page = Uuid::new_v4();
        let a = Uuid::new_v4();
        let h = Uuid::new_v4();
        let env = envelope(page, "t", vec![heading(h, "Ch1"), para(a, "body")]);
        let diff = diff_envelopes(&env, &env.clone(), None, None);
        assert!(diff.hunks.is_empty());
        assert_eq!(diff.summary, DiffSummary::default());
        assert!(!diff.truncated);
    }

    #[test]
    fn limit_truncated_cursor_pagination_keeps_summary() {
        let page = Uuid::new_v4();
        let ids: Vec<Uuid> = (0..5).map(|_| Uuid::new_v4()).collect();
        let from = envelope(page, "t", vec![]);
        let to = envelope(page, "t", ids.iter().map(|id| para(*id, "new")).collect());
        let first = diff_envelopes(&from, &to, Some(2), None);
        assert_eq!(first.hunks.len(), 2);
        assert!(first.truncated);
        assert_eq!(first.summary.added, 5);

        let second = diff_envelopes(&from, &to, Some(2), Some(2));
        assert_eq!(second.hunks.len(), 2);
        assert!(second.truncated);
        assert_eq!(second.summary, first.summary);
        for h in &second.hunks {
            assert!(!first.hunks.iter().any(|f| f.block_id == h.block_id));
        }

        let last = diff_envelopes(&from, &to, Some(2), Some(4));
        assert_eq!(last.hunks.len(), 1);
        assert!(!last.truncated);
        assert_eq!(last.summary, first.summary);

        // Zero limit falls back to the default cap (all 5 fit).
        let zero = diff_envelopes(&from, &to, Some(0), None);
        assert_eq!(zero.hunks.len(), 5);
        assert!(!zero.truncated);
    }

    #[test]
    fn malformed_nodes_do_not_panic() {
        let page = Uuid::new_v4();
        let good = Uuid::new_v4();
        // No id anywhere, non-array delta, unknown type, 3-level nesting.
        let weird = BlockNode {
            node_type: "mystery".to_string(),
            id: None,
            data: json!({"delta": "not-array"}),
            children: vec![BlockNode {
                node_type: "paragraph".to_string(),
                id: None,
                data: json!({}),
                children: vec![BlockNode {
                    node_type: "paragraph".to_string(),
                    id: None,
                    data: json!({"delta": [{"insert": 42}]}),
                    children: vec![],
                }],
            }],
        };
        let env = envelope(page, "t", vec![weird, para(good, "ok")]);
        let diff = diff_envelopes(&env, &env.clone(), None, None);
        assert!(diff.hunks.is_empty());

        assert_eq!(block_plaintext(&para(good, "x")), "x");
        let non_array = BlockNode {
            node_type: "paragraph".to_string(),
            id: None,
            data: json!({"delta": "not-array"}),
            children: vec![],
        };
        assert_eq!(block_plaintext(&non_array), "");
        let absent = BlockNode {
            node_type: "bulletList".to_string(),
            id: None,
            data: json!({}),
            children: vec![],
        };
        assert_eq!(block_plaintext(&absent), "");
    }

    #[test]
    fn heading_path_is_attached_to_hunks() {
        let page = Uuid::new_v4();
        let h = Uuid::new_v4();
        let p = Uuid::new_v4();
        let mut head = heading(h, "Chapter One");
        head.children = vec![para(p, "before")];
        let from = envelope(page, "t", vec![head.clone()]);
        head.children = vec![para(p, "after")];
        let to = envelope(page, "t", vec![head]);
        let diff = diff_envelopes(&from, &to, None, None);
        assert_eq!(diff.hunks.len(), 1);
        assert_eq!(diff.hunks[0].path, vec!["Chapter One".to_string()]);
    }

    #[test]
    fn word_diff_splits_eq_del_ins() {
        let edits = word_diff("a b c", "a x c");
        let simplified: Vec<(WordEditKind, &str)> =
            edits.iter().map(|e| (e.kind, e.text.as_str())).collect();
        assert_eq!(
            simplified,
            vec![
                (WordEditKind::Eq, "a"),
                (WordEditKind::Del, "b"),
                (WordEditKind::Ins, "x"),
                (WordEditKind::Eq, "c"),
            ]
        );
    }

    #[test]
    fn word_diff_identical_is_all_eq() {
        let edits = word_diff("same words here", "same words here");
        assert!(!edits.is_empty());
        assert!(edits.iter().all(|e| e.kind == WordEditKind::Eq));
        let edits = word_diff("", "");
        assert!(edits.is_empty());
    }

    #[test]
    fn word_diff_huge_inputs_fall_back_to_coarse_replace() {
        let before = (0..5000)
            .map(|i| format!("word{i}"))
            .collect::<Vec<_>>()
            .join(" ");
        let mut after_words: Vec<String> = (0..5000).map(|i| format!("word{i}")).collect();
        after_words[2500] = "CHANGED".to_string();
        let after = after_words.join(" ");
        let edits = word_diff(&before, &after);
        assert_eq!(edits.len(), 2);
        assert_eq!(edits[0].kind, WordEditKind::Del);
        assert_eq!(edits[0].text, before);
        assert_eq!(edits[1].kind, WordEditKind::Ins);
        assert_eq!(edits[1].text, after);
        // At the cap the full LCS still runs.
        let at_cap_before = (0..MAX_DIFF_WORDS)
            .map(|i| format!("w{i}"))
            .collect::<Vec<_>>()
            .join(" ");
        let at_cap_edits = word_diff(&at_cap_before, &at_cap_before);
        assert!(at_cap_edits.iter().all(|e| e.kind == WordEditKind::Eq));
    }

    #[test]
    fn non_uuid_block_id_is_excluded_from_diff() {
        let page = Uuid::new_v4();
        let ghost = BlockNode {
            node_type: "paragraph".to_string(),
            id: None,
            data: serde_json::json!({"delta": [{"insert": "ghost"}], "blockId": "not-a-uuid"}),
            children: vec![],
        };
        let from = envelope(page, "t", vec![]);
        let to = envelope(page, "t", vec![ghost]);
        let diff = diff_envelopes(&from, &to, None, None);
        assert!(diff.hunks.is_empty());
        assert_eq!(diff.summary, DiffSummary::default());
    }
}
