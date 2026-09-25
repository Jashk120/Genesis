/**
 * Canonical "delta block tree" types + ProseMirror JSON types.
 *
 * The delta block tree is the canonical, editor-agnostic document format
 * (see narrative-engine-spec.md: "Document model" / "Document format and
 * the editor" / "Blocks"). Tiptap/ProseMirror JSON is an editor-side
 * representation only. `src/mapper/` is the single place that knows
 * ProseMirror shapes; everything else (API, storage payloads, UI state)
 * works with the canonical tree.
 */

/** Quill-style inline attributes. Only the v1 mark set is supported. */
export type DeltaAttributes = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Inline spoiler (hidden/blurred text). */
  spoiler?: boolean;
  /** Link target URL. */
  link?: string;
  [key: string]: unknown;
};

/** One Quill-style insert op. `insert` is always a string in v1 (no embeds). */
export interface DeltaOp {
  insert: string;
  attributes?: DeltaAttributes;
}

export type Delta = DeltaOp[];

/** Canonical block type names (v1 supported set). */
export const SUPPORTED_BLOCK_TYPES = [
  "page",
  "heading",
  "paragraph",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "toggle",
  "codeBlock",
] as const;

export type CanonicalBlockType = (typeof SUPPORTED_BLOCK_TYPES)[number];

/** Canonical inline marks (v1 supported set). */
export const SUPPORTED_MARKS = ["bold", "italic", "code", "link", "spoiler"] as const;

export type SupportedMark = (typeof SUPPORTED_MARKS)[number];

/**
 * Type-specific payload. Block attributes (level, checked, url, language,
 * blockId, ...) live OUTSIDE the delta, in `data` — never inside ops.
 */
export interface BlockData {
  /** Stable block identity shared with the store; mapped to a PM node attr. */
  blockId?: string;
  /** Child page reference (inline sub-page). Present only on `page` blocks
   * that reference a child Page; the document root `page` has no `pageId`. */
  pageId?: string;
  /** Quill-style ops array. Absent means "no text" (treated as empty). */
  delta?: Delta;
  /** Heading level 1-6 (heading only). */
  level?: number;
  /** Code fence language (codeBlock only). */
  language?: string;
  /** Toggle-only: true when the toggle's child blocks are hidden. */
  collapsed?: boolean;
  /** Extension point for future block attributes; unknown keys are rejected
   * by the mapper unless explicitly supported. */
  [key: string]: unknown;
}

export interface DeltaBlock {
  type: CanonicalBlockType;
  data: BlockData;
  children?: DeltaBlock[];
}

/** Canonical page document. `data` is optional on the root. */
export interface DeltaTree {
  type: "page";
  data?: Pick<BlockData, "blockId">;
  children: DeltaBlock[];
}

/** Minimal ProseMirror JSON node (what Tiptap `getJSON()` produces). */
export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}

/** ProseMirror doc node. */
export interface PMDoc {
  type: "doc";
  attrs?: Record<string, unknown>;
  content: PMNode[];
}
