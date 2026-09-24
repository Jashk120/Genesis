/**
 * Pure range math for the focused-passage scope.
 *
 * A focus scope is always a contiguous run of top-level blocks (the direct
 * children of the ProseMirror doc). These helpers map between ProseMirror
 * document positions and the block ids that anchor the scope across saves
 * (see the `FocusScope` extension and the `BlockId` extension).
 *
 * Kept free of `prosemirror-view`/`prosemirror-state` imports so the math can
 * be unit-tested in a plain Node environment (see focusRange.test.ts).
 */
import type { Node as PMNode } from "@tiptap/pm/model";

/** A contiguous position range `[from, to)` over the doc's top-level blocks. */
export interface BlockRange {
  from: number;
  to: number;
}

interface Span {
  index: number;
  start: number;
  end: number;
  blockId: string | null;
}

function blockIdOf(node: PMNode): string | null {
  const raw: unknown = node.attrs["blockId"];
  return typeof raw === "string" && raw !== "" ? raw : null;
}

function spans(doc: PMNode): Span[] {
  const out: Span[] = [];
  doc.forEach((node, offset, index) => {
    out.push({
      index,
      start: offset,
      end: offset + node.nodeSize,
      blockId: blockIdOf(node),
    });
  });
  return out;
}

/**
 * Expand `[from, to]` to the minimal contiguous run of whole top-level blocks
 * that covers it. A boundary that sits exactly between two blocks belongs to
 * the block on the side the range actually enters: a selection ending at a
 * block's start does not include that block, and one starting at a block's end
 * does not include the block before it.
 */
export function expandToTopLevelBlocks(doc: PMNode, from: number, to: number): BlockRange {
  const list = spans(doc);
  if (list.length === 0) return { from: 0, to: 0 };

  const lo = Math.max(0, Math.min(from, doc.content.size));
  const hi = Math.max(0, Math.min(to, doc.content.size));

  const last = list[list.length - 1];
  if (last === undefined) return { from: 0, to: 0 };

  let startIndex = last.index;
  for (const s of list) {
    if (lo < s.end) {
      startIndex = s.index;
      break;
    }
  }

  let endIndex = startIndex;
  for (const s of list) {
    if (hi > s.start) endIndex = s.index;
  }
  if (endIndex < startIndex) endIndex = startIndex;

  const startSpan = list[startIndex];
  const endSpan = list[endIndex];
  if (startSpan === undefined || endSpan === undefined) return { from: 0, to: 0 };
  return { from: startSpan.start, to: endSpan.end };
}

/**
 * Block ids of the first and last top-level blocks covered by `[from, to]`.
 * Either id is `null` when the block carries no `blockId` attribute.
 */
export function topLevelBlockIds(
  doc: PMNode,
  from: number,
  to: number,
): { fromId: string | null; toId: string | null } {
  const list = spans(doc);
  if (list.length === 0) return { fromId: null, toId: null };
  const range = expandToTopLevelBlocks(doc, from, to);
  const startSpan = list.find((s) => s.start === range.from);
  const endSpan = list.find((s) => s.end === range.to);
  return {
    fromId: startSpan?.blockId ?? null,
    toId: endSpan?.blockId ?? null,
  };
}

export function countTopLevelBlocks(doc: PMNode, range: BlockRange): number {
  let count = 0;
  doc.forEach((node, offset) => {
    if (offset >= range.from && offset + node.nodeSize <= range.to) count += 1;
  });
  return count;
}

/**
 * Resolve two block ids back to a top-level block range. Order-insensitive
 * (the two ids may be given in either order). Returns `null` when either id is
 * missing from the document.
 */
export function rangeFromBlockIds(doc: PMNode, fromId: string, toId: string): BlockRange | null {
  const list = spans(doc);
  const a = list.find((s) => s.blockId === fromId);
  const b = list.find((s) => s.blockId === toId);
  if (a === undefined || b === undefined) return null;
  const lo = Math.min(a.index, b.index);
  const hi = Math.max(a.index, b.index);
  const startSpan = list[lo];
  const endSpan = list[hi];
  if (startSpan === undefined || endSpan === undefined) return null;
  return { from: startSpan.start, to: endSpan.end };
}
