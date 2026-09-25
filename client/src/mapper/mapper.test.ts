import { describe, expect, it } from "vitest";
import {
  MapperError,
  assignMissingBlockIds,
  deltaTreeToProseMirror,
  ensureBlockIds,
  proseMirrorToDeltaTree,
  type CanonicalBlockType,
  type DeltaBlock,
  type DeltaTree,
  type PMDoc,
} from "./index";

function fullTree(): DeltaTree {
  return {
    type: "page",
    data: { blockId: "page-1" },
    children: [
      {
        type: "heading",
        data: { blockId: "h-1", delta: [{ insert: "My Novel" }], level: 1 },
      },
      {
        type: "paragraph",
        data: { blockId: "p-1", delta: [{ insert: "The door opened." }] },
      },
      {
        type: "paragraph",
        data: {
          blockId: "p-2",
          delta: [
            { insert: "Bold and " },
            { insert: "strong", attributes: { bold: true } },
            { insert: " and " },
            { insert: "emphasised", attributes: { italic: true } },
            { insert: " and " },
            { insert: "code", attributes: { code: true } },
            { insert: " and " },
            { insert: "a link", attributes: { link: "https://example.com" } },
            { insert: " plus " },
            { insert: "everything", attributes: { bold: true, italic: true, link: "https://example.com/x" } },
            { insert: "." },
          ],
        },
      },
      {
        type: "bulletList",
        data: { blockId: "bl-1" },
        children: [
          { type: "listItem", data: { blockId: "li-1", delta: [{ insert: "first" }] } },
          {
            type: "listItem",
            data: { blockId: "li-2", delta: [{ insert: "second" }] },
            children: [
              {
                type: "orderedList",
                data: { blockId: "ol-1" },
                children: [
                  {
                    type: "listItem",
                    data: { blockId: "li-3", delta: [{ insert: "nested one" }] },
                    children: [
                      {
                        type: "bulletList",
                        data: { blockId: "bl-2" },
                        children: [
                          {
                            type: "listItem",
                            data: { blockId: "li-4", delta: [{ insert: "deep", attributes: { bold: true } }] },
                          },
                        ],
                      },
                    ],
                  },
                  { type: "listItem", data: { blockId: "li-5", delta: [{ insert: "nested two" }] } },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "blockquote",
        data: { blockId: "bq-1" },
        children: [
          {
            type: "paragraph",
            data: { blockId: "bq-p1", delta: [{ insert: "A quoted line." }] },
          },
        ],
      },
      {
        type: "toggle",
        data: { blockId: "tgl-1", collapsed: true },
        children: [
          {
            type: "paragraph",
            data: {
              blockId: "tgl-p1",
              delta: [{ insert: "hidden", attributes: { spoiler: true } }],
            },
          },
          {
            type: "paragraph",
            data: { blockId: "tgl-p2", delta: [{ insert: "visible" }] },
          },
        ],
      },
      {
        type: "codeBlock",
        data: { blockId: "cb-1", delta: [{ insert: "const x = 1;" }, { insert: "\nconst y = 2;" }], language: "ts" },
      },
    ],
  };
}

describe("mapper round-trip: canonical -> PM -> canonical", () => {
  it("deeply equals the input for every supported node", () => {
    const tree = fullTree();
    expect(proseMirrorToDeltaTree(deltaTreeToProseMirror(tree))).toEqual(tree);
  });

  it("round-trips each block type in isolation", () => {
    const cases: DeltaBlock[] = [
      { type: "heading", data: { blockId: "a", delta: [{ insert: "H" }], level: 3 } },
      { type: "paragraph", data: { blockId: "b", delta: [] } },
      { type: "paragraph", data: { blockId: "c", delta: [] } },
      {
        type: "orderedList",
        data: { blockId: "d" },
        children: [{ type: "listItem", data: { blockId: "e", delta: [{ insert: "x" }] } }],
      },
      {
        type: "blockquote",
        data: { blockId: "f" },
        children: [{ type: "paragraph", data: { blockId: "g", delta: [{ insert: "q" }] } }],
      },
      { type: "codeBlock", data: { blockId: "h", delta: [{ insert: "x" }] } },
    ];
    for (const block of cases) {
      const tree: DeltaTree = { type: "page", children: [block] };
      expect(proseMirrorToDeltaTree(deltaTreeToProseMirror(tree))).toEqual(tree);
    }
  });

  it("round-trips a page without a root blockId", () => {
    const tree: DeltaTree = {
      type: "page",
      children: [{ type: "paragraph", data: { blockId: "p", delta: [{ insert: "hi" }] } }],
    };
    expect(proseMirrorToDeltaTree(deltaTreeToProseMirror(tree))).toEqual(tree);
  });
});

describe("mapper round-trip: PM -> canonical -> PM", () => {
  it("deeply equals a representative PM doc", () => {
    const doc: PMDoc = {
      type: "doc",
      attrs: { blockId: "page-9" },
      content: [
        { type: "heading", attrs: { level: 2, blockId: "h-9" }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          attrs: { blockId: "p-9" },
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://x.test" } }] },
          ],
        },
        {
          type: "bulletList",
          attrs: { blockId: "bl-9" },
          content: [
            {
              type: "listItem",
              attrs: { blockId: "li-9" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "item" }] },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "sub" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }],
        },
        { type: "codeBlock", attrs: { language: "rust" }, content: [{ type: "text", text: "fn main() {}" }] },
      ],
    };
    expect(deltaTreeToProseMirror(proseMirrorToDeltaTree(doc))).toEqual(doc);
  });
});

describe("mapper maps the spec's canonical example", () => {
  it("converts the exact JSON from the task spec", () => {
    const tree = {
      type: "page",
      children: [
        { type: "heading", data: { delta: [{ insert: "My Novel" }], level: 1 } },
        { type: "paragraph", data: { delta: [{ insert: "The door opened." }] } },
      ],
    } as DeltaTree;
    const doc = deltaTreeToProseMirror(tree);
    expect(doc).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "My Novel" }] },
        { type: "paragraph", content: [{ type: "text", text: "The door opened." }] },
      ],
    });
    expect(proseMirrorToDeltaTree(doc)).toEqual({
      type: "page",
      children: [
        { type: "heading", data: { delta: [{ insert: "My Novel" }], level: 1 } },
        { type: "paragraph", data: { delta: [{ insert: "The door opened." }] } },
      ],
    });
  });
});

