/**
 * Bidirectional mapper between the canonical delta block tree and
 * Tiptap/ProseMirror JSON.
 *
 * Design rules:
 * - One text op in  <=> one `text` node out, in both directions, so op
 *   boundaries round-trip exactly.
 * - Unsupported constructs THROW a descriptive `MapperError` instead of
 *   silently dropping data.
 * - `blockId` lives in `data.blockId` canonically and in the PM node's
 *   `attrs.blockId`; it is preserved verbatim in both directions. Nodes
 *   that arrive without one can be minted one via `ensureBlockIds`
 *   (kept separate from the pure conversion functions so round-trip
 *   tests stay deterministic).
 */
import {
  Delta,
  DeltaAttributes,
  DeltaBlock,
  DeltaOp,
  DeltaTree,
  PMDoc,
  PMMark,
  PMNode,
} from "./types";

export class MapperError extends Error {
  constructor(message: string) {
    super(`mapper: ${message}`);
    this.name = "MapperError";
  }
}

/** Mint a stable-looking block id (uuid v4 when available). */
export function newBlockId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const MARK_ORDER: ReadonlyArray<"bold" | "italic" | "code" | "link"> = [
  "bold",
  "italic",
  "code",
  "link",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBlockId(attrs: Record<string, unknown> | undefined): string | undefined {
  if (attrs === undefined) return undefined;
  const v: unknown = attrs["blockId"];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new MapperError(`node attr "blockId" must be a string, got ${typeof v}`);
  }
  return v;
}

function blockIdData(blockId: string | undefined): { blockId: string } | Record<string, never> {
  return blockId === undefined ? {} : { blockId };
}

/** Reject unexpected node attrs instead of silently dropping formatting. */
function rejectUnknownAttrs(
  nodeDesc: string,
  attrs: Record<string, unknown> | undefined,
  allowed: ReadonlySet<string>,
): void {
  if (attrs === undefined) return;
  for (const key of Object.keys(attrs)) {
    const v: unknown = attrs[key];
    // Our own extension default serialises as null; treat as absent.
    if (v === null || v === undefined) continue;
    if (!allowed.has(key)) {
      throw new MapperError(
        `unsupported attribute "${key}" on ${nodeDesc}; supported: ${[...allowed].join(", ") || "(none)"}`,
      );
    }
  }
}

/** Validate a raw value as a DeltaOp and return a clean copy. */
function toDeltaOp(raw: unknown, context: string): DeltaOp {
  if (!isRecord(raw) || typeof raw["insert"] !== "string") {
    throw new MapperError(
      `${context}: each op must be { insert: string, attributes? }; non-string inserts (embeds) have no v1 mapping`,
    );
  }
  const attributesRaw: unknown = raw["attributes"];
  if (attributesRaw === undefined || attributesRaw === null) {
    return { insert: raw["insert"] };
  }
  if (!isRecord(attributesRaw)) {
    throw new MapperError(`${context}: op "attributes" must be an object`);
  }
  const attributes: DeltaAttributes = {};
  for (const key of Object.keys(attributesRaw)) {
    if (!MARK_ORDER.includes(key as (typeof MARK_ORDER)[number])) {
      throw new MapperError(
        `${context}: unsupported inline attribute "${key}"; supported marks: ${MARK_ORDER.join(", ")}`,
      );
    }
    attributes[key] = attributesRaw[key];
  }
  return { insert: raw["insert"], attributes };
}

// ---------------------------------------------------------------------------
// delta -> ProseMirror
// ---------------------------------------------------------------------------

function deltaOpToPMText(op: DeltaOp, context: string): PMNode | null {
  if (op.insert === "") return null; // carries no data; emitting nothing is lossless
  const attrs: DeltaAttributes = op.attributes ?? {};
  const marks: PMMark[] = [];
  if (attrs["bold"] !== undefined && attrs["bold"] !== null && attrs["bold"] !== false) {
    marks.push({ type: "bold" });
  }
  if (attrs["italic"] !== undefined && attrs["italic"] !== null && attrs["italic"] !== false) {
    marks.push({ type: "italic" });
  }
  if (attrs["code"] !== undefined && attrs["code"] !== null && attrs["code"] !== false) {
    marks.push({ type: "code" });
  }
  const link: unknown = attrs["link"];
  if (link !== undefined && link !== null && link !== false) {
    if (typeof link !== "string" || link === "") {
      throw new MapperError(`${context}: "link" must be a non-empty href string`);
    }
    marks.push({ type: "link", attrs: { href: link } });
  }
  const node: PMNode = { type: "text", text: op.insert };
  if (marks.length > 0) node.marks = marks;
  return node;
}

