import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Slice } from "@tiptap/pm/model";
import { collapsedHiddenRanges, stripFragment } from "./visibilityRanges";

export const visibilityKey = new PluginKey("visibility");

export const Visibility = Extension.create({
  name: "visibility",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: visibilityKey,

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
