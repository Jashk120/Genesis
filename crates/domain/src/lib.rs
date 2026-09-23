pub mod block;
pub mod claim;
pub mod conflict;
pub mod entity;
pub mod export;
pub mod field;
pub mod mention;
pub mod page;
pub mod snapshot;
pub mod version_diff;
pub mod workspace;

pub use block::{Block, BlockNode, BlockType, FlatBlock};
pub use claim::{ChangeKind, Claim, ClaimStatus, SourceLocation, SourceType, Verified};
pub use conflict::{Conflict, ConflictStatus, ConflictTier};
pub use entity::{Entity, EntityAlias, EntityKind, EntityLineage, LineageKind};
pub use export::{
    diff_to_html, diff_to_markdown, envelope_page_to_html, envelope_page_to_markdown,
    envelope_to_html, envelope_to_markdown, escape_html, tree_to_html, tree_to_markdown,
    ExportFormat,
};
pub use field::{Cardinality, FieldDef, FieldStatus, ValueType};
pub use mention::{Mention, Resolution};
pub use page::{Page, PageKind};
pub use snapshot::{
    canonical_hash, count_blocks, Snapshot, SnapshotEnvelope, SnapshotMeta, SnapshotPageMeta,
};
pub use version_diff::{
    block_plaintext, diff_envelopes, word_diff, DiffSummary, Hunk, HunkKind, PathRef, VersionDiff,
    WordEdit, WordEditKind,
};
pub use workspace::Workspace;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("invalid supersede: {0}")]
    InvalidSupersede(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}
