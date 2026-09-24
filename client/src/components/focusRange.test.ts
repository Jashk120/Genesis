import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  countTopLevelBlocks,
  expandToTopLevelBlocks,
  rangeFromBlockIds,
  topLevelBlockIds,
} from "./focusRange";

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

function para(blockId: string | null, text: string): PMNode {
  const attrs = blockId === null ? {} : { blockId };
  return schema.node("paragraph", attrs, text === "" ? undefined : schema.text(text));
}

// `doc` above requires `block+`, so an empty doc needs a looser schema.
const emptyDocSchema = new Schema({
  nodes: {
    doc: { content: "block*" },
    paragraph: {
      group: "block",
      content: "text*",
      attrs: { blockId: { default: null } },
      toDOM: () => ["p", 0],
    },
    text: {},
  },
});

function emptyDoc(): PMNode {
  return emptyDocSchema.node("doc", null, []);
}

// a "one"   -> [0, 5)
// b "two"   -> [5, 10)
// c "three" -> [10, 17)
function doc3(): PMNode {
  return schema.node("doc", null, [para("a", "one"), para("b", "two"), para("c", "three")]);
}

describe("expandToTopLevelBlocks", () => {
  it("keeps a selection inside one block scoped to that block", () => {
    expect(expandToTopLevelBlocks(doc3(), 1, 2)).toEqual({ from: 0, to: 5 });
  });

  it("covers every block a cross-block selection touches", () => {
    expect(expandToTopLevelBlocks(doc3(), 1, 6)).toEqual({ from: 0, to: 10 });
  });

  it("excludes the block before a range that starts at its boundary", () => {
    expect(expandToTopLevelBlocks(doc3(), 5, 6)).toEqual({ from: 5, to: 10 });
  });

  it("excludes the block after a range that ends at its boundary", () => {
    expect(expandToTopLevelBlocks(doc3(), 3, 5)).toEqual({ from: 0, to: 5 });
  });

  it("treats an empty selection at a boundary as that block", () => {
    expect(expandToTopLevelBlocks(doc3(), 5, 5)).toEqual({ from: 5, to: 10 });
  });

  it("expands a whole-doc selection to every block", () => {
    expect(expandToTopLevelBlocks(doc3(), 0, 17)).toEqual({ from: 0, to: 17 });
  });

  it("clamps out-of-range positions", () => {
    expect(expandToTopLevelBlocks(doc3(), -5, 999)).toEqual({ from: 0, to: 17 });
  });

  it("returns an empty range for an empty document", () => {
    const empty = emptyDoc();
    expect(expandToTopLevelBlocks(empty, 0, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe("topLevelBlockIds", () => {
  it("returns the ids of the first and last covered blocks", () => {
    expect(topLevelBlockIds(doc3(), 1, 6)).toEqual({ fromId: "a", toId: "b" });
  });

  it("returns a single id for a single-block range", () => {
    expect(topLevelBlockIds(doc3(), 11, 12)).toEqual({ fromId: "c", toId: "c" });
  });

  it("reports null for a block without a blockId", () => {
    const doc = schema.node("doc", null, [para(null, "one"), para("b", "two")]);
    expect(topLevelBlockIds(doc, 1, 6)).toEqual({ fromId: null, toId: "b" });
  });

  it("returns nulls for an empty document", () => {
    const empty = emptyDoc();
    expect(topLevelBlockIds(empty, 0, 0)).toEqual({ fromId: null, toId: null });
  });
});

describe("rangeFromBlockIds", () => {
  it("resolves ids back to the covering block range", () => {
    expect(rangeFromBlockIds(doc3(), "b", "c")).toEqual({ from: 5, to: 17 });
  });

  it("is order-insensitive", () => {
    expect(rangeFromBlockIds(doc3(), "c", "a")).toEqual({ from: 0, to: 17 });
  });

  it("resolves a single id to its own block", () => {
    expect(rangeFromBlockIds(doc3(), "a", "a")).toEqual({ from: 0, to: 5 });
  });

  it("returns null when an id is missing", () => {
    expect(rangeFromBlockIds(doc3(), "x", "a")).toBeNull();
    expect(rangeFromBlockIds(doc3(), "a", "x")).toBeNull();
  });

  it("returns null for an empty document", () => {
    const empty = emptyDoc();
    expect(rangeFromBlockIds(empty, "a", "b")).toBeNull();
  });
});

describe("countTopLevelBlocks", () => {
  it("counts the whole blocks a range covers", () => {
    expect(countTopLevelBlocks(doc3(), { from: 0, to: 5 })).toBe(1);
    expect(countTopLevelBlocks(doc3(), { from: 0, to: 10 })).toBe(2);
    expect(countTopLevelBlocks(doc3(), { from: 0, to: 17 })).toBe(3);
  });

  it("counts zero for an empty range", () => {
    expect(countTopLevelBlocks(doc3(), { from: 0, to: 0 })).toBe(0);
  });
});
