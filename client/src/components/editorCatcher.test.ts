import { afterEach, describe, expect, it, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  CATCHER_IGNORE_SELECTOR,
  catcherFocusTarget,
  shouldFocusCatcherOnClick,
} from "./editorCatcher";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } } },
    text: { group: "inline" },
  },
});

// The node vitest environment has no `Element`, so we stub a minimal one
// that implements `closest` against tag/class/attribute matchers.
class FakeElement {
  seen: string[] = [];
  constructor(
    private readonly tag: string = "div",
    private readonly classes: string[] = [],
    private readonly attrs: Record<string, string> = {},
  ) {}
  closest(selector: string): FakeElement | null {
    this.seen.push(selector);
    for (const part of selector.split(",").map((s) => s.trim())) {
      if (part.startsWith(".")) {
        if (this.classes.includes(part.slice(1))) return this;
      } else if (part.startsWith("[")) {
        const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
        const name = m?.[1] ?? "";
        const want = m?.[2];
        const value = this.attrs[name];
        if (value !== undefined && (want === undefined || value === want)) return this;
      } else if (part === this.tag) {
        return this;
      }
    }
    return null;
  }
}

function stateFor(content: unknown[]): EditorState {
  const doc = schema.nodeFromJSON({ type: "doc", content });
  return EditorState.create({ schema, doc });
}

function para(text: string): unknown {
  return text === ""
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] };
}

describe("shouldFocusCatcherOnClick", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("focuses on plain empty-area clicks", () => {
    vi.stubGlobal("Element", FakeElement);
    const target = new FakeElement("div");
    expect(shouldFocusCatcherOnClick(target as unknown as EventTarget)).toBe(true);
    expect(target.seen[0]).toBe(CATCHER_IGNORE_SELECTOR);
  });

  it("covers the editor, gutter, and toolbars", () => {
    vi.stubGlobal("Element", FakeElement);
    expect(CATCHER_IGNORE_SELECTOR).toContain(".ProseMirror");
    expect(CATCHER_IGNORE_SELECTOR).toContain(".block-gutter");
    expect(CATCHER_IGNORE_SELECTOR).toContain(".format-toolbar");
    for (const cls of ["ProseMirror", "block-gutter", "format-toolbar", "fmt-bar"]) {
      const target = new FakeElement("div", [cls]);
      expect(shouldFocusCatcherOnClick(target as unknown as EventTarget)).toBe(false);
    }
  });

  it("ignores clicks on interactive elements", () => {
    vi.stubGlobal("Element", FakeElement);
    for (const tag of ["button", "a", "input", "textarea", "select"]) {
      const target = new FakeElement(tag);
      expect(shouldFocusCatcherOnClick(target as unknown as EventTarget)).toBe(false);
    }
  });

  it("ignores clicks inside contenteditable=false islands", () => {
    vi.stubGlobal("Element", FakeElement);
    const target = new FakeElement("span", [], { contenteditable: "false" });
    expect(shouldFocusCatcherOnClick(target as unknown as EventTarget)).toBe(false);
  });

  it("still focuses for editable islands", () => {
    vi.stubGlobal("Element", FakeElement);
    const target = new FakeElement("span", [], { contenteditable: "true" });
    expect(shouldFocusCatcherOnClick(target as unknown as EventTarget)).toBe(true);
  });

  it("rejects null and non-element targets", () => {
    vi.stubGlobal("Element", FakeElement);
    expect(shouldFocusCatcherOnClick(null)).toBe(false);
    expect(shouldFocusCatcherOnClick({} as unknown as EventTarget)).toBe(false);
  });

  it("rejects everything when Element is unavailable", () => {
    expect(typeof Element).toBe("undefined");
    expect(shouldFocusCatcherOnClick(null)).toBe(false);
  });
});

describe("catcherFocusTarget", () => {
  it("focuses inside the existing empty last paragraph", () => {
    const state = stateFor([para("")]);
    // Single empty paragraph occupies 0..2; caret goes at 1.
    expect(catcherFocusTarget(state)).toEqual({ insert: false, pos: 1 });
  });

  it("focuses inside a trailing empty paragraph after content", () => {
    const state = stateFor([para("hello"), para("")]);
    // "hello" para is 0..7, empty para is 7..9; caret goes at 8.
    expect(catcherFocusTarget(state)).toEqual({ insert: false, pos: 8 });
  });

  it("appends when the last block is non-empty", () => {
    const state = stateFor([para("hello")]);
    expect(catcherFocusTarget(state)).toEqual({ insert: true, pos: 7 });
  });

  it("appends when the last block is not a paragraph", () => {
    const state = stateFor([
      para("hello"),
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hi" }] },
    ]);
    // 0..7 paragraph, 7..11 heading; append at end (11).
    expect(catcherFocusTarget(state)).toEqual({ insert: true, pos: 11 });
  });
});