describe("mapper preserves blockIds", () => {
  it("carries blockId through both directions on every node", () => {
    const doc = deltaTreeToProseMirror(fullTree());
    const ids: string[] = [];
    const walk = (nodes: PMDoc["content"]): void => {
      for (const n of nodes) {
        const id: unknown = n.attrs?.["blockId"];
        if (typeof id === "string") ids.push(id);
        if (n.content !== undefined) walk(n.content.filter((c) => c.type !== "text"));
      }
    };
    walk(doc.content);
    for (const want of ["h-1", "p-1", "bl-1", "li-1", "ol-1", "bq-1", "cb-1"]) {
      expect(ids).toContain(want);
    }
  });

  it("ensureBlockIds fills gaps without touching existing ids", () => {
    const tree: DeltaTree = {
      type: "page",
      children: [
        { type: "paragraph", data: { delta: [{ insert: "a" }] } },
        { type: "paragraph", data: { blockId: "keep", delta: [{ insert: "b" }] } },
      ],
    };
    const filled = ensureBlockIds(tree);
    expect(tree.children[0]?.data.blockId).toBeUndefined();
    expect(typeof filled.children[0]?.data.blockId).toBe("string");
    expect(filled.children[1]?.data.blockId).toBe("keep");
    expect(typeof filled.data?.blockId).toBe("string");
  });
});

