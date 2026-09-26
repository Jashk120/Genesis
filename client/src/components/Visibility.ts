import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Slice } from "@tiptap/pm/model";
import { collapsedHiddenRanges, spoilerRunAt, spoilerRuns, stripFragment } from "./visibilityRanges";
import type { HiddenRange } from "./visibilityRanges";

export const visibilityKey = new PluginKey<VisibilityPluginState>("visibility");

interface VisibilityPluginState {
  revealed: HiddenRange[];
}

export const Visibility = Extension.create({
  name: "visibility",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: visibilityKey,

        state: {
          init: (): VisibilityPluginState => ({ revealed: [] }),
          apply(tr, previous: VisibilityPluginState): VisibilityPluginState {
            const action = tr.getMeta(visibilityKey) as
              | { type: "toggle-reveal"; from: number; to: number }
              | undefined;
            let revealed = previous.revealed
              .map((r) => ({ from: tr.mapping.map(r.from, 1), to: tr.mapping.map(r.to, -1) }))
              .filter((r) => r.to > r.from);
            if (action !== undefined) {
              const exists = revealed.some((r) => r.from === action.from && r.to === action.to);
              revealed = exists
                ? revealed.filter((r) => !(r.from === action.from && r.to === action.to))
                : [...revealed, { from: action.from, to: action.to }];
            }
            return { revealed };
          },
        },

        props: {
          transformCopied(slice: Slice, _view: EditorView): Slice {
            void _view;
            const strippedFragment = stripFragment(slice.content);
            return new Slice(strippedFragment, slice.openStart, slice.openEnd);
          },

          clipboardTextSerializer(slice: Slice): string {
            const stripped = stripFragment(slice.content);
            return stripped.textBetween(0, stripped.size, "\n\n");
          },

          decorations(state: EditorState) {
            const runs = spoilerRuns(state.doc);
            if (runs.length === 0) return null;
            const revealed = visibilityKey.getState(state)?.revealed ?? [];
            return DecorationSet.create(
              state.doc,
              runs.map((r) =>
                Decoration.inline(r.from, r.to, {
                  class: revealed.some((v) => r.from < v.to && v.from < r.to)
                    ? "spoiler-revealed"
                    : "spoiler-hidden",
                }),
              ),
            );
          },

          handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
            const el = event.target instanceof Element ? event.target.closest(".spoiler") : null;
            if (el === null) return false;
            const run = spoilerRunAt(view.state.doc, pos);
            if (run === null) return false;
            const revealed = visibilityKey.getState(view.state)?.revealed ?? [];
            // Once revealed, a spoiler behaves like ordinary editable text.
            // Only hidden spoilers consume the click to toggle visibility.
            if (revealed.some((r) => r.from < run.to && run.from < r.to)) return false;
            event.preventDefault();
            view.dispatch(
              view.state.tr.setMeta(visibilityKey, {
                type: "toggle-reveal",
                from: run.from,
                to: run.to,
              }),
            );
            return true;
          },
        },

        appendTransaction(
          transactions: readonly Transaction[],
          oldState: EditorState,
          newState: EditorState,
        ) {
          if (transactions.every((tr) => !tr.docChanged && !tr.selectionSet)) return null;
          const ranges = collapsedHiddenRanges(newState.doc);
          if (ranges.length === 0) return null;
          if (!newState.selection.empty) return null;
          const head = newState.selection.head;
          const range = ranges.find((r) => head > r.from && head < r.to);
          if (range === undefined) return null;
          const forward = head >= oldState.selection.head;
          const target = forward ? range.to : range.from;
          const bias = forward ? 1 : -1;
          try {
            const clamped = Selection.near(newState.doc.resolve(target), bias);
            return newState.tr.setSelection(clamped).setMeta("addToHistory", false);
          } catch {
            return null;
          }
        },
      }),
    ];
  },
});
