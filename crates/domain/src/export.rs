//! Pure Markdown / HTML serializers for block trees, snapshot envelopes,
//! and version diffs.
//!
//! Everything here is untrusted-text safe for HTML: all delta text and
//! attribute values go through [`escape_html`] before interpolation.
//! `annotation` blocks are never rendered. Unknown block types render
//! their children only. Sub-page `page` nodes render a placeholder and
//! are never recursed into (cycle-safe).

use serde_json::Value;
use uuid::Uuid;

use crate::block::BlockNode;
use crate::snapshot::SnapshotEnvelope;
use crate::version_diff::{HunkKind, VersionDiff, WordEditKind};

/// Export document format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Markdown,
    Html,
}

impl ExportFormat {
    /// Parse `"md"` / `"markdown"` / `"html"` (case-insensitive).
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "md" | "markdown" => Some(Self::Markdown),
            "html" => Some(Self::Html),
            _ => None,
        }
    }

    /// File extension without the dot.
    pub fn extension(&self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::Html => "html",
        }
    }

    /// Value for the HTTP `Content-Type` header.
    pub fn content_type(&self) -> &'static str {
        match self {
            Self::Markdown => "text/markdown; charset=utf-8",
            Self::Html => "text/html; charset=utf-8",
        }
    }
}

/// Escape `& < > " '` for HTML text and attribute values. `&` is
/// replaced first so existing entities are not double-processed into
/// anything dangerous (they become `&amp;...`, i.e. inert text).
pub fn escape_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

fn attr_flag(attrs: Option<&serde_json::Map<String, Value>>, key: &str) -> bool {
    attrs
        .and_then(|m| m.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn attr_link(attrs: Option<&serde_json::Map<String, Value>>) -> Option<&str> {
    attrs.and_then(|m| m.get("link")).and_then(Value::as_str)
}

/// Allowlist for link targets. Escaping neutralizes markup but not the
/// scheme, so `javascript:` / `data:` / `vbscript:` targets must be
/// rejected here. Returns the trimmed URL only for `http:`, `https:`
/// and `mailto:` (case-insensitive); anything else yields `None` and the
/// caller renders the link text without a link.
fn safe_link_target(url: &str) -> Option<&str> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http:") || lower.starts_with("https:") || lower.starts_with("mailto:") {
        Some(trimmed)
    } else {
        None
    }
}

/// Keep only fence-safe characters in a code-block language tag so a
/// hostile `language` value cannot inject newlines or break out of the
/// opening fence. Empty result means "no language".
fn sanitize_code_lang(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '#' | '.' | '_' | '-'))
        .collect()
}

