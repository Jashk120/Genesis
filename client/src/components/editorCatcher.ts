import type { EditorState } from "@tiptap/pm/state";

/**
 * Pure helpers for the empty-area click catcher in PageEditor (the div after
 * `<EditorContent>` that lets clicking blank space below the document place
 * a caret at the end). DOM-free so they run in the node vitest environment.
 */

/**
 * Selector for elements whose clicks the catcher must ignore: editor content
 * (ProseMirror handles those itself), the gutter, toolbars, and natively
 * interactive elements.
 */
export const CATCHER_IGNORE_SELECTOR =
  '.ProseMirror, .block-gutter, .format-toolbar, .fmt-bar, button, a, input, textarea, select, [contenteditable="false"]';

/**
 * Decide whether a click on `target` should trigger the focus-at-end
 * behavior. Returns false for clicks inside the editor, gutter, toolbars,
 * or interactive elements.
 */
export function shouldFocusCatcherOnClick(target: EventTarget | null): boolean {
  if (target === null) return false;
  if (typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  return target.closest(CATCHER_IGNORE_SELECTOR) === null;
}

export interface CatcherFocusTarget {
  /** True when a new empty paragraph must be appended at `pos`. */
  insert: boolean;
  /**
   * Caret position when `insert` is false (inside the existing empty last
   * paragraph), or the append position (end of doc content) when true.
   */
  pos: number;
}

/**
 * Mirror AppFlowy's `_focusOnLastEmptyParagraph`: when the last top-level
 * node is an empty paragraph, focus inside it; otherwise append a new empty
 * paragraph at the end and focus that.
 */
export function catcherFocusTarget(state: EditorState): CatcherFocusTarget {
  const doc = state.doc;
  const last = doc.lastChild;
  if (last !== null && last.type.name === "paragraph" && last.textContent === "") {
    return { insert: false, pos: doc.content.size - last.nodeSize + 1 };
  }
  return { insert: true, pos: doc.content.size };
}