describe("mapper sub-page blocks", () => {
  it("round-trips a sub-page block canonical -> PM -> canonical", () => {
    const tree: DeltaTree = {
      type: "page",
      data: { blockId: "root-1" },
      children: [
        { type: "paragraph", data: { blockId: "p-1", delta: [{ insert: "before" }] } },
        {
          type: "page",
          data: { pageId: "11111111-1111-4111-8111-111111111111", blockId: "22222222-2222-4222-8222-222222222222" },
        },
        { type: "paragraph", data: { blockId: "p-2", delta: [{ insert: "after" }] } },
      ],
    };
    const doc = deltaTreeToProseMirror(tree);
    expect(doc.content[1]).toEqual({
      type: "subPage",
      attrs: {
        pageId: "11111111-1111-4111-8111-111111111111",
        blockId: "22222222-2222-4222-8222-222222222222",
      },
    });
    expect(proseMirrorToDeltaTree(doc)).toEqual(tree);
  });

  it("round-trips a sub-page block PM -> canonical -> PM", () => {
    const doc: PMDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { blockId: "p-1" }, content: [{ type: "text", text: "hi" }] },
        {
          type: "subPage",
          attrs: {
            pageId: "33333333-3333-4333-8333-333333333333",
            blockId: "44444444-4444-4433-8433-444444444444",
          },
        },
      ],
    };
    const tree = proseMirrorToDeltaTree(doc);
    expect(tree.children[1]).toEqual({
      type: "page",
      data: {
        pageId: "33333333-3333-4333-8333-333333333333",
        blockId: "44444444-4444-4433-8433-444444444444",
      },
    });
    expect(deltaTreeToProseMirror(tree)).toEqual(doc);
  });

  it("fails loudly on a page block WITHOUT pageId as a child", () => {
    expect(() =>
      deltaTreeToProseMirror({
        type: "page",
        children: [{ type: "page", data: { blockId: "orphan-1" } }],
      }),
    ).toThrow(MapperError);
    expect(() =>
      deltaTreeToProseMirror({
        type: "page",
        children: [{ type: "page", data: {} }],
      }),
    ).toThrow(MapperError);
  });

  it("preserves pageId and blockId verbatim", () => {
    const pageId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const blockId = "ffffffff-0000-4111-8111-222222222222";
    const tree: DeltaTree = { type: "page", children: [{ type: "page", data: { pageId, blockId } }] };
    const round = proseMirrorToDeltaTree(deltaTreeToProseMirror(tree));
    expect(round.children[0]?.data.pageId).toBe(pageId);
    expect(round.children[0]?.data.blockId).toBe(blockId);
  });
});

describe("mapper fails loudly on unsupported constructs", () => {
  const block = (b: DeltaBlock): DeltaTree => ({ type: "page", children: [b] });

  it("rejects unknown block types", () => {
    const badType: string = "image";
    expect(() =>
      deltaTreeToProseMirror(block({ type: badType as CanonicalBlockType, data: {} })),
    ).toThrow(MapperError);
  });

  it("rejects unknown inline attributes", () => {
    expect(() =>
      deltaTreeToProseMirror(
        block({
          type: "paragraph",
          data: { blockId: "x", delta: [{ insert: "a", attributes: { strike: true } }] },
        }),
      ),
    ).toThrow(/unsupported inline attribute "strike"/);
  });

  it("rejects non-string inserts (embeds)", () => {
    const embedOp = Object.assign({ insert: "placeholder" }, { insert: { image: "u" } });
    expect(() =>
      deltaTreeToProseMirror(
        block({
          type: "paragraph",
          data: { blockId: "x", delta: [embedOp] },
        }),
      ),
    ).toThrow(/non-string inserts/);
  });

  it("rejects bad heading levels and marks in code blocks", () => {
    expect(() =>
      deltaTreeToProseMirror(block({ type: "heading", data: { blockId: "x", delta: [], level: 9 } })),
    ).toThrow(/level/);
    expect(() =>
      deltaTreeToProseMirror(
        block({
          type: "codeBlock",
          data: { blockId: "x", delta: [{ insert: "a", attributes: { bold: true } }] },
        }),
      ),
    ).toThrow(/cannot carry marks/);
  });

  it("rejects unknown PM nodes, marks, and misplaced items", () => {
    expect(() =>
      proseMirrorToDeltaTree({ type: "doc", content: [{ type: "image" }] }),
    ).toThrow(/unsupported ProseMirror node "image"/);
    expect(() =>
      proseMirrorToDeltaTree({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "a", marks: [{ type: "strike" }] }],
          },
        ],
      }),
    ).toThrow(/unsupported mark "strike"/);
    expect(() =>
      proseMirrorToDeltaTree({
        type: "doc",
        content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
      }),
    ).toThrow(/must sit inside/);
    expect(() =>
      proseMirrorToDeltaTree({
        type: "doc",
        content: [{ type: "paragraph", attrs: { textAlign: "center" } }],
      }),
    ).toThrow(/unsupported attribute "textAlign"/);
  });
});

