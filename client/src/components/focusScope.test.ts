import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { focusScopeKey, focusScopePlugin, getFocusScope, hiddenDecorations } from "./FocusScope";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      attrs: { blockId: { default: null } },
      toDOM: () => ["p", 0],
    },
    text: {},
  },
});

function para(blockId: string, text: string): PMNode {
  return schema.node("paragraph", { blockId }, schema.text(text));
}

// Top-level spans: a "one" [0,5)  b "two" [5,10)  c "three" [10,17)
function baseState(): EditorState {
  const doc = schema.node("doc", null, [para("a", "one"), para("b", "two"), para("c", "three")]);
  return EditorState.create({ doc, plugins: [focusScopePlugin] });
}

function withScope(from: number, to: number): EditorState {
  const initial = baseState();
  return initial.apply(initial.tr.setMeta(focusScopeKey, { type: "set", from, to }));
}

describe("FocusScope plugin state", () => {
  it("starts with no scope", () => {
    expect(getFocusScope(baseState())).toBeNull();
  });

  it("activates a scope from plugin meta", () => {
    expect(getFocusScope(withScope(5, 10))).toEqual({ from: 5, to: 10 });
  });

  it("clears a scope from plugin meta", () => {
    const active = withScope(5, 10);
    const cleared = active.apply(active.tr.setMeta(focusScopeKey, { type: "clear" }));
    expect(getFocusScope(cleared)).toBeNull();
  });

  it("grows when a block is inserted at the trailing edge", () => {
    const active = withScope(5, 17);
    const next = active.apply(active.tr.insert(17, para("d", "four")));
    expect(getFocusScope(next)).toEqual({ from: 5, to: 23 });
  });

  it("grows when text is inserted inside the last block", () => {
    const active = withScope(5, 10);
    const next = active.apply(active.tr.insertText("!", 9));
    expect(getFocusScope(next)).toEqual({ from: 5, to: 11 });
  });

  it("shrinks when the trailing block is removed", () => {
    const active = withScope(5, 17);
    const next = active.apply(active.tr.delete(10, 17));
    expect(getFocusScope(next)).toEqual({ from: 5, to: 10 });
  });

  it("clears when the scoped content is removed", () => {
    const active = withScope(5, 10);
    const next = active.apply(active.tr.delete(5, 10));
    expect(getFocusScope(next)).toBeNull();
  });

  it("hides the blocks outside the scope", () => {
    const set = hiddenDecorations(baseState().doc, { from: 5, to: 10 });
    expect(set.find().length).toBe(2);
  });

  it("clamps the caret into the scope on activation", () => {
    const active = withScope(5, 10);
    expect(active.selection.from).toBeGreaterThanOrEqual(5);
    expect(active.selection.to).toBeLessThanOrEqual(10);
  });

  it("pulls a caret that leaves the passage back inside", () => {
    const active = withScope(5, 10);
    const moved = active.apply(active.tr.setSelection(TextSelection.create(active.doc, 1)));
    expect(moved.selection.from).toBeGreaterThanOrEqual(5);
    expect(moved.selection.to).toBeLessThanOrEqual(10);
  });
});
