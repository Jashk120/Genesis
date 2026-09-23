import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { BLOCK_ID_NODE_TYPES, newBlockId } from "../mapper";

function isMissingBlockId(value: unknown): boolean {
  return typeof value !== "string" || value === "";
}

/**
 * Carries the canonical `data.blockId` on every supported block node so the
 * editor and the store share one stable identifier (see spec: "Block ID
 * stability rules"). Serialises as `attrs.blockId`; absent ids are `null`
 * and the mapper treats `null` the same as missing.
 *
 * The plugin below assigns a `blockId` to the doc node (`attrs.blockId`)
 * and to any supported node missing one whenever the document changes, so
 * ids are minted once in the editor instead of fresh on every save.
 * Assignment never creates an undo step and never overwrites existing ids.
 */
export const BlockId = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: ["doc", ...BLOCK_ID_NODE_TYPES],
        attributes: {
          blockId: {
            default: null,
            // A split produces a genuinely new block, so it must not inherit
            // the original id; the plugin below mints it a fresh one.
            keepOnSplit: false,
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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockId"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (transactions.every((tr) => !tr.docChanged)) return null;
          const missing: number[] = [];
          newState.doc.descendants((node, pos) => {
            if (
              BLOCK_ID_NODE_TYPES.has(node.type.name) &&
              isMissingBlockId(node.attrs["blockId"])
            ) {
              missing.push(pos);
            }
            return true;
          });
          const docMissing = isMissingBlockId(newState.doc.attrs["blockId"]);
          if (!docMissing && missing.length === 0) return null;
          const tr = newState.tr;
          tr.setMeta("addToHistory", false);
          if (docMissing) tr.setDocAttribute("blockId", newBlockId());
          for (const pos of missing) {
            tr.setNodeAttribute(pos, "blockId", newBlockId());
          }
          return tr;
        },
      }),
    ];
  },
});