describe("assignMissingBlockIds", () => {
  it("assigns ids exactly once and stays stable across repeated passes", () => {
    const doc: PMDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    };
    const first = assignMissingBlockIds(doc);
    expect(first.changed).toBe(true);
    expect(typeof first.doc.attrs?.["blockId"]).toBe("string");
    expect(typeof first.doc.content[0]?.attrs?.["blockId"]).toBe("string");
    const second = assignMissingBlockIds(first.doc);
    expect(second.changed).toBe(false);
    expect(second.doc).toEqual(first.doc);
  });

  it("never overwrites existing ids, including the root", () => {
    const doc: PMDoc = {
      type: "doc",
      attrs: { blockId: "root-keep" },
      content: [
        { type: "paragraph", attrs: { blockId: "p-keep" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    };
    const { doc: out, changed } = assignMissingBlockIds(doc);
    expect(changed).toBe(true);
    expect(out.attrs?.["blockId"]).toBe("root-keep");
    expect(out.content[0]?.attrs?.["blockId"]).toBe("p-keep");
    expect(typeof out.content[1]?.attrs?.["blockId"]).toBe("string");
  });

  it("assigns ids to nested nodes without touching existing ones", () => {
    const doc: PMDoc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              attrs: { blockId: "li-keep" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "item" }] },
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "sub" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { doc: out } = assignMissingBlockIds(doc);
    const list = out.content[0];
    expect(typeof list?.attrs?.["blockId"]).toBe("string");
    expect(list?.content?.[0]?.attrs?.["blockId"]).toBe("li-keep");
    const nested = list?.content?.[0]?.content?.[1];
    expect(typeof nested?.attrs?.["blockId"]).toBe("string");
    expect(typeof nested?.content?.[0]?.attrs?.["blockId"]).toBe("string");
    const again = assignMissingBlockIds(out);
    expect(again.changed).toBe(false);
    expect(again.doc).toEqual(out);
  });

  it("fills an empty document's root id and leaves the input untouched", () => {
    const doc: PMDoc = { type: "doc", content: [] };
    const { doc: out, changed } = assignMissingBlockIds(doc);
    expect(changed).toBe(true);
    expect(typeof out.attrs?.["blockId"]).toBe("string");
    expect(doc.attrs).toBeUndefined();
    expect(out.content).toEqual([]);
  });

  it("treats null and empty ids as missing but keeps valid ones", () => {
    const doc: PMDoc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { blockId: null } },
        { type: "paragraph", attrs: { blockId: "" } },
        { type: "paragraph", attrs: { blockId: "fine" } },
      ],
    };
    const { doc: out } = assignMissingBlockIds(doc);
    expect(typeof out.content[0]?.attrs?.["blockId"]).toBe("string");
    expect(out.content[0]?.attrs?.["blockId"]).not.toBe("");
    expect(typeof out.content[1]?.attrs?.["blockId"]).toBe("string");
    expect(out.content[2]?.attrs?.["blockId"]).toBe("fine");
  });
});

