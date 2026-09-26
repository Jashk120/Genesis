import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Pure position math for the block gutter's add button.
 *
 * The gutter hovers blocks that may be nested (e.g. paragraphs inside a
 * toggle's `.toggle-content`), so insert positions are derived from the DOM
 * element's document position instead of top-level child-index arithmetic.
 * These helpers only touch the ProseMirror document model, which keeps them
 * runnable in the node vitest environment.
 */

export interface GutterInsertTarget {
  /** True when the hovered block is itself an empty paragraph (focus it). */
  emptyParagraph: boolean;
  /** Size of the hovered block node, for computing the insert position. */
  nodeSize: number;
}

/**
 * Normalize a raw document position (e.g. from `view.posAtDOM(el, 0)`) to
 * the position directly before the enclosing block node. When the raw
 * position already sits before a block it is returned unchanged; when it
 * landed inside a textblock (inline content or its end) we step out to that
 * block's start. Returns null when no enclosing block exists.
 */
export function blockBeforeFromPos(doc: PMNode, rawPos: number): number | null {
  if (rawPos < 0 || rawPos > doc.content.size) return null;
  const $pos = doc.resolve(rawPos);
  const after = $pos.nodeAfter;
  if (after !== null && after.isBlock) return rawPos;
  for (let d = $pos.depth; d >= 1; d--) {
    if ($pos.node(d).isBlock) return $pos.before(d);
  }
  return null;
}

/**
 * Describe the hovered block starting at `before` (a value produced by
 * `blockBeforeFromPos`). Returns null when `before` does not start a block.
 */
export function gutterInsertTarget(doc: PMNode, before: number): GutterInsertTarget | null {
  if (before < 0 || before > doc.content.size) return null;
  const node = doc.resolve(before).nodeAfter;
  if (node === null || !node.isBlock) return null;
  return {
    emptyParagraph: node.type.name === "paragraph" && node.textContent === "",
    nodeSize: node.nodeSize,
  };
}
