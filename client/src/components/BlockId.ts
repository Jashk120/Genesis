import { Extension } from "@tiptap/core";

/**
 * Carries the canonical `data.blockId` on every supported block node so the
 * editor and the store share one stable identifier (see spec: "Block ID
 * stability rules"). Serialises as `attrs.blockId`; absent ids are `null`
 * and the mapper treats `null` the same as missing.
 */
export const BlockId = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: [
          "heading",
          "paragraph",
          "bulletList",
          "orderedList",
          "listItem",
          "blockquote",
          "codeBlock",
          "subPage",
        ],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-block-id"),
            renderHTML: (attributes: Record<string, string | null>) => {
              if (attributes["blockId"] === null || attributes["blockId"] === undefined) {
                return {};
              }
              return { "data-block-id": attributes["blockId"] as string };
            },
          },
        },
      },
    ];
  },
});