describe("mapper collapse (toggle) + spoiler", () => {
  it("round-trips a collapsed toggle with a spoiler+bold run and a nested toggle", () => {
    const tree: DeltaTree = {
      type: "page",
      data: { blockId: "page-t" },
      children: [
        {
          type: "toggle",
          data: { blockId: "t-1", collapsed: true },
          children: [
            {
              type: "paragraph",
              data: {
                blockId: "t-p1",
                delta: [
                  { insert: "secret", attributes: { bold: true, spoiler: true } },
                  { insert: " plain" },
                ],
              },
            },
            {
              type: "toggle",
              data: { blockId: "t-2" },
              children: [
                { type: "paragraph", data: { blockId: "t-p2", delta: [{ insert: "inner" }] } },
              ],
            },
          ],
        },
      ],
    };
    expect(proseMirrorToDeltaTree(deltaTreeToProseMirror(tree))).toEqual(tree);
  });

  it("round-trips a toggle with no children and no collapsed", () => {
    const tree: DeltaTree = {
      type: "page",
      children: [{ type: "toggle", data: { blockId: "t-empty" } }],
    };
    const doc = deltaTreeToProseMirror(tree);
    expect(doc.content[0]).toEqual({ type: "toggle", attrs: { blockId: "t-empty" } });
    expect(proseMirrorToDeltaTree(doc)).toEqual(tree);
  });

  it("round-trips a PM toggle with collapsed:true and asserts the exact PM shape", () => {
    const doc: PMDoc = {
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { blockId: "t-9", collapsed: true },
          content: [
            {
              type: "paragraph",
              attrs: { blockId: "p-9" },
              content: [{ type: "text", text: "hi" }],
            },
          ],
        },
      ],
    };
    const tree = proseMirrorToDeltaTree(doc);
    expect(tree.children[0]).toEqual({
      type: "toggle",
      data: { blockId: "t-9", collapsed: true },
      children: [
        { type: "paragraph", data: { blockId: "p-9", delta: [{ insert: "hi" }] } },
      ],
    });
    expect(deltaTreeToProseMirror(tree)).toEqual(doc);
  });

  it("assignMissingBlockIds mints a blockId for a toggle node and stays stable", () => {
    const doc: PMDoc = {
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { collapsed: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
        },
      ],
    };
    const first = assignMissingBlockIds(doc);
    expect(typeof first.doc.content[0]?.attrs?.["blockId"]).toBe("string");
    const second = assignMissingBlockIds(first.doc);
    expect(second.changed).toBe(false);
    expect(second.doc).toEqual(first.doc);
  });

  it("round-trips a spoiler-only paragraph in both directions", () => {
    const tree: DeltaTree = {
      type: "page",
      children: [
        {
          type: "paragraph",
          data: { blockId: "sp-1", delta: [{ insert: "hush", attributes: { spoiler: true } }] },
        },
      ],
    };
    expect(proseMirrorToDeltaTree(deltaTreeToProseMirror(tree))).toEqual(tree);
    const doc: PMDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "sp-9" },
          content: [{ type: "text", text: "hush", marks: [{ type: "spoiler" }] }],
        },
      ],
    };
    expect(deltaTreeToProseMirror(proseMirrorToDeltaTree(doc))).toEqual(doc);
  });

  it('rejects collapsed: "yes" on canonical -> PM', () => {
    expect(() =>
      deltaTreeToProseMirror({
        type: "page",
        children: [
          {
            type: "toggle",
            data: { blockId: "t-bad", collapsed: "yes" as unknown as boolean },
          },
        ],
      }),
    ).toThrow(MapperError);
  });

  it("rejects a bare listItem child of toggle in both directions", () => {
    expect(() =>
      deltaTreeToProseMirror({
        type: "page",
        children: [
          {
            type: "toggle",
            data: { blockId: "t-bad" },
            children: [{ type: "listItem", data: { blockId: "li-bad", delta: [{ insert: "x" }] } }],
          },
        ],
      }),
    ).toThrow(MapperError);
    expect(() =>
      proseMirrorToDeltaTree({
        type: "doc",
        content: [
          {
            type: "toggle",
            attrs: { blockId: "t-bad" },
            content: [
              {
                type: "listItem",
                attrs: { blockId: "li-bad" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
              },
            ],
          },
        ],
      }),
    ).toThrow(MapperError);
  });

  it("rejects an unknown textAlign attr on a PM toggle", () => {
    expect(() =>
      proseMirrorToDeltaTree({
        type: "doc",
        content: [{ type: "toggle", attrs: { blockId: "t-bad", textAlign: "center" } }],
      }),
    ).toThrow(MapperError);
  });

  it('rejects a non-boolean collapsed attr on a PM toggle', () => {
    expect(() =>
      proseMirrorToDeltaTree({
        type: "doc",
        content: [{ type: "toggle", attrs: { blockId: "t-bad", collapsed: "yes" } }],
      }),
    ).toThrow(MapperError);
  });
});