/// Fence strictly longer than the longest backtick run in `content`
/// (CommonMark rule), minimum three, so content can never break out.
fn code_fence(content: &str) -> String {
    let mut longest = 0usize;
    let mut run = 0usize;
    for c in content.chars() {
        if c == '`' {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    "`".repeat(longest.max(2) + 1)
}

/// Single-line text for titles, labels and heading paths: a `\r`/`\n`
/// would otherwise inject new Markdown lines (e.g. a forged heading).
fn single_line(input: &str) -> String {
    input
        .chars()
        .map(|c| if c == '\r' || c == '\n' { ' ' } else { c })
        .collect()
}

/// Escape markdown-hostile characters in plain text (minimal set).
fn escape_md_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '\\' | '`' | '*' | '_' | '[' | ']' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

fn escape_md_code(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '\\' | '`' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

fn inline_markdown(data: &Value) -> String {
    let mut out = String::new();
    let Some(ops) = data.get("delta").and_then(Value::as_array) else {
        return out;
    };
    for op in ops {
        let Some(text) = op.get("insert").and_then(Value::as_str) else {
            continue;
        };
        let attrs = op.get("attributes").and_then(Value::as_object);
        if attr_flag(attrs, "spoiler") {
            continue;
        }
        let mut chunk = if attr_flag(attrs, "code") {
            format!("`{}`", escape_md_code(text))
        } else {
            escape_md_text(text)
        };
        if attr_flag(attrs, "bold") {
            chunk = format!("**{chunk}**");
        }
        if attr_flag(attrs, "italic") {
            chunk = format!("*{chunk}*");
        }
        if let Some(url) = attr_link(attrs) {
            if let Some(target) = safe_link_target(url) {
                chunk = format!("[{chunk}]({target})");
            }
        }
        out.push_str(&chunk);
    }
    out
}

fn inline_html(data: &Value) -> String {
    let mut out = String::new();
    let Some(ops) = data.get("delta").and_then(Value::as_array) else {
        return out;
    };
    for op in ops {
        let Some(text) = op.get("insert").and_then(Value::as_str) else {
            continue;
        };
        let attrs = op.get("attributes").and_then(Value::as_object);
        if attr_flag(attrs, "spoiler") {
            continue;
        }
        let mut chunk = escape_html(text);
        if attr_flag(attrs, "code") {
            chunk = format!("<code>{chunk}</code>");
        }
        if attr_flag(attrs, "bold") {
            chunk = format!("<strong>{chunk}</strong>");
        }
        if attr_flag(attrs, "italic") {
            chunk = format!("<em>{chunk}</em>");
        }
        if let Some(url) = attr_link(attrs) {
            if let Some(target) = safe_link_target(url) {
                chunk = format!("<a href=\"{}\">{chunk}</a>", escape_html(target));
            }
        }
        out.push_str(&chunk);
    }
    out
}

/// Raw concatenated insert text (no marks); used for code blocks.
fn raw_text(data: &Value) -> String {
    let mut out = String::new();
    if let Some(ops) = data.get("delta").and_then(Value::as_array) {
        for op in ops {
            if let Some(s) = op.get("insert").and_then(Value::as_str) {
                out.push_str(s);
            }
        }
    }
    out
}

fn heading_level(data: &Value) -> usize {
    let level = data.get("level").and_then(Value::as_i64).unwrap_or(1);
    level.clamp(1, 6) as usize
}

fn is_bullet_list(t: &str) -> bool {
    t == "bulletList" || t == "bulleted_list_item"
}

fn is_ordered_list(t: &str) -> bool {
    t == "orderedList"
}

fn is_list(t: &str) -> bool {
    is_bullet_list(t) || is_ordered_list(t)
}

fn is_list_item(t: &str) -> bool {
    t == "listItem"
}

fn is_transparent_page(node: &BlockNode) -> bool {
    node.node_type == "page" && node.id.is_none()
}

/// Title for a sub-page placeholder: `data.title`, else `data.pageId`,
/// else `"untitled"`.
fn subpage_title(node: &BlockNode) -> String {
    node.data
        .get("title")
        .and_then(Value::as_str)
        .or_else(|| node.data.get("pageId").and_then(Value::as_str))
        .unwrap_or("untitled")
        .to_string()
}

fn md_list(node: &BlockNode, depth: usize) -> String {
    let ordered = is_ordered_list(&node.node_type);
    let mut lines = Vec::new();
    for child in &node.children {
        if child.node_type == "annotation" {
            continue;
        }
        if is_list(&child.node_type) {
            let nested = md_list(child, depth.saturating_add(1));
            if !nested.is_empty() {
                lines.push(nested);
            }
        } else {
            let marker = if ordered { "1. " } else { "- " };
            md_item_lines(child, marker, depth, &mut lines);
        }
    }
    lines.join("\n")
}

/// Render `node` as one list item (plus any nested lines) into `lines`.
fn md_item_lines(node: &BlockNode, marker: &str, depth: usize, lines: &mut Vec<String>) {
    if node.node_type == "annotation" {
        return;
    }
    let indent = "  ".repeat(depth);
    // A nested list node directly under an item/list is rendered one level
    // deeper instead of becoming an (empty) item itself. Callers pass the
    // already-incremented depth, so no further increment here.
    if is_list(&node.node_type) {
        let nested = md_list(node, depth);
        if !nested.is_empty() {
            lines.push(nested);
        }
        return;
    }
    let text = inline_markdown(&node.data);
    if text.is_empty() {
        lines.push(format!("{}{}", indent, marker.trim_end()));
    } else {
        lines.push(format!("{indent}{marker}{text}"));
    }
    for child in &node.children {
        if is_list(&child.node_type) || is_list_item(&child.node_type) {
            md_item_lines(child, marker, depth.saturating_add(1), lines);
        } else {
            let rendered = md_node(child, depth.saturating_add(1));
            for line in rendered.lines() {
                if line.is_empty() {
                    continue;
                }
                lines.push(format!("{}{}", "  ".repeat(depth.saturating_add(1)), line));
            }
        }
    }
}

fn md_node(node: &BlockNode, depth: usize) -> String {
    if node.node_type == "annotation" {
        return String::new();
    }
    if is_transparent_page(node) {
        return node
            .children
            .iter()
            .map(|c| md_node(c, depth))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
    }
    match node.node_type.as_str() {
        "heading" => {
            let hashes = "#".repeat(heading_level(&node.data));
            format!("{hashes} {}", inline_markdown(&node.data))
        }
        "paragraph" => inline_markdown(&node.data),
        t if is_list(t) => md_list(node, depth),
        t if is_list_item(t) => {
            let mut lines = Vec::new();
            md_item_lines(node, "- ", depth, &mut lines);
            lines.join("\n")
        }
        "blockquote" => {
            let inner = node
                .children
                .iter()
                .map(|c| md_node(c, depth))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            if inner.is_empty() {
                inline_markdown(&node.data)
                    .lines()
                    .map(|l| {
                        if l.is_empty() {
                            ">".to_string()
                        } else {
                            format!("> {l}")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                inner
                    .lines()
                    .map(|l| {
                        if l.is_empty() {
                            ">".to_string()
                        } else {
                            format!("> {l}")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        "toggle" => {
            let collapsed = node
                .data
                .get("collapsed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if collapsed {
                node.children
                    .iter()
                    .find(|c| c.node_type != "annotation")
                    .map(|c| md_node(c, depth))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_default()
            } else {
                node.children
                    .iter()
                    .map(|c| md_node(c, depth))
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n\n")
            }
        }
        "codeBlock" => {
            let lang = sanitize_code_lang(
                node.data
                    .get("language")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            );
            let content = raw_text(&node.data);
            let fence = code_fence(&content);
            if lang.is_empty() {
                format!("{fence}\n{content}\n{fence}")
            } else {
                format!("{fence}{lang}\n{content}\n{fence}")
            }
        }
        "page" => format!("> (sub-page: {})", single_line(&subpage_title(node))),
        _ => node
            .children
            .iter()
            .map(|c| md_node(c, depth))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
    }
}

/// Render one block tree as Markdown. The synthetic page root renders its
/// children joined by blank lines; the result ends with a single newline
/// when non-empty.
pub fn tree_to_markdown(tree: &BlockNode) -> String {
    let body = if is_transparent_page(tree) {
        tree.children
            .iter()
            .map(|c| md_node(c, 0))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n")
    } else {
        md_node(tree, 0)
    };
    if body.trim().is_empty() {
        String::new()
    } else {
        format!("{}\n", body.trim_end())
    }
}

fn html_list(node: &BlockNode) -> String {
    let tag = if is_ordered_list(&node.node_type) {
        "ol"
    } else {
        "ul"
    };
    let mut items = String::new();
    for child in &node.children {
        items.push_str(&html_item(child));
    }
    format!("<{tag}>\n{items}</{tag}>")
}

fn html_item(node: &BlockNode) -> String {
    if node.node_type == "annotation" {
        return String::new();
    }
    if is_list(&node.node_type) {
        return html_list(node);
    }
    let mut inner = inline_html(&node.data);
    for child in &node.children {
        if is_list(&child.node_type) {
            inner.push_str(&html_list(child));
        } else if is_list_item(&child.node_type) {
            inner.push_str(&format!("<ul>\n{}</ul>", html_item(child)));
        } else {
            let rendered = html_node(child);
            if !rendered.is_empty() {
                inner.push_str(&rendered);
            }
        }
    }
    format!("<li>{inner}</li>\n")
}

fn html_node(node: &BlockNode) -> String {
    if node.node_type == "annotation" {
        return String::new();
    }
    if is_transparent_page(node) {
        return node
            .children
            .iter()
            .map(html_node)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
    }
    match node.node_type.as_str() {
        "heading" => {
            let level = heading_level(&node.data);
            format!("<h{level}>{}</h{level}>", inline_html(&node.data))
        }
        "paragraph" => {
            let inner = inline_html(&node.data);
            if inner.is_empty() {
                String::new()
            } else {
                format!("<p>{inner}</p>")
            }
        }
        t if is_list(t) => html_list(node),
        t if is_list_item(t) => html_item(node),
        "blockquote" => {
            let inner = node
                .children
                .iter()
                .map(html_node)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            format!("<blockquote>{inner}</blockquote>")
        }
        "toggle" => {
            let collapsed = node
                .data
                .get("collapsed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if collapsed {
                node.children
                    .iter()
                    .find(|c| c.node_type != "annotation")
                    .map(html_node)
                    .filter(|s| !s.is_empty())
                    .unwrap_or_default()
            } else {
                node.children
                    .iter()
                    .map(html_node)
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        "codeBlock" => {
            let code = escape_html(&raw_text(&node.data));
            match node.data.get("language").and_then(Value::as_str) {
                Some(raw) => {
                    let lang = sanitize_code_lang(raw);
                    if lang.is_empty() {
                        format!("<pre><code>{code}</code></pre>")
                    } else {
                        format!(
                            "<pre><code class=\"language-{}\">{code}</code></pre>",
                            escape_html(&lang)
                        )
                    }
                }
                _ => format!("<pre><code>{code}</code></pre>"),
            }
        }
        "page" => format!(
            "<p class=\"subpage\">(sub-page: {})</p>",
            escape_html(&subpage_title(node))
        ),
        _ => node
            .children
            .iter()
            .map(html_node)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

/// Render one block tree as an HTML fragment (no `<html>` wrapper).
pub fn tree_to_html(tree: &BlockNode) -> String {
    if is_transparent_page(tree) {
        tree.children
            .iter()
            .map(html_node)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        html_node(tree)
    }
}

fn envelope_tree<'a>(envelope: &'a SnapshotEnvelope, page_id: Uuid) -> Option<&'a BlockNode> {
    envelope.trees.get(&page_id.to_string())
}

/// One page's tree only (no title header). Empty string if page absent.
pub fn envelope_page_to_markdown(envelope: &SnapshotEnvelope, page_id: Uuid) -> String {
    envelope_tree(envelope, page_id)
        .map(tree_to_markdown)
        .unwrap_or_default()
}

/// One page's tree only (no title header). Empty string if page absent.
pub fn envelope_page_to_html(envelope: &SnapshotEnvelope, page_id: Uuid) -> String {
    envelope_tree(envelope, page_id)
        .map(tree_to_html)
        .unwrap_or_default()
}

/// Whole subtree as one Markdown document: the root page's tree first,
/// then each descendant page in `envelope.pages` order as `# <title>` +
/// its tree. Parts joined by blank lines.
pub fn envelope_to_markdown(envelope: &SnapshotEnvelope) -> String {
    let mut parts = Vec::new();
    let root_body = envelope_page_to_markdown(envelope, envelope.root_page_id);
    if !root_body.trim().is_empty() {
        parts.push(root_body.trim_end().to_string());
    }
    for page in &envelope.pages {
        if page.id == envelope.root_page_id {
            continue;
        }
        let body = envelope_page_to_markdown(envelope, page.id);
        let title = single_line(&page.title);
        if body.trim().is_empty() {
            parts.push(format!("# {}", title));
        } else {
            parts.push(format!("# {}\n\n{}", title, body.trim_end()));
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("{}\n", parts.join("\n\n"))
    }
}

/// Whole subtree as one HTML document fragment: the root page's tree
/// first, then each descendant page in `envelope.pages` order as
/// `<h1><title></h1>` + its tree. Parts joined by blank lines.
pub fn envelope_to_html(envelope: &SnapshotEnvelope) -> String {
    let mut parts = Vec::new();
    let root_body = envelope_page_to_html(envelope, envelope.root_page_id);
    if !root_body.trim().is_empty() {
        parts.push(root_body.trim().to_string());
    }
    for page in &envelope.pages {
        if page.id == envelope.root_page_id {
            continue;
        }
        let body = envelope_page_to_html(envelope, page.id);
        let header = format!("<h1>{}</h1>", escape_html(&page.title));
        if body.trim().is_empty() {
            parts.push(header);
        } else {
            parts.push(format!("{header}\n\n{}", body.trim()));
        }
    }
    parts.join("\n\n")
}

fn hunk_headline_md(kind: HunkKind) -> &'static str {
    match kind {
        HunkKind::Added => "Added",
        HunkKind::Removed => "Removed",
        HunkKind::Moved => "Moved",
        HunkKind::Edited => "Edited",
        HunkKind::PageTitle => "Page titles",
    }
}

fn md_path_suffix(path: &[String]) -> String {
    if path.is_empty() {
        String::new()
    } else {
        let flat: Vec<String> = path.iter().map(|s| single_line(s)).collect();
        format!(" ({})", flat.join(" / "))
    }
}

fn render_word_edits_md(text: &str, edits: &[crate::version_diff::WordEdit]) -> String {
    if edits.is_empty() {
        return escape_md_text(text);
    }
    let mut out = Vec::new();
    for e in edits {
        match e.kind {
            WordEditKind::Eq => out.push(escape_md_text(&e.text)),
            WordEditKind::Del => out.push(format!("~~{}~~", escape_md_text(&e.text))),
            WordEditKind::Ins => out.push(format!("**{}**", escape_md_text(&e.text))),
        }
    }
    out.join(" ")
}

fn render_word_edits_html(edits: &[crate::version_diff::WordEdit]) -> String {
    let mut out = Vec::new();
    for e in edits {
        match e.kind {
            WordEditKind::Eq => out.push(escape_html(&e.text)),
            WordEditKind::Del => out.push(format!("<del>{}</del>", escape_html(&e.text))),
            WordEditKind::Ins => out.push(format!("<ins>{}</ins>", escape_html(&e.text))),
        }
    }
    out.join(" ")
}

fn hunk_bullet_md(
    kind: HunkKind,
    before: Option<&str>,
    after: Option<&str>,
    edits: &[crate::version_diff::WordEdit],
    path: &[String],
) -> String {
    let suffix = md_path_suffix(path);
    match kind {
        HunkKind::Added => format!("- {}{suffix}", escape_md_text(after.unwrap_or(""))),
        HunkKind::Removed => format!("- {}{suffix}", escape_md_text(before.unwrap_or(""))),
        HunkKind::Moved => format!(
            "- {}{suffix}",
            escape_md_text(after.or(before).unwrap_or(""))
        ),
        HunkKind::Edited => {
            let before_s = before.unwrap_or("");
            let rendered = render_word_edits_md(before_s, edits);
            format!("- {rendered}{suffix}")
        }
        HunkKind::PageTitle => format!(
            "- \"{}\" → \"{}\"{suffix}",
            escape_md_text(before.unwrap_or("")),
            escape_md_text(after.unwrap_or(""))
        ),
    }
}

/// Render a [`VersionDiff`] as a Markdown changelog document.
pub fn diff_to_markdown(diff: &VersionDiff, from_label: &str, to_label: &str) -> String {
    let mut out = format!(
        "# Diff from {} to {}\n\nSummary: {} added, {} removed, {} moved, {} edited across {} pages.\n",
        single_line(from_label),
        single_line(to_label),
        diff.summary.added,
        diff.summary.removed,
        diff.summary.moved,
        diff.summary.edited,
        diff.summary.pages_changed,
    );
    if diff.hunks.is_empty() {
        out.push_str("\nNo changes.\n");
        return out;
    }
    for kind in [
        HunkKind::Added,
        HunkKind::Removed,
        HunkKind::Moved,
        HunkKind::Edited,
        HunkKind::PageTitle,
    ] {
        let group: Vec<_> = diff.hunks.iter().filter(|h| h.kind == kind).collect();
        if group.is_empty() {
            continue;
        }
        out.push_str(&format!("\n## {}\n", hunk_headline_md(kind)));
        for h in group {
            out.push_str(&hunk_bullet_md(
                h.kind,
                h.before_text.as_deref(),
                h.after_text.as_deref(),
                &h.word_edits,
                &h.path,
            ));
            out.push('\n');
        }
    }
    if diff.truncated {
        out.push_str(
            "\n> _Output truncated — more hunks exist. Use the API with a larger limit or cursor._\n",
        );
    }
    out
}

/// Render a [`VersionDiff`] as an HTML changelog fragment.
pub fn diff_to_html(diff: &VersionDiff, from_label: &str, to_label: &str) -> String {
    let mut out = format!(
        "<h1>Diff from {} to {}</h1>\n<p>Summary: {} added, {} removed, {} moved, {} edited across {} pages.</p>",
        escape_html(from_label),
        escape_html(to_label),
        diff.summary.added,
        diff.summary.removed,
        diff.summary.moved,
        diff.summary.edited,
        diff.summary.pages_changed,
    );
    if diff.hunks.is_empty() {
        out.push_str("\n<p>No changes.</p>");
        return out;
    }
    for kind in [
        HunkKind::Added,
        HunkKind::Removed,
        HunkKind::Moved,
        HunkKind::Edited,
        HunkKind::PageTitle,
    ] {
        let group: Vec<_> = diff.hunks.iter().filter(|h| h.kind == kind).collect();
        if group.is_empty() {
            continue;
        }
        out.push_str(&format!("\n<h2>{}</h2>\n<ul>", hunk_headline_md(kind)));
        for h in group {
            let path = if h.path.is_empty() {
                String::new()
            } else {
                format!(
                    " <span class=\"path\">({})</span>",
                    escape_html(&h.path.join(" / "))
                )
            };
            let item = match h.kind {
                HunkKind::Added => escape_html(h.after_text.as_deref().unwrap_or("")),
                HunkKind::Removed => escape_html(h.before_text.as_deref().unwrap_or("")),
                HunkKind::Moved => escape_html(
                    h.after_text
                        .as_deref()
                        .or(h.before_text.as_deref())
                        .unwrap_or(""),
                ),
                HunkKind::Edited => render_word_edits_html(&h.word_edits),
                HunkKind::PageTitle => format!(
                    "&quot;{}&quot; → &quot;{}&quot;",
                    escape_html(h.before_text.as_deref().unwrap_or("")),
                    escape_html(h.after_text.as_deref().unwrap_or(""))
                ),
            };
            out.push_str(&format!("\n<li>{item}{path}</li>"));
        }
        out.push_str("\n</ul>");
    }
    if diff.truncated {
        out.push_str("\n<p class=\"truncated\">Output truncated — more hunks exist.</p>");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::SnapshotPageMeta;
    use crate::version_diff::{
        DiffSummary, Hunk, HunkKind, PathRef, VersionDiff, WordEdit, WordEditKind,
    };
    use serde_json::json;
    use std::collections::BTreeMap;

    fn para(text: &str) -> BlockNode {
        let id = Uuid::new_v4();
        BlockNode {
            node_type: "paragraph".to_string(),
            id: Some(id),
            data: json!({"delta": [{"insert": text}], "blockId": id.to_string()}),
            children: vec![],
        }
    }

    fn rich_para(ops: Value) -> BlockNode {
        let id = Uuid::new_v4();
        BlockNode {
            node_type: "paragraph".to_string(),
            id: Some(id),
            data: json!({"delta": ops, "blockId": id.to_string()}),
            children: vec![],
        }
    }

    fn heading(text: &str, level: i64) -> BlockNode {
        let id = Uuid::new_v4();
        BlockNode {
            node_type: "heading".to_string(),
            id: Some(id),
            data: json!({"delta": [{"insert": text}], "level": level, "blockId": id.to_string()}),
            children: vec![],
        }
    }

    fn item(text: &str, children: Vec<BlockNode>) -> BlockNode {
        BlockNode {
            node_type: "listItem".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({"delta": [{"insert": text}]}),
            children,
        }
    }

    fn bullet_list(children: Vec<BlockNode>) -> BlockNode {
        BlockNode {
            node_type: "bulletList".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({}),
            children,
        }
    }

    #[test]
    fn heading_level_clamps_and_defaults() {
        assert_eq!(
            tree_to_markdown(&BlockNode::page_root(vec![heading("T", 2)])),
            "## T\n"
        );
        assert_eq!(
            tree_to_markdown(&BlockNode::page_root(vec![heading("Big", 99)])),
            "###### Big\n"
        );
        assert_eq!(
            tree_to_markdown(&BlockNode::page_root(vec![heading("Zero", 0)])),
            "# Zero\n"
        );
        let no_level = para("x");
        let mut h = no_level.clone();
        h.node_type = "heading".to_string();
        h.data = json!({"delta": [{"insert": "D"}]});
        assert_eq!(tree_to_markdown(&BlockNode::page_root(vec![h])), "# D\n");
        assert_eq!(
            tree_to_html(&BlockNode::page_root(vec![heading("T", 3)])),
            "<h3>T</h3>"
        );
    }

    #[test]
    fn paragraph_renders_in_both_formats() {
        let tree = BlockNode::page_root(vec![para("Hello world")]);
        assert_eq!(tree_to_markdown(&tree), "Hello world\n");
        assert_eq!(tree_to_html(&tree), "<p>Hello world</p>");
    }

    #[test]
    fn nested_bullet_list_indents_two_spaces() {
        let tree = BlockNode::page_root(vec![bullet_list(vec![
            item("a", vec![bullet_list(vec![item("b", vec![])])]),
            item("c", vec![]),
        ])]);
        assert_eq!(tree_to_markdown(&tree), "- a\n  - b\n- c\n");
        let html = tree_to_html(&tree);
        assert!(html.contains("<ul>"));
        assert!(html.contains("<li>a<ul>"));
        assert!(html.contains("<li>b</li>"));
    }

    #[test]
    fn legacy_bulleted_list_item_is_a_bullet_list() {
        let legacy = BlockNode {
            node_type: "bulleted_list_item".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({}),
            children: vec![item("x", vec![])],
        };
        assert_eq!(
            tree_to_markdown(&BlockNode::page_root(vec![legacy])),
            "- x\n"
        );
    }

    #[test]
    fn ordered_list_uses_numbered_markers() {
        let list = BlockNode {
            node_type: "orderedList".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({}),
            children: vec![item("first", vec![]), item("second", vec![])],
        };
        let tree = BlockNode::page_root(vec![list]);
        assert_eq!(tree_to_markdown(&tree), "1. first\n1. second\n");
        let html = tree_to_html(&tree);
        assert!(html.contains("<ol>"));
        assert!(html.contains("<li>first</li>"));
    }

    #[test]
    fn blockquote_prefixes_each_line() {
        let quote = BlockNode {
            node_type: "blockquote".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({}),
            children: vec![para("quoted words")],
        };
        let tree = BlockNode::page_root(vec![quote]);
        assert_eq!(tree_to_markdown(&tree), "> quoted words\n");
        assert_eq!(
            tree_to_html(&tree),
            "<blockquote><p>quoted words</p></blockquote>"
        );
    }

    #[test]
    fn code_block_language_and_escaping() {
        let code = BlockNode {
            node_type: "codeBlock".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({"delta": [{"insert": "<b>&amp;"}], "language": "rust"}),
            children: vec![],
        };
        let tree = BlockNode::page_root(vec![code]);
        assert_eq!(tree_to_markdown(&tree), "```rust\n<b>&amp;\n```\n");
        let html = tree_to_html(&tree);
        assert!(html.contains("<pre><code class=\"language-rust\">"));
        assert!(html.contains("&lt;b&gt;&amp;amp;"));
        assert!(!html.contains("<b>"));
    }

    #[test]
    fn subpage_placeholder_never_recurses() {
        let secret = Uuid::new_v4();
        let sub = BlockNode {
            node_type: "page".to_string(),
            id: Some(secret),
            data: json!({"title": "Secret Chapter"}),
            children: vec![para("must not leak")],
        };
        let tree = BlockNode::page_root(vec![sub]);
        let md = tree_to_markdown(&tree);
        assert!(md.contains("> (sub-page: Secret Chapter)"));
        assert!(!md.contains("must not leak"));
        let html = tree_to_html(&tree);
        assert!(html.contains("<p class=\"subpage\">"));
        assert!(html.contains("Secret Chapter"));
        assert!(!html.contains("must not leak"));
    }

    #[test]
    fn subpage_placeholder_title_is_single_line_in_markdown() {
        let sub = BlockNode {
            node_type: "page".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({"title": "x\n# evil"}),
            children: vec![],
        };
        let tree = BlockNode::page_root(vec![sub]);
        let md = tree_to_markdown(&tree);
        assert!(
            !md.lines().any(|l| l == "# evil"),
            "injected heading leaked: {md}"
        );
        assert_eq!(md.lines().count(), 1, "placeholder is one line: {md}");
        assert!(md.contains("> (sub-page: x # evil)"), "{md}");
    }

    #[test]
    fn annotation_blocks_are_skipped() {
        let ann = BlockNode {
            node_type: "annotation".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({"delta": [{"insert": "hidden"}]}),
            children: vec![],
        };
        let tree = BlockNode::page_root(vec![ann, para("visible")]);
        assert_eq!(tree_to_markdown(&tree), "visible\n");
        assert_eq!(tree_to_html(&tree), "<p>visible</p>");
    }

    #[test]
    fn inline_marks_render_in_both_formats() {
        let ops = json!([
            {"insert": "b", "attributes": {"bold": true}},
            {"insert": "i", "attributes": {"italic": true}},
            {"insert": "c", "attributes": {"code": true}},
            {"insert": "l", "attributes": {"link": "https://example.com"}},
            {"insert": "plain"},
        ]);
        let md = tree_to_markdown(&BlockNode::page_root(vec![rich_para(ops.clone())]));
        assert!(md.contains("**b**"), "{md}");
        assert!(md.contains("*i*"), "{md}");
        assert!(md.contains("`c`"), "{md}");
        assert!(md.contains("[l](https://example.com)"), "{md}");
        assert!(md.contains("plain"), "{md}");
        let html = tree_to_html(&BlockNode::page_root(vec![rich_para(ops)]));
        assert!(html.contains("<strong>b</strong>"), "{html}");
        assert!(html.contains("<em>i</em>"), "{html}");
        assert!(html.contains("<code>c</code>"), "{html}");
        assert!(
            html.contains("<a href=\"https://example.com\">l</a>"),
            "{html}"
        );
    }

    #[test]
    fn html_injection_is_escaped() {
        let evil = "<script>alert(\"x\")</script>";
        let tree = BlockNode::page_root(vec![rich_para(json!([
            {"insert": evil},
            {"insert": "click", "attributes": {"link": "javascript:alert(1)"}},
        ]))]);
        let html = tree_to_html(&tree);
        assert!(!html.contains("<script"), "{html}");
        assert!(html.contains("&lt;script&gt;"), "{html}");
        assert!(html.contains("&quot;x&quot;"), "{html}");
        assert!(!html.contains("href=\"javascript:"), "{html}");
        assert!(!html.contains("<a"), "{html}");
        assert!(html.contains("click"), "{html}");
        let md = tree_to_markdown(&tree);
        assert!(!md.contains("](javascript:"), "{md}");
        assert!(md.contains("click"), "{md}");
    }

    #[test]
    fn unsafe_link_schemes_render_text_only() {
        for scheme in [
            "javascript:alert(1)",
            "JAVASCRIPT:alert(1)",
            "  javascript:alert(1)  ",
            "data:text/html,<b>x</b>",
            "vbscript:msgbox(1)",
            "ftp://example.com/x",
        ] {
            let tree = BlockNode::page_root(vec![rich_para(json!([
                {"insert": "click", "attributes": {"link": scheme}},
            ]))]);
            let html = tree_to_html(&tree);
            assert!(!html.contains("<a"), "{scheme}: {html}");
            assert!(!html.contains("href="), "{scheme}: {html}");
            assert!(html.contains("click"), "{scheme}: {html}");
            let md = tree_to_markdown(&tree);
            assert!(!md.contains("]("), "{scheme}: {md}");
            assert!(md.contains("click"), "{scheme}: {md}");
        }
    }

    #[test]
    fn safe_link_schemes_still_link() {
        for url in [
            "https://example.com/x",
            "http://example.com/x",
            "HTTPS://example.com/x",
            "mailto:user@example.com",
            "  https://example.com/padded  ",
        ] {
            let tree = BlockNode::page_root(vec![rich_para(json!([
                {"insert": "go", "attributes": {"link": url}},
            ]))]);
            let html = tree_to_html(&tree);
            assert!(html.contains("<a href=\""), "{url}: {html}");
            let md = tree_to_markdown(&tree);
            let md_lower = md.to_ascii_lowercase();
            assert!(
                md_lower.contains("](https://")
                    || md_lower.contains("](http://")
                    || md_lower.contains("](mailto:"),
                "{url}: {md}"
            );
        }
    }

    #[test]
    fn code_block_language_is_sanitized() {
        let code = BlockNode {
            node_type: "codeBlock".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({"delta": [{"insert": "let x = 1;"}], "language": "rust\n```\n"}),
            children: vec![],
        };
        let md = tree_to_markdown(&BlockNode::page_root(vec![code]));
        assert!(md.starts_with("```rust\n"), "{md}");
        assert!(!md.contains("```\n```"), "{md}");
        let code_html = BlockNode {
            node_type: "codeBlock".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({"delta": [{"insert": "x"}], "language": "rust\"\nonmouseover=\"y"}),
            children: vec![],
        };
        let html = tree_to_html(&BlockNode::page_root(vec![code_html]));
        assert!(!html.contains('\n'), "{html}");
        assert!(!html.contains("onmouseover=\""), "{html}");
        assert!(html.contains("language-rustonmouseovery"), "{html}");
    }

    #[test]
    fn code_block_content_with_backticks_is_fenced_safely() {
        let content = "a ``` triple\nand `` double";
        let code = BlockNode {
            node_type: "codeBlock".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({"delta": [{"insert": content}], "language": "rust"}),
            children: vec![],
        };
        let md = tree_to_markdown(&BlockNode::page_root(vec![code]));
        assert!(md.starts_with("````rust\n"), "{md}");
        assert!(md.contains(content), "{md}");
        assert!(md.trim_end().ends_with("````"), "{md}");
    }

    #[test]
    fn hostile_titles_and_labels_cannot_inject_lines() {
        let mut env = two_page_envelope();
        env.pages[1].title = "x\n# evil".to_string();
        let md = envelope_to_markdown(&env);
        assert!(!md.lines().any(|l| l == "# evil"), "{md}");
        assert!(md.contains("# x # evil"), "{md}");

        let mut diff = sample_diff();
        diff.truncated = false;
        let rendered = diff_to_markdown(&diff, "a\n# evil", "b");
        assert!(!rendered.lines().any(|l| l == "# evil"), "{rendered}");

        let mut headed = sample_diff();
        headed.truncated = false;
        headed.hunks[0].path = vec!["ok\n# evil".to_string()];
        let rendered_path = diff_to_markdown(&headed, "v1", "v2");
        assert!(
            !rendered_path.lines().any(|l| l == "# evil"),
            "{rendered_path}"
        );
    }

    #[test]
    fn truncated_diff_exports_carry_a_notice() {
        let mut diff = sample_diff();
        diff.truncated = true;
        let md = diff_to_markdown(&diff, "v1", "v2");
        assert!(
            md.contains(
                "> _Output truncated — more hunks exist. Use the API with a larger limit or cursor._"
            ),
            "{md}"
        );
        let html = diff_to_html(&diff, "v1", "v2");
        assert!(
            html.contains("<p class=\"truncated\">Output truncated — more hunks exist.</p>"),
            "{html}"
        );

        let mut plain = sample_diff();
        plain.truncated = false;
        assert!(!diff_to_markdown(&plain, "v1", "v2").contains("truncated — more"),);
        assert!(!diff_to_html(&plain, "v1", "v2").contains("truncated"),);
    }

    #[test]
    fn unknown_types_render_children_only() {
        let mystery = BlockNode {
            node_type: "mystery".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({}),
            children: vec![para("kept")],
        };
        assert_eq!(
            tree_to_markdown(&BlockNode::page_root(vec![mystery])),
            "kept\n"
        );
    }

    fn two_page_envelope() -> SnapshotEnvelope {
        let root = Uuid::new_v4();
        let child = Uuid::new_v4();
        SnapshotEnvelope {
            version: 1,
            root_page_id: root,
            pages: vec![
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
                    title: "Chapter One".to_string(),
                    parent_page_id: Some(root),
                    ordinal: 0,
                    narrative_order: Some(1),
                },
            ],
            trees: BTreeMap::from([
                (
                    root.to_string(),
                    BlockNode::page_root(vec![para("root body")]),
                ),
                (
                    child.to_string(),
                    BlockNode::page_root(vec![para("child body")]),
                ),
            ]),
        }
    }

    #[test]
    fn envelope_render_includes_descendant_titles() {
        let env = two_page_envelope();
        let md = envelope_to_markdown(&env);
        assert!(md.contains("root body"), "{md}");
        assert!(md.contains("# Chapter One"), "{md}");
        assert!(md.contains("child body"), "{md}");
        let html = envelope_to_html(&env);
        assert!(html.contains("<h1>Chapter One</h1>"), "{html}");
        assert!(html.contains("child body"), "{html}");
    }

    #[test]
    fn envelope_page_missing_returns_empty() {
        let env = two_page_envelope();
        assert_eq!(envelope_page_to_markdown(&env, Uuid::new_v4()), "");
        assert_eq!(envelope_page_to_html(&env, Uuid::new_v4()), "");
    }

    fn sample_diff() -> VersionDiff {
        let page = Uuid::new_v4();
        VersionDiff {
            summary: crate::version_diff::DiffSummary {
                added: 1,
                removed: 1,
                moved: 1,
                edited: 1,
                pages_changed: 1,
            },
            hunks: vec![
                Hunk {
                    block_id: Uuid::new_v4(),
                    page_id: page,
                    kind: HunkKind::Added,
                    path: vec![],
                    before_text: None,
                    after_text: Some("brand new".to_string()),
                    word_edits: vec![],
                    moved_from: None,
                },
                Hunk {
                    block_id: Uuid::new_v4(),
                    page_id: page,
                    kind: HunkKind::Removed,
                    path: vec![],
                    before_text: Some("gone".to_string()),
                    after_text: None,
                    word_edits: vec![],
                    moved_from: None,
                },
                Hunk {
                    block_id: Uuid::new_v4(),
                    page_id: page,
                    kind: HunkKind::Moved,
                    path: vec!["Ch1".to_string()],
                    before_text: Some("lifted".to_string()),
                    after_text: Some("lifted".to_string()),
                    word_edits: vec![],
                    moved_from: Some(PathRef {
                        page_id: page,
                        block_id: Uuid::new_v4(),
                        path: vec![],
                    }),
                },
                Hunk {
                    block_id: Uuid::new_v4(),
                    page_id: page,
                    kind: HunkKind::Edited,
                    path: vec![],
                    before_text: Some("a b c".to_string()),
                    after_text: Some("a x c".to_string()),
                    word_edits: vec![
                        WordEdit {
                            kind: WordEditKind::Eq,
                            text: "a".to_string(),
                        },
                        WordEdit {
                            kind: WordEditKind::Del,
                            text: "b".to_string(),
                        },
                        WordEdit {
                            kind: WordEditKind::Ins,
                            text: "x".to_string(),
                        },
                        WordEdit {
                            kind: WordEditKind::Eq,
                            text: "c".to_string(),
                        },
                    ],
                    moved_from: None,
                },
                Hunk {
                    block_id: page,
                    page_id: page,
                    kind: HunkKind::PageTitle,
                    path: vec![],
                    before_text: Some("Old".to_string()),
                    after_text: Some("New".to_string()),
                    word_edits: vec![],
                    moved_from: None,
                },
            ],
            truncated: false,
        }
    }

    #[test]
    fn diff_markdown_renders_every_kind_and_marks_edits() {
        let md = diff_to_markdown(&sample_diff(), "v1", "v2");
        assert!(md.contains("# Diff from v1 to v2"), "{md}");
        for section in [
            "## Added",
            "## Removed",
            "## Moved",
            "## Edited",
            "## Page titles",
        ] {
            assert!(md.contains(section), "{md}");
        }
        assert!(md.contains("brand new"), "{md}");
        assert!(md.contains("gone"), "{md}");
        assert!(md.contains("~~b~~"), "{md}");
        assert!(md.contains("**x**"), "{md}");
        assert!(md.contains("\"Old\" → \"New\""), "{md}");
    }

    #[test]
    fn diff_html_renders_every_kind_with_del_ins() {
        let html = diff_to_html(&sample_diff(), "v1", "v2");
        assert!(html.contains("<h1>Diff from v1 to v2</h1>"), "{html}");
        assert!(html.contains("<del>b</del>"), "{html}");
        assert!(html.contains("<ins>x</ins>"), "{html}");
        assert!(html.contains("brand new"), "{html}");
        assert!(!html.contains("<script"), "{html}");
    }

    #[test]
    fn empty_diff_renders_no_changes() {
        let diff = VersionDiff {
            summary: DiffSummary::default(),
            hunks: vec![],
            truncated: false,
        };
        assert!(diff_to_markdown(&diff, "a", "b").contains("No changes."));
        assert!(diff_to_html(&diff, "a", "b").contains("No changes."));
    }

    #[test]
    fn export_format_parse_extension_content_type() {
        assert_eq!(ExportFormat::parse("md"), Some(ExportFormat::Markdown));
        assert_eq!(
            ExportFormat::parse("MARKDOWN"),
            Some(ExportFormat::Markdown)
        );
        assert_eq!(ExportFormat::parse("Html"), Some(ExportFormat::Html));
        assert_eq!(ExportFormat::parse("pdf"), None);
        assert_eq!(ExportFormat::Markdown.extension(), "md");
        assert_eq!(ExportFormat::Html.extension(), "html");
        assert_eq!(
            ExportFormat::Markdown.content_type(),
            "text/markdown; charset=utf-8"
        );
        assert_eq!(
            ExportFormat::Html.content_type(),
            "text/html; charset=utf-8"
        );
    }

    #[test]
    fn escape_html_covers_specials() {
        assert_eq!(escape_html("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
    }

    #[test]
    fn collapsed_toggle_omits_hidden_children() {
        let toggle = BlockNode {
            node_type: "toggle".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({"collapsed": true}),
            children: vec![para("Summary"), para("Hidden")],
        };
        let tree = BlockNode::page_root(vec![toggle]);
        let md = tree_to_markdown(&tree);
        assert!(md.contains("Summary"), "{md}");
        assert!(!md.contains("Hidden"), "{md}");
        let html = tree_to_html(&tree);
        assert!(html.contains("Summary"), "{html}");
        assert!(!html.contains("Hidden"), "{html}");
    }

    #[test]
    fn expanded_toggle_includes_all_children() {
        let toggle = BlockNode {
            node_type: "toggle".to_string(),
            id: Some(Uuid::new_v4()),
            data: json!({"collapsed": false}),
            children: vec![para("Summary"), para("Hidden")],
        };
        let tree = BlockNode::page_root(vec![toggle]);
        let md = tree_to_markdown(&tree);
        assert!(md.contains("Summary"), "{md}");
        assert!(md.contains("Hidden"), "{md}");
        let html = tree_to_html(&tree);
        assert!(html.contains("Summary"), "{html}");
        assert!(html.contains("Hidden"), "{html}");
    }

    #[test]
    fn spoiler_ops_are_omitted_in_both_formats() {
        let node = rich_para(json!([
            {"insert": "visible "},
            {"insert": "secret", "attributes": {"spoiler": true}},
        ]));
        let tree = BlockNode::page_root(vec![node]);
        let md = tree_to_markdown(&tree);
        assert!(md.contains("visible"), "{md}");
        assert!(!md.contains("secret"), "{md}");
        let html = tree_to_html(&tree);
        assert!(html.contains("visible"), "{html}");
        assert!(!html.contains("secret"), "{html}");
    }

    #[test]
    fn malformed_input_renders_sensibly_without_panic() {
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
        let tree = BlockNode::page_root(vec![weird]);
        // Unknown wrapper renders children; the grandchildren carry no
        // string inserts, so the document is empty but well-formed.
        assert_eq!(tree_to_markdown(&tree), "");
        assert_eq!(tree_to_html(&tree), "");
    }
}