function inlineDeltaToPM(delta: Delta | undefined, context: string): PMNode[] | undefined {
  if (delta === undefined) return undefined;
  if (!Array.isArray(delta)) {
    throw new MapperError(`${context}: "delta" must be an ops array`);
  }
  const out: PMNode[] = [];
  delta.forEach((raw, i) => {
    const op = toDeltaOp(raw, `${context} > delta[${i}]`);
    const text = deltaOpToPMText(op, `${context} > delta[${i}]`);
    if (text !== null) out.push(text);
  });
  return out.length > 0 ? out : undefined;
}

function headingLevelOrThrow(level: unknown, context: string): number {
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 6) {
    throw new MapperError(`${context}: heading "level" must be an integer 1..6`);
  }
  return level;
}

function blockToPM(block: DeltaBlock): PMNode {
  const ctx = `block "${block.type}"`;
  switch (block.type) {
    case "paragraph": {
      const content = inlineDeltaToPM(block.data.delta, ctx);
      const node: PMNode = { type: "paragraph" };
      if (block.data.blockId !== undefined) node.attrs = { blockId: block.data.blockId };
      if (content !== undefined) node.content = content;
      return node;
    }
    case "heading": {
      const level = headingLevelOrThrow(block.data.level, ctx);
      const content = inlineDeltaToPM(block.data.delta, ctx);
      const node: PMNode = { type: "heading", attrs: { level } };
      if (block.data.blockId !== undefined) {
        node.attrs = { ...node.attrs, blockId: block.data.blockId };
      }
      if (content !== undefined) node.content = content;
      return node;
    }
    case "bulletList":
    case "orderedList": {
      const children = block.children ?? [];
      for (const child of children) {
        if (child.type !== "listItem") {
          throw new MapperError(`${ctx}: list children must be "listItem", got "${child.type}"`);
        }
      }
      const node: PMNode = {
        type: block.type === "bulletList" ? "bulletList" : "orderedList",
        content: children.map(blockToPM),
      };
      if (block.data.blockId !== undefined) node.attrs = { blockId: block.data.blockId };
      return node;
    }
    case "listItem": {
      // Canonical text lives in data.delta; nested lists in children.
      const textContent = inlineDeltaToPM(block.data.delta, ctx);
      const innerParagraph: PMNode = { type: "paragraph" };
      if (textContent !== undefined) innerParagraph.content = textContent;
      const content: PMNode[] = [innerParagraph];
      for (const child of block.children ?? []) {
        if (child.type !== "bulletList" && child.type !== "orderedList") {
          throw new MapperError(
            `${ctx}: listItem children must be bulletList/orderedList, got "${child.type}"`,
          );
        }
        content.push(blockToPM(child));
      }
      const node: PMNode = { type: "listItem", content };
      if (block.data.blockId !== undefined) node.attrs = { blockId: block.data.blockId };
      return node;
    }
    case "blockquote": {
      const children = block.children ?? [];
      for (const child of children) {
        if (child.type === "page" || child.type === "listItem") {
          throw new MapperError(`${ctx}: unsupported child "${child.type}" in blockquote`);
        }
      }
      const node: PMNode = { type: "blockquote", content: children.map(blockToPM) };
      if (block.data.blockId !== undefined) node.attrs = { blockId: block.data.blockId };
      return node;
    }
    case "codeBlock": {
      const delta = block.data.delta ?? [];
      if (!Array.isArray(delta)) throw new MapperError(`${ctx}: "delta" must be an ops array`);
      const content: PMNode[] = [];
      delta.forEach((raw, i) => {
        const op = toDeltaOp(raw, `${ctx} > delta[${i}]`);
        if (op.insert === "") return;
        if (op.attributes !== undefined && Object.keys(op.attributes).length > 0) {
          throw new MapperError(`${ctx}: codeBlock text cannot carry marks (delta[${i}] has attributes)`);
        }
        content.push({ type: "text", text: op.insert });
      });
      const node: PMNode = { type: "codeBlock" };
      const attrs: Record<string, unknown> = {};
      if (block.data.blockId !== undefined) attrs["blockId"] = block.data.blockId;
      if (typeof block.data.language === "string" && block.data.language !== "") {
        attrs["language"] = block.data.language;
      } else if (block.data.language !== undefined && block.data.language !== "") {
        throw new MapperError(`${ctx}: "language" must be a string`);
      }
      if (Object.keys(attrs).length > 0) node.attrs = attrs;
      if (content.length > 0) node.content = content;
      return node;
    }
    case "page": {
      const pageId: unknown = block.data.pageId;
      if (typeof pageId !== "string" || pageId === "") {
        throw new MapperError(`${ctx}: "page" cannot appear as a child block`);
      }
      const blockId: unknown = block.data.blockId;
      if (typeof blockId !== "string" || blockId === "") {
        throw new MapperError(`${ctx}: sub-page "page" block needs data.blockId as a non-empty string`);
      }
      if (block.data.delta !== undefined) {
        throw new MapperError(`${ctx}: sub-page "page" block must not carry a delta`);
      }
      if (block.children !== undefined && block.children.length > 0) {
        throw new MapperError(`${ctx}: sub-page "page" block must not have children`);
      }
      for (const key of Object.keys(block.data)) {
        if (key !== "pageId" && key !== "blockId") {
          throw new MapperError(`${ctx}: unsupported key "${key}" on sub-page block data`);
        }
      }
      return { type: "subPage", attrs: { pageId, blockId } };
    }
    default: {
      const unexpected: never = block.type;
      throw new MapperError(
        `unsupported block type "${String(unexpected)}"; supported: page (sub-page only, with pageId), heading, paragraph, bulletList, orderedList, listItem, blockquote, codeBlock`,
      );
    }
  }
}

