pub mod block;
pub mod claim;
pub mod conflict;
pub mod entity;
pub mod field;
pub mod mention;
pub mod page;
pub mod snapshot;
pub mod workspace;

pub use block::{Block, BlockNode, BlockType, FlatBlock};
pub use claim::{ChangeKind, Claim, ClaimStatus, SourceLocation, SourceType, Verified};
pub use conflict::{Conflict, ConflictStatus, ConflictTier};
pub use entity::{Entity, EntityAlias, EntityKind, EntityLineage, LineageKind};
pub use field::{Cardinality, FieldDef, FieldStatus, ValueType};
pub use mention::{Mention, Resolution};
pub use page::{Page, PageKind};
pub use snapshot::Snapshot;
pub use workspace::Workspace;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("invalid supersede: {0}")]
    InvalidSupersede(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}
