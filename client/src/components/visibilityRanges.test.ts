import { describe, expect, it } from "vitest";
import { Fragment, Schema } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { collapsedHiddenRanges, positionIsHidden, spoilerRunAt, spoilerRuns, stripFragment } from "./visibilityRanges";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    toggle: { group: "block", content: "block+", attrs: { collapsed: { default: false } } },
    text: { group: "inline" },
  },
  marks: {
    spoiler: {},
  },
});

function para(text: string): unknown {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe("collapsedHiddenRanges", () => {
  it("hides exactly the children after the first of a collapsed toggle", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { collapsed: true },
          content: [para("a"), para("b"), para("c")],
        },
      ],
    });
    expect(collapsedHiddenRanges(doc)).toEqual([
      { from: 4, to: 7 },
      { from: 7, to: 10 },
    ]);
  });

  it("hides nothing when the toggle is expanded", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { collapsed: false },
          content: [para("a"), para("b")],
        },
      ],
    });
    expect(collapsedHiddenRanges(doc)).toEqual([]);
  });

  it("reports ranges for nested collapsed toggles", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { collapsed: true },
          content: [
            para("s"),
            {
              type: "toggle",
              attrs: { collapsed: true },
              content: [para("i1"), para("i2")],
            },
            para("tail"),
          ],
        },
      ],
    });
    expect(collapsedHiddenRanges(doc)).toEqual([
      { from: 4, to: 14 },
      { from: 14, to: 20 },
      { from: 9, to: 13 },
    ]);
  });
});

describe("positionIsHidden", () => {
  it("is true inside a range and false at boundaries or outside", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { collapsed: true },
          content: [para("a"), para("b"), para("c")],
        },
      ],
    });
    const ranges = collapsedHiddenRanges(doc);
    expect(positionIsHidden(5, ranges)).toBe(true);
    expect(positionIsHidden(8, ranges)).toBe(true);
    expect(positionIsHidden(4, ranges)).toBe(true);
    expect(positionIsHidden(7, ranges)).toBe(true);
    expect(positionIsHidden(2, ranges)).toBe(false);
    expect(positionIsHidden(10, ranges)).toBe(false);
    expect(positionIsHidden(11, ranges)).toBe(false);
    expect(positionIsHidden(0, ranges)).toBe(false);
  });
});

describe("stripFragment (copy-safe projection)", () => {
  it("drops a collapsed toggle's children after the first", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { collapsed: true },
          content: [para("keep"), para("hidden1"), para("hidden2")],
        },
      ],
    });
    const stripped = stripFragment(Fragment.fromArray([doc.child(0)]));
    const toggle = stripped.child(0);
    expect(toggle.type.name).toBe("toggle");
    expect(toggle.childCount).toBe(1);
    expect(toggle.firstChild?.textContent).toBe("keep");
  });

  it("keeps expanded toggles but strips nested collapsed ones", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { collapsed: false },
          content: [
            para("outer"),
            {
              type: "toggle",
              attrs: { collapsed: true },
              content: [para("inner-keep"), para("inner-hidden")],
            },
          ],
        },
      ],
    });
    const stripped = stripFragment(Fragment.fromArray([doc.child(0)]));
    const outer = stripped.child(0);
    expect(outer.childCount).toBe(2);
    const inner = outer.child(1);
    expect(inner.childCount).toBe(1);
    expect(inner.firstChild?.textContent).toBe("inner-keep");
  });

  it("drops spoiler-marked text runs", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "visible " },
            { type: "text", text: "secret", marks: [{ type: "spoiler" }] },
          ],
        },
      ],
    });
    const stripped = stripFragment(Fragment.fromArray([doc.child(0)]));
    expect(stripped.child(0).textContent).toBe("visible ");
  });
});

describe("toggle wrap (setToggle core)", () => {
  it("wraps a selected top-level block in a toggle via NodeRange", () => {
    const doc = schema.nodeFromJSON({ type: "doc", content: [para("hello")] });
    const toggleType = schema.nodes["toggle"];
    if (toggleType === undefined) throw new Error("toggle node missing from schema");
    const range = doc.resolve(1).blockRange(doc.resolve(6));
    if (range === null) throw new Error("expected a block range");
    const tr = new Transform(doc);
    tr.wrap(range, [{ type: toggleType }]);
    const wrapped = tr.doc.child(0);
    expect(wrapped.type.name).toBe("toggle");
    expect(wrapped.textContent).toBe("hello");
  });
});

describe("spoilerRunAt", () => {
  it("returns the spoiler run inside spoiler text and null elsewhere", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "visible " },
            { type: "text", text: "secret", marks: [{ type: "spoiler" }] },
          ],
        },
      ],
    });
    expect(spoilerRunAt(doc, 10)).toEqual({ from: 9, to: 15 });
    expect(spoilerRunAt(doc, 3)).toBeNull();
    expect(spoilerRunAt(doc, 0)).toBeNull();
  });
});

describe("spoilerRuns", () => {
  it("reports every spoiler-marked text run", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "hide", marks: [{ type: "spoiler" }] },
            { type: "text", text: "b" },
            { type: "text", text: "shh", marks: [{ type: "spoiler" }] },
          ],
        },
      ],
    });
    expect(spoilerRuns(doc)).toEqual([
      { from: 2, to: 6 },
      { from: 7, to: 10 },
    ]);
  });
});