/** Canonical delta tree -> ProseMirror doc JSON. */
export function deltaTreeToProseMirror(tree: DeltaTree): PMDoc {
  if (tree === null || typeof tree !== "object" || tree.type !== "page" || !Array.isArray(tree.children)) {
    throw new MapperError(`root must be { type: "page", children: [...] }`);
  }
  const doc: PMDoc = { type: "doc", content: tree.children.map(blockToPM) };
  if (tree.data?.blockId !== undefined) doc.attrs = { blockId: tree.data.blockId };
  return doc;
}

// ---------------------------------------------------------------------------
// ProseMirror -> delta
// ---------------------------------------------------------------------------

function pmMarksToAttributes(marks: PMMark[] | undefined, context: string): DeltaAttributes | undefined {
  if (marks === undefined || marks.length === 0) return undefined;
  const out: DeltaAttributes = {};
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        out["bold"] = true;
        break;
      case "italic":
        out["italic"] = true;
        break;
      case "code":
        out["code"] = true;
        break;
      case "link": {
        const href: unknown = mark.attrs?.["href"];
        if (typeof href !== "string" || href === "") {
          throw new MapperError(`${context}: link mark needs attrs.href as a non-empty string`);
        }
        out["link"] = href;
        break;
      }
      default:
        throw new MapperError(
          `${context}: unsupported mark "${mark.type}"; supported: ${MARK_ORDER.join(", ")}`,
        );
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pmInlineToDelta(content: PMNode[] | undefined, context: string): Delta {
  if (content === undefined) return [];
  const delta: Delta = [];
  content.forEach((node, i) => {
    if (node.type !== "text" || typeof node.text !== "string") {
      throw new MapperError(
        `${context}: only text nodes are supported inline; got "${node.type}" at index ${i}`,
      );
    }
    if (node.text === "") return;
    if (node.content !== undefined) {
      throw new MapperError(`${context}: text node must not have nested content (index ${i})`);
    }
    const attributes = pmMarksToAttributes(node.marks, `${context} > text[${i}]`);
    delta.push(attributes === undefined ? { insert: node.text } : { insert: node.text, attributes });
  });
  return delta;
}

function pmBlockToDelta(node: PMNode): DeltaBlock {
  switch (node.type) {
    case "subPage": {
      rejectUnknownAttrs("subPage", node.attrs, new Set(["blockId", "pageId"]));
      const pageId: unknown = node.attrs?.["pageId"];
      if (typeof pageId !== "string" || pageId === "") {
        throw new MapperError(`subPage: attr "pageId" must be a non-empty string`);
      }
      const blockId = readBlockId(node.attrs);
      if (blockId === undefined) {
        throw new MapperError(`subPage: attr "blockId" must be a non-empty string`);
      }
      if (node.content !== undefined && node.content.length > 0) {
        throw new MapperError(`subPage: atom node must not have content`);
      }
      return { type: "page", data: { pageId, blockId } };
    }
    case "paragraph": {
      rejectUnknownAttrs("paragraph", node.attrs, new Set(["blockId"]));
      return {
        type: "paragraph",
        data: {
          ...blockIdData(readBlockId(node.attrs)),
          delta: pmInlineToDelta(node.content, "paragraph"),
        },
      };
    }
    case "heading": {
      rejectUnknownAttrs("heading", node.attrs, new Set(["blockId", "level"]));
      const level = headingLevelOrThrow(node.attrs?.["level"], "heading");
      return {
        type: "heading",
        data: {
          ...blockIdData(readBlockId(node.attrs)),
          delta: pmInlineToDelta(node.content, "heading"),
          level,
        },
      };
    }
    case "bulletList":
    case "orderedList": {
      rejectUnknownAttrs(node.type, node.attrs, new Set(["blockId"]));
      const children = node.content ?? [];
      const items: DeltaBlock[] = children.map((child, i) => {
        if (child.type !== "listItem") {
          throw new MapperError(`${node.type}[${i}]: expected listItem, got "${child.type}"`);
        }
        return pmBlockToDelta(child);
      });
      return {
        type: node.type === "bulletList" ? "bulletList" : "orderedList",
        data: { ...blockIdData(readBlockId(node.attrs)) },
        children: items,
      };
    }
    case "listItem": {
      rejectUnknownAttrs("listItem", node.attrs, new Set(["blockId"]));
      const content = node.content ?? [];
      const first: PMNode | undefined = content[0];
      if (first === undefined || first.type !== "paragraph") {
        throw new MapperError("listItem: first child must be a paragraph");
      }
      rejectUnknownAttrs("listItem paragraph", first.attrs, new Set(["blockId"]));
      const nested: DeltaBlock[] = [];
      for (let i = 1; i < content.length; i++) {
        const child: PMNode | undefined = content[i];
        if (child === undefined) continue;
        if (child.type !== "bulletList" && child.type !== "orderedList") {
          throw new MapperError(`listItem: child ${i} must be a list, got "${child.type}"`);
        }
        nested.push(pmBlockToDelta(child));
      }
      return {
        type: "listItem",
        data: {
          ...blockIdData(readBlockId(node.attrs)),
          delta: pmInlineToDelta(first.content, "listItem paragraph"),
        },
        ...(nested.length > 0 ? { children: nested } : {}),
      };
    }
    case "blockquote": {
      rejectUnknownAttrs("blockquote", node.attrs, new Set(["blockId"]));
      const children = node.content ?? [];
      const out: DeltaBlock[] = children.map((child) => {
        if (child.type === "listItem" || child.type === "doc") {
          throw new MapperError(`blockquote: unsupported child "${child.type}"`);
        }
        return pmBlockToDelta(child);
      });
      return {
        type: "blockquote",
        data: { ...blockIdData(readBlockId(node.attrs)) },
        children: out,
      };
    }
    case "codeBlock": {
      rejectUnknownAttrs("codeBlock", node.attrs, new Set(["blockId", "language"]));
      const delta: Delta = [];
      for (const child of node.content ?? []) {
        if (child.type !== "text" || typeof child.text !== "string") {
          throw new MapperError(`codeBlock: only plain text is supported, got "${child.type}"`);
        }
        if (child.text === "") continue;
        if (child.marks !== undefined && child.marks.length > 0) {
          throw new MapperError("codeBlock: text must not carry marks");
        }
        delta.push({ insert: child.text });
      }
      const language: unknown = node.attrs?.["language"];
      if (language !== undefined && language !== null && typeof language !== "string") {
        throw new MapperError(`codeBlock: "language" must be a string`);
      }
      return {
        type: "codeBlock",
        data: {
          ...blockIdData(readBlockId(node.attrs)),
          delta,
          ...(typeof language === "string" && language !== "" ? { language } : {}),
        },
      };
    }
    default:
      throw new MapperError(
        `unsupported ProseMirror node "${node.type}"; supported: paragraph, heading, bulletList, orderedList, listItem, blockquote, codeBlock, subPage`,
      );
  }
}

/** ProseMirror doc JSON -> canonical delta tree. */
export function proseMirrorToDeltaTree(doc: PMDoc): DeltaTree {
  if (doc === null || typeof doc !== "object" || doc.type !== "doc" || !Array.isArray(doc.content)) {
    throw new MapperError(`input must be a ProseMirror doc { type: "doc", content: [...] }`);
  }
  rejectUnknownAttrs("doc", doc.attrs, new Set(["blockId"]));
  const blockId = readBlockId(doc.attrs);
  return {
    type: "page",
    ...(blockId !== undefined ? { data: { blockId } } : {}),
    children: doc.content.map((node, i) => {
      if (node.type === "text") {
        throw new MapperError(`doc[${i}]: bare text is not a valid top-level block`);
      }
      if (node.type === "listItem") {
        throw new MapperError(`doc[${i}]: listItem must sit inside a bulletList/orderedList`);
      }
      return pmBlockToDelta(node);
    }),
  };
}

/**
 * Walk a canonical tree and mint a `blockId` for every block (and root)
 * missing one. Returns a new tree; the input is not mutated.
 */
export function ensureBlockIds(tree: DeltaTree): DeltaTree {
  const walk = (block: DeltaBlock): DeltaBlock => ({
    ...block,
    data: { ...block.data, blockId: block.data.blockId ?? newBlockId() },
    ...(block.children !== undefined ? { children: block.children.map(walk) } : {}),
  });
  return {
    ...tree,
    data: { ...tree.data, blockId: tree.data?.blockId ?? newBlockId() },
    children: tree.children.map(walk),
  };
}
