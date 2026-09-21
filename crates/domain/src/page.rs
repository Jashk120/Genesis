use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PageKind {
    Folder,
    Story,
    Version,
    Chapter,
    Note,
}

impl PageKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Folder => "folder",
            Self::Story => "story",
            Self::Version => "version",
            Self::Chapter => "chapter",
            Self::Note => "note",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "folder" => Some(Self::Folder),
            "story" => Some(Self::Story),
            "version" => Some(Self::Version),
            "chapter" => Some(Self::Chapter),
            "note" => Some(Self::Note),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Page {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub parent_page_id: Option<Uuid>,
    pub kind: PageKind,
    pub title: String,
    pub discourse_index: Option<i32>,
    pub narrative_order: Option<i32>,
    pub ordinal: i32,
    pub created_at: DateTime<Utc>,
}

impl Page {
    pub fn new(
        workspace_id: Uuid,
        parent_page_id: Option<Uuid>,
        kind: PageKind,
        title: impl Into<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            workspace_id,
            parent_page_id,
            kind,
            title: title.into(),
            discourse_index: None,
            narrative_order: None,
            ordinal: 0,
            created_at: Utc::now(),
        }
    }
}
