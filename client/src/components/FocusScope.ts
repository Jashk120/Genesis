/**
 * Focused-passage scope for the document editor.
 *
 * The scope is a contiguous run of top-level blocks the user is "zoomed" into.
 * The document is never split or copied: the same editor instance keeps the
 * same undo history, and the scope is only a position range held in plugin
 * state plus a set of node decorations that hide the blocks outside it. Edits
 * at the boundary grow or shrink the scope naturally, because the range is
 * mapped through every transaction (see `apply`).
 *
 * The route/URL that activates a scope is owned by `App`; this extension is
 * the editor-side mechanism only.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** A contiguous position range `[from, to)` over the doc's top-level blocks. */
export interface FocusScopeRange {
  from: number;
  to: number;
}

interface FocusScopeState {
  range: FocusScopeRange | null;
}

type FocusScopeAction = { type: "set"; from: number; to: number } | { type: "clear" };

export const focusScopeKey = new PluginKey<FocusScopeState>("focusScope");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    focusScope: {
      /** Activate a scope over `[from, to]` (top-level block positions). */
      setFocusScope: (from: number, to: number) => ReturnType;
      /** Deactivate the scope, revealing the whole document. */
      clearFocusScope: () => ReturnType;
    };
  }
}

/** The active scope range, or `null` when the whole document is shown. */
export function getFocusScope(state: EditorState): FocusScopeRange | null {
  return focusScopeKey.getState(state)?.range ?? null;
}

export function hiddenDecorations(doc: PMNode, range: FocusScopeRange): DecorationSet {
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    const start = offset;
    const end = offset + node.nodeSize;
    if (end <= range.from || start >= range.to) {
      decorations.push(Decoration.node(start, end, { "data-focus-hidden": "true" }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const focusScopePlugin = new Plugin<FocusScopeState>({
  key: focusScopeKey,

  state: {
    init: () => ({ range: null }),
    apply(tr, previous) {
      const action = tr.getMeta(focusScopeKey) as FocusScopeAction | undefined;
      if (action !== undefined) {
        return action.type === "clear"
          ? { range: null }
          : { range: { from: action.from, to: action.to } };
      }
      if (previous.range === null) return previous;

      // Grow with insertions at the edges (assoc -1 keeps `from` before text
      // inserted there; assoc +1 pushes `to` after text inserted at the end),
      // and shrink when boundary content is removed.
      const fromMapped = tr.mapping.mapResult(previous.range.from, -1);
      const toMapped = tr.mapping.mapResult(previous.range.to, 1);

      const max = tr.doc.content.size;
      const from = Math.max(0, Math.min(fromMapped.pos, max));
      const to = Math.max(0, Math.min(toMapped.pos, max));
      if (from >= to) return { range: null };
      return { range: { from, to } };
    },
  },

  props: {
    decorations(state) {
      const range = focusScopeKey.getState(state)?.range ?? null;
      if (range === null) return null;
      return hiddenDecorations(state.doc, range);
    },

    handleKeyDown(view, event) {
      const range = focusScopeKey.getState(view.state)?.range ?? null;
      if (range === null) return false;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
        const selection = TextSelection.between(
          view.state.doc.resolve(range.from),
          view.state.doc.resolve(range.to),
        );
        view.dispatch(view.state.tr.setSelection(selection));
        event.preventDefault();
        return true;
      }
      return false;
    },
  },

  appendTransaction(transactions, _oldState, newState) {
    const range = focusScopeKey.getState(newState)?.range ?? null;
    if (range === null) return null;

    const touchedScope = transactions.some((tr) => tr.getMeta(focusScopeKey) !== undefined);
    if (!touchedScope && transactions.every((tr) => !tr.docChanged && !tr.selectionSet)) {
      return null;
    }

    const { selection } = newState;
    if (selection.from >= range.from && selection.to <= range.to) return null;

    // Keep the caret inside the visible passage so it can never land in a
    // hidden block (which would edit content the user cannot see).
    const head = selection.head;
    const target = Math.max(range.from, Math.min(head, range.to));
    const bias = head > range.to ? -1 : 1;
    try {
      const clamped = Selection.near(newState.doc.resolve(target), bias);
      return newState.tr.setSelection(clamped).setMeta("addToHistory", false);
    } catch {
      return null;
    }
  },
});

export const FocusScope = Extension.create({
  name: "focusScope",

  addProseMirrorPlugins() {
    return [focusScopePlugin];
  },

  addCommands() {
    return {
      setFocusScope:
        (from: number, to: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(focusScopeKey, { type: "set", from, to } satisfies FocusScopeAction);
            dispatch(tr);
          }
          return true;
        },
      clearFocusScope:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(focusScopeKey, { type: "clear" } satisfies FocusScopeAction);
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
