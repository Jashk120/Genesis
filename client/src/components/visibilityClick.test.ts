import { afterEach, describe, expect, it, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Plugin } from "@tiptap/pm/state";
import { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Visibility, visibilityKey } from "./Visibility";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
  marks: { spoiler: {} },
});

// "visible " occupies 1..9, the spoiler-marked "secret" occupies 9..15.
const SPOILER = { from: 9, to: 15 };
const INSIDE_SPOILER = 10;

function visibilityPlugin(): Plugin {
  const addPlugins = Visibility.config.addProseMirrorPlugins as
    | ((this: unknown) => Plugin[] | null)
    | undefined;
  const plugin = addPlugins?.call(undefined)?.[0];
  if (plugin === undefined) throw new Error("visibility plugin not found");
  return plugin;
}

type VisibilityCommand = () => (props: {
  state: EditorState;
  dispatch: (tr: Parameters<EditorView["dispatch"]>[0]) => void;
}) => boolean;

function visibilityCommands(): Record<string, VisibilityCommand> {
  const addCommands = Visibility.config.addCommands as
    | ((this: unknown) => Record<string, VisibilityCommand>)
    | undefined;
  return addCommands?.call(undefined) ?? {};
}

function spoilerState(): EditorState {
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
  return EditorState.create({ schema, doc, plugins: [visibilityPlugin()] });
}

function twoRunState(): EditorState {
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
  return EditorState.create({ schema, doc, plugins: [visibilityPlugin()] });
}

// The plugin walks `event.target instanceof Element` then `.closest(".spoiler")`.
// The vitest node environment has no `Element`, so we stub a minimal one.
class FakeElement {
  constructor(private readonly spoiler: boolean) {}
  closest(selector: string): FakeElement | null {
    return this.spoiler && selector === ".spoiler" ? this : null;
  }
}

interface FakeView {
  state: EditorState;
  dispatch(tr: Parameters<EditorView["dispatch"]>[0]): void;
}

function makeView(state: EditorState): FakeView {
  const view: FakeView = {
    state,
    dispatch(tr) {
      view.state = view.state.apply(tr);
    },
  };
  return view;
}

function clickEvent(spoiler: boolean) {
  const preventDefault = vi.fn();
  const event = {
    target: new FakeElement(spoiler),
    preventDefault,
  } as unknown as MouseEvent;
  return { event, preventDefault };
}

function handleClick(view: FakeView, pos: number, event: MouseEvent): boolean {
  const plugin = visibilityPlugin();
  const handler = plugin.props.handleClick;
  if (handler === undefined) throw new Error("handleClick missing from visibility plugin");
  return handler.call(plugin, view as unknown as EditorView, pos, event) === true;
}

describe("visibility spoiler click", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reveals a hidden spoiler and consumes the click", () => {
    vi.stubGlobal("Element", FakeElement);
    const view = makeView(spoilerState());
    const { event, preventDefault } = clickEvent(true);

    expect(handleClick(view, INSIDE_SPOILER, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(visibilityKey.getState(view.state)?.revealed).toEqual([SPOILER]);
  });

  it("leaves a click on an already-revealed spoiler to the editor (no re-hide)", () => {
    vi.stubGlobal("Element", FakeElement);
    const initial = spoilerState();
    const revealed = initial.apply(
      initial.tr.setMeta(visibilityKey, {
        type: "toggle-reveal",
        from: SPOILER.from,
        to: SPOILER.to,
      }),
    );
    const view = makeView(revealed);
    const { event, preventDefault } = clickEvent(true);

    expect(handleClick(view, INSIDE_SPOILER, event)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(visibilityKey.getState(view.state)?.revealed).toEqual([SPOILER]);
  });

  it("ignores clicks outside any spoiler", () => {
    vi.stubGlobal("Element", FakeElement);
    const view = makeView(spoilerState());
    const { event, preventDefault } = clickEvent(false);

    expect(handleClick(view, INSIDE_SPOILER, event)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("visibility spoiler commands", () => {
  it("revealAllSpoilers reveals every spoiler run", () => {
    const revealAll = visibilityCommands()["revealAllSpoilers"];
    if (revealAll === undefined) throw new Error("revealAllSpoilers missing");
    const view = makeView(twoRunState());

    const handled = revealAll()({
      state: view.state,
      dispatch: (tr) => {
        view.state = view.state.apply(tr);
      },
    });

    expect(handled).toBe(true);
    expect(visibilityKey.getState(view.state)?.revealed).toEqual([
      { from: 2, to: 6 },
      { from: 7, to: 10 },
    ]);
  });

  it("hideAllSpoilers clears the revealed set", () => {
    const hideAll = visibilityCommands()["hideAllSpoilers"];
    if (hideAll === undefined) throw new Error("hideAllSpoilers missing");
    const initial = twoRunState();
    const revealAll = initial.apply(
      initial.tr.setMeta(visibilityKey, {
        type: "set-revealed",
        ranges: [
          { from: 2, to: 6 },
          { from: 7, to: 10 },
        ],
      }),
    );
    const view = makeView(revealAll);

    const handled = hideAll()({
      state: view.state,
      dispatch: (tr) => {
        view.state = view.state.apply(tr);
      },
    });

    expect(handled).toBe(true);
    expect(visibilityKey.getState(view.state)?.revealed).toEqual([]);
  });
});
