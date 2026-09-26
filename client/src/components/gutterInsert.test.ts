import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import { blockBeforeFromPos, gutterInsertTarget } from "./gutterInsert";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    toggle: { group: "block", content: "block+" },
    text: { group: "inline" },
  },
});

function docOf(content: unknown[]): PMNode {
  return schema.nodeFromJSON({ type: "doc", content });
}

function para(text: string): unknown {
  return text === ""
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] };
}

function heading(text: string): unknown {
  return {
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text }],
  };
}

describe("gutterInsertTarget for top-level blocks", () => {
  // para "hello" is 0..7, heading "Hi" is 7..11.
  const doc = docOf([para("hello"), heading("Hi")]);

  it("describes a non-empty paragraph", () => {
    expect(gutterInsertTarget(doc, 0)).toEqual({ emptyParagraph: false, nodeSize: 7 });
  });

  it("describes a heading", () => {
    expect(gutterInsertTarget(doc, 7)).toEqual({ emptyParagraph: false, nodeSize: 4 });
  });

  it("flags an empty paragraph so the gutter focuses it instead of inserting", () => {
    const empty = docOf([para("")]);
    expect(gutterInsertTarget(empty, 0)).toEqual({ emptyParagraph: true, nodeSize: 2 });
  });

  it("returns null off the block grid", () => {
    expect(gutterInsertTarget(doc, 3)).toBeNull();
    expect(gutterInsertTarget(doc, -1)).toBeNull();
    expect(gutterInsertTarget(doc, 999)).toBeNull();
  });
});

describe("gutterInsertTarget for nested toggle children", () => {
  // toggle is 0..6; nested para "ab" starts at 1 (nodeSize 4).
  const doc = docOf([{ type: "toggle", content: [para("ab")] }]);

  it("describes the nested paragraph", () => {
    expect(gutterInsertTarget(doc, 1)).toEqual({ emptyParagraph: false, nodeSize: 4 });
  });

  it("flags a nested empty paragraph", () => {
    const empty = docOf([{ type: "toggle", content: [para("")] }]);
    expect(gutterInsertTarget(empty, 1)?.emptyParagraph).toBe(true);
  });
});

describe("blockBeforeFromPos", () => {
  const doc = docOf([para("hello"), heading("Hi")]);

  it("keeps positions that already sit before a block", () => {
    expect(blockBeforeFromPos(doc, 0)).toBe(0);
    expect(blockBeforeFromPos(doc, 7)).toBe(7);
  });

  it("steps out to the block start from inside text", () => {
    expect(blockBeforeFromPos(doc, 3)).toBe(0);
    expect(blockBeforeFromPos(doc, 9)).toBe(7);
  });

  it("steps out from the end of an empty paragraph", () => {
    const empty = docOf([para("")]);
    expect(blockBeforeFromPos(empty, 1)).toBe(0);
  });

  it("steps out from inside a nested toggle child", () => {
    const nested = docOf([{ type: "toggle", content: [para("ab")] }]);
    // Inside "ab" (2..4) the enclosing block starts at 1.
    expect(blockBeforeFromPos(nested, 3)).toBe(1);
    expect(blockBeforeFromPos(nested, 0)).toBe(0);
  });

  it("returns null out of range", () => {
    expect(blockBeforeFromPos(doc, -1)).toBeNull();
    expect(blockBeforeFromPos(doc, 999)).toBeNull();
  });
});
