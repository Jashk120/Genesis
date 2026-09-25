import { Fragment } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface HiddenRange {
  from: number;
  to: number;
}

/** Doc ranges hidden because they are non-first children of a collapsed toggle. */
export function collapsedHiddenRanges(doc: PMNode): HiddenRange[] {
  const out: HiddenRange[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "toggle" || node.attrs["collapsed"] !== true) return true;
    let i = 0;
    node.forEach((child, offset) => {
      if (i === 0) {
        i += 1;
        return;
      }
      const start = pos + 1 + offset;
      out.push({ from: start, to: start + child.nodeSize });
    });
    return true;
  });
  return out;
}

export function positionIsHidden(pos: number, ranges: HiddenRange[]): boolean {
  return ranges.some((r) => pos >= r.from && pos < r.to);
}

function hasSpoilerMark(node: PMNode): boolean {
  return node.marks.some((mark) => mark.type.name === "spoiler");
}

/**
 * Copy-safe projection of a node: collapsed toggles keep only their first
 * child, spoiler-marked text is dropped, everything else is preserved.
 */
export function stripNode(node: PMNode): PMNode | null {
  if (hasSpoilerMark(node)) return null;
  if (node.type.name === "toggle" && node.attrs["collapsed"] === true) {
    const firstChild = node.firstChild;
    if (firstChild === null) return node;
    const strippedFirst = stripNode(firstChild);
    if (strippedFirst === null) return null;
    return node.type.create(node.attrs, Fragment.fromArray([strippedFirst]), node.marks);
  }
  if (node.isLeaf) return node;
  const stripped: PMNode[] = [];
  node.forEach((child) => {
    const next = stripNode(child);
    if (next !== null) stripped.push(next);
  });
  return node.type.create(node.attrs, Fragment.fromArray(stripped), node.marks);
}

export function stripFragment(fragment: Fragment): Fragment {
  const kept: PMNode[] = [];
  fragment.forEach((child) => {
    const next = stripNode(child);
    if (next !== null) kept.push(next);
  });
  return Fragment.fromArray(kept);
}
