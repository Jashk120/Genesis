import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { markAutoSlash } from "./SlashCommand";
import { blockBeforeFromPos, gutterInsertTarget } from "./gutterInsert";
import { IconGrip, IconPlus } from "./icons";

interface HoveredBlock {
  top: number;
  height: number;
  tag: string;
  /** Gutter `left` (px, relative to the wrap) so nested blocks push it right. */
  left: number;
}

interface BlockGutterProps {
  editor: Editor | null;
  wrapRef: RefObject<HTMLDivElement>;
}

/** Must match `--gen-gutter-w` in styles.css. */
const GUTTER_WIDTH_PX = 44;
/** Trailing space between the grip button and the hovered block (AppFlowy). */
const GUTTER_TRAIL_PX = 5;

function closestBlockOf(target: EventTarget | null, pm: Element): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target === pm) return null;
  // Top-level blocks plus blocks nested inside a toggle's content DOM, so
  // the gutter aligns to the hovered block's own left edge when indented.
  const direct = target.closest(".ProseMirror > *, .toggle-content > *");
  if (direct instanceof HTMLElement && pm.contains(direct)) return direct;
  return null;
}

function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = typeof navigator.platform === "string" ? navigator.platform : "";
  if (/mac/i.test(platform)) return true;
  const ua = typeof navigator.userAgent === "string" ? navigator.userAgent : "";
  return /macintosh|mac os x/i.test(ua);
}

function topOffsetFor(tag: string): number {
  switch (tag) {
    case "H1":
      return 13;
    case "H2":
      return 11;
    case "H3":
      return 8;
    case "H4":
      return 6;
    case "BLOCKQUOTE":
    case "PRE":
      return 6;
    default:
      return 2;
  }
}

export function BlockGutter({ editor, wrapRef }: BlockGutterProps) {
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);
  const hoveredElRef = useRef<HTMLElement | null>(null);

  function refreshGutterToEl(el: HTMLElement): void {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    hoveredElRef.current = el;
    const wrapRect = wrap.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const top = rect.top - wrapRect.top;
    const height = rect.height;
    const tag = el.tagName;
    const left = rect.left - wrapRect.left - GUTTER_WIDTH_PX - GUTTER_TRAIL_PX;
    setHovered((prev) => {
      if (
        prev !== null &&
        Math.abs(prev.top - top) < 0.5 &&
        Math.abs(prev.height - height) < 0.5 &&
        prev.tag === tag &&
        Math.abs(prev.left - left) < 0.5
      ) {
        return prev;
      }
      return { top, height, tag, left };
    });
  }

  useEffect(() => {
    const wrapNode = wrapRef.current;
    if (wrapNode === null) return;
    const node: HTMLDivElement = wrapNode;

    function onMove(e: MouseEvent): void {
      const target = e.target;
      if (target instanceof HTMLElement && target.closest(".block-gutter") !== null) {
        return;
      }
      const pm = node.querySelector(".ProseMirror");
      if (pm === null) return;
      const el = closestBlockOf(e.target, pm);
      if (el === null) {
        return;
      }
      refreshGutterToEl(el);
    }

    function onLeave(): void {
      hoveredElRef.current = null;
      setHovered(null);
    }

    node.addEventListener("mousemove", onMove);
    node.addEventListener("mouseleave", onLeave);
    return () => {
      node.removeEventListener("mousemove", onMove);
      node.removeEventListener("mouseleave", onLeave);
    };
  }, [wrapRef, editor]);

  function openSlashAt(cursorPos: number, el: HTMLElement | null): void {
    if (editor === null || editor.isDestroyed) return;
    markAutoSlash(editor);
    editor.chain().focus(cursorPos).insertContent("/").run();
    if (el !== null && editor.view.dom.contains(el)) {
      refreshGutterToEl(el);
    }
  }

  function handleAdd(e: React.MouseEvent, above: boolean): void {
    e.preventDefault();
    e.stopPropagation();
    if (editor === null || editor.isDestroyed || hovered === null) return;
    const doc = editor.state.doc;
    if (doc.childCount === 0) {
      editor.chain().focus().insertContentAt(0, { type: "paragraph" }).run();
      markAutoSlash(editor);
      editor.chain().focus(1).insertContent("/").run();
      const pm = wrapRef.current?.querySelector(".ProseMirror");
      const first = pm?.children.item(0);
      if (first instanceof HTMLElement) refreshGutterToEl(first);
      return;
    }
    const hoveredEl = hoveredElRef.current;
    if (hoveredEl === null) return;
    let raw: number;
    try {
      raw = editor.view.posAtDOM(hoveredEl, 0);
    } catch {
      return;
    }
    const before = blockBeforeFromPos(editor.state.doc, raw);
    if (before === null) return;
    const target = gutterInsertTarget(editor.state.doc, before);
    if (target === null) return;
    if (target.emptyParagraph) {
      openSlashAt(before + 1, hoveredEl);
      return;
    }
    const insertPos = above ? before : before + target.nodeSize;
    const clamped = Math.max(0, Math.min(insertPos, editor.state.doc.content.size));
    editor.chain().focus().insertContentAt(clamped, { type: "paragraph" }).run();
    markAutoSlash(editor);
    editor.chain().focus(clamped + 1).insertContent("/").run();
    try {
      const dom = editor.view.nodeDOM(clamped);
      if (dom instanceof HTMLElement) {
        refreshGutterToEl(dom);
      } else if (hoveredEl.isConnected) {
        refreshGutterToEl(hoveredEl);
      }
    } catch {
      // Keep the previous gutter position; not fatal.
    }
  }

  const aboveModifier = isMacOS() ? "Option" : "Alt";
  const visible = editor !== null && hovered !== null;
  const top = hovered === null ? 0 : Math.max(hovered.top, 0) + topOffsetFor(hovered.tag);
  const height = hovered === null ? 28 : Math.max(hovered.height, 28);
  const left = hovered === null ? -48 : hovered.left;

  return (
    <div
      className="block-gutter"
      data-visible={visible ? "true" : "false"}
      aria-hidden={visible ? "false" : "true"}
      style={{ top, height, left }}
    >
      <span className="gutter-add-wrap">
        <button
          type="button"
          className="gutter-button"
          data-testid="block-add"
          aria-label="Add a block below"
          tabIndex={visible ? 0 : -1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => handleAdd(e, e.altKey || e.metaKey)}
        >
          <IconPlus size={14} />
        </button>
        <span className="gutter-tooltip" role="tooltip">
          <span>Click to add below</span>
          <span className="gutter-tooltip-dim">{`${aboveModifier}+click to add above`}</span>
        </span>
      </span>
      <button
        type="button"
        className="gutter-button gutter-drag"
        data-testid="block-drag"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        tabIndex={visible ? 0 : -1}
        onMouseDown={(e) => e.preventDefault()}
      >
        <IconGrip size={14} />
      </button>
    </div>
  );
}
