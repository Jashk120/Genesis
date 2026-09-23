use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Write;

use axum::body::{Body, Bytes};
use axum::http::{header, StatusCode};
use axum::response::Response;
use domain::export::ExportFormat;
use uuid::Uuid;

pub const BUNDLE_FLAT_MAX: usize = 10;
pub const MAX_DOC_BYTES: usize = 50 * 1024 * 1024;

pub struct ExportDoc {
    pub entry_path: String,
    pub heading: Option<String>,
    pub content: String,
}

/// ASCII-safe filename stem: keep [A-Za-z0-9-_], replace runs of anything
/// else with '-', trim/collapse '-', cap at 80 chars, empty -> "untitled".
pub fn sanitize_filename(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_dash = true;
    for c in input.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    // Collapse any remaining "--" runs (can arise from mixed '-' + replaced runs).
    let mut collapsed = String::with_capacity(trimmed.len());
    let mut prev_dash = false;
    for c in trimmed.chars() {
        if c == '-' {
            if !prev_dash {
                collapsed.push(c);
            }
            prev_dash = true;
        } else {
            collapsed.push(c);
            prev_dash = false;
        }
    }
    let mut s = collapsed;
    if s.len() > 80 {
        s.truncate(80);
        let t = s.trim_end_matches('-').to_string();
        s = t;
    }
    if s.is_empty() {
        return "untitled".to_string();
    }
    s
}

/// Flat bundle for <BUNDLE_FLAT_MAX versions: each doc rendered under its
/// heading separator, ascending order preserved, parts joined by blank lines.
pub fn concat_flat_bundle(format: ExportFormat, docs: &[ExportDoc]) -> String {
    let _ = format;
    let parts: Vec<String> = docs
        .iter()
        .map(|d| match &d.heading {
            Some(h) => format!("{h}\n\n{}", d.content),
            None => d.content.clone(),
        })
        .collect();
    parts.join("\n\n")
}

#[derive(Debug, PartialEq, Eq)]
pub enum ZipError {
    TooLarge,
    Io(String),
}

impl std::fmt::Display for ZipError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge => write!(f, "export too large; use per-chapter export"),
            Self::Io(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for ZipError {}

pub fn zip_bytes(entries: &[(String, String)]) -> Result<Vec<u8>, ZipError> {
    let total: usize = entries.iter().map(|(_, c)| c.len()).sum();
    if total > MAX_DOC_BYTES {
        return Err(ZipError::TooLarge);
    }
    let cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, content) in entries {
        writer
            .start_file(name, options)
            .map_err(|e| ZipError::Io(e.to_string()))?;
        writer
            .write_all(content.as_bytes())
            .map_err(|e| ZipError::Io(e.to_string()))?;
    }
    let cursor = writer.finish().map_err(|e| ZipError::Io(e.to_string()))?;
    Ok(cursor.into_inner())
}

/// Streamed attachment: Content-Type + Content-Disposition, body streamed
/// in 64 KiB chunks via axum::body::Body::from_stream.
pub fn attachment_response(filename: &str, content_type: &str, bytes: Vec<u8>) -> Response {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(8);
    tokio::spawn(async move {
        for chunk in bytes.chunks(64 * 1024) {
            let b = Bytes::copy_from_slice(chunk);
            if tx.send(Ok(b)).await.is_err() {
                break;
            }
        }
    });
    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let body = Body::from_stream(stream);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type.to_string())
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(body)
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

/// 413 with body "export too large; use per-chapter export".
pub fn too_large_response() -> Response {
    Response::builder()
        .status(StatusCode::PAYLOAD_TOO_LARGE)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from("export too large; use per-chapter export"))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

/// Nested entry paths for cluster export: for each page in the envelope, a
/// path mirroring the page hierarchy (`<root title>/<child title>/....<ext>`),
/// each segment sanitized; collisions de-duplicated with a numeric suffix.
pub fn cluster_entry_paths(
    envelope: &domain::snapshot::SnapshotEnvelope,
    format: ExportFormat,
) -> Vec<(Uuid, String)> {
    let ext = format.extension();
    let by_id: HashMap<Uuid, &domain::snapshot::SnapshotPageMeta> =
        envelope.pages.iter().map(|p| (p.id, p)).collect();
    let mut out: Vec<(Uuid, String)> = Vec::with_capacity(envelope.pages.len());
    let mut used: HashMap<String, usize> = HashMap::new();
    for page in &envelope.pages {
        // Walk parent_page_id up to the root, cycle-safe, cap depth 1000.
        let mut chain: Vec<String> = Vec::new();
        let mut current = Some(page.id);
        let mut visited: HashSet<Uuid> = HashSet::new();
        for _ in 0..1000 {
            let Some(id) = current else { break };
            if !visited.insert(id) {
                break;
            }
            let Some(meta) = by_id.get(&id) else { break };
            chain.push(sanitize_filename(&meta.title));
            current = meta.parent_page_id;
        }
        chain.reverse();
        if chain.is_empty() {
            chain.push(sanitize_filename(&page.title));
        }
        let base = chain.join("/");
        let candidate = format!("{base}.{ext}");
        let n = used.get(&candidate).copied().unwrap_or(0) + 1;
        if n == 1 {
            used.insert(candidate.clone(), 1);
            out.push((page.id, candidate));
        } else {
            let mut m = n;
            let mut final_name = format!("{base}-{m}.{ext}");
            while used.contains_key(&final_name) {
                m += 1;
                final_name = format!("{base}-{m}.{ext}");
            }
            used.insert(candidate, m);
            used.insert(final_name.clone(), 1);
            out.push((page.id, final_name));
        }
    }
    // Silence unused-import lint for BTreeMap (kept for deterministic ordering docs).
    let _ = BTreeMap::<String, String>::new();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_spaces_slashes_unicode_empty_long() {
        assert_eq!(sanitize_filename("Hello World"), "Hello-World");
        assert_eq!(sanitize_filename("a/b\\c"), "a-b-c");
        assert_eq!(sanitize_filename("héllo→wörld"), "h-llo-w-rld");
        assert_eq!(sanitize_filename(""), "untitled");
        assert_eq!(sanitize_filename("!!!"), "untitled");
        assert_eq!(sanitize_filename("--a--b--"), "a-b");
        let long = "a".repeat(200);
        let s = sanitize_filename(&long);
        assert_eq!(s.len(), 80);
        assert_eq!(s, "a".repeat(80));
        // Trailing replaced runs are trimmed, not left as dashes.
        assert_eq!(sanitize_filename("abc   "), "abc");
    }

    #[test]
    fn flat_bundle_preserves_order_and_separators() {
        let docs = vec![
            ExportDoc {
                entry_path: "v-1.md".to_string(),
                heading: Some("## V-1 · first".to_string()),
                content: "alpha".to_string(),
            },
            ExportDoc {
                entry_path: "v-2.md".to_string(),
                heading: Some("## V-2 · second".to_string()),
                content: "beta".to_string(),
            },
        ];
        let md = concat_flat_bundle(ExportFormat::Markdown, &docs);
        assert!(md.find("V-1").unwrap() < md.find("V-2").unwrap());
        assert!(md.contains("## V-1 · first\n\nalpha"));
        assert!(md.contains("## V-2 · second\n\nbeta"));
        let html = concat_flat_bundle(
            ExportFormat::Html,
            &[ExportDoc {
                entry_path: "v-1.html".to_string(),
                heading: Some("<h2>V-1</h2>".to_string()),
                content: "<p>a</p>".to_string(),
            }],
        );
        assert!(html.contains("<h2>V-1</h2>\n\n<p>a</p>"));
    }

    #[test]
    fn zip_round_trips_entry_names_and_contents() {
        let entries = vec![
            ("v-1.md".to_string(), "hello".to_string()),
            ("dir/v-2.md".to_string(), "world".to_string()),
        ];
        let bytes = zip_bytes(&entries).expect("zips");
        let cursor = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).expect("parses");
        assert_eq!(archive.len(), 2);
        let mut names = Vec::new();
        for i in 0..archive.len() {
            let mut f = archive.by_index(i).expect("entry");
            let mut s = String::new();
            use std::io::Read as _;
            f.read_to_string(&mut s).expect("reads");
            names.push((f.name().to_string(), s));
        }
        names.sort();
        assert_eq!(
            names,
            vec![
                ("dir/v-2.md".to_string(), "world".to_string()),
                ("v-1.md".to_string(), "hello".to_string()),
            ]
        );
    }

    #[test]
    fn cluster_paths_nest_and_dedup_collisions() {
        use domain::snapshot::{SnapshotEnvelope, SnapshotPageMeta};
        let root = Uuid::new_v4();
        let child_a = Uuid::new_v4();
        let child_b = Uuid::new_v4();
        let grandchild = Uuid::new_v4();
        let envelope = SnapshotEnvelope {
            version: 1,
            root_page_id: root,
            pages: vec![
                SnapshotPageMeta {
                    id: root,
                    kind: "story".to_string(),
                    title: "My Novel".to_string(),
                    parent_page_id: None,
                    ordinal: 0,
                    narrative_order: None,
                },
                SnapshotPageMeta {
                    id: child_a,
                    kind: "chapter".to_string(),
                    title: "Chapter".to_string(),
                    parent_page_id: Some(root),
                    ordinal: 0,
                    narrative_order: None,
                },
                SnapshotPageMeta {
                    id: child_b,
                    kind: "chapter".to_string(),
                    title: "Chapter".to_string(),
                    parent_page_id: Some(root),
                    ordinal: 1,
                    narrative_order: None,
                },
                SnapshotPageMeta {
                    id: grandchild,
                    kind: "note".to_string(),
                    title: "Notes".to_string(),
                    parent_page_id: Some(child_a),
                    ordinal: 0,
                    narrative_order: None,
                },
            ],
            trees: BTreeMap::new(),
        };
        let paths = cluster_entry_paths(&envelope, ExportFormat::Markdown);
        let by_id: HashMap<Uuid, String> = paths.into_iter().collect();
        assert_eq!(by_id[&root], "My-Novel.md");
        assert_eq!(by_id[&child_a], "My-Novel/Chapter.md");
        assert_eq!(by_id[&child_b], "My-Novel/Chapter-2.md");
        assert_eq!(by_id[&grandchild], "My-Novel/Chapter/Notes.md");
    }
}
