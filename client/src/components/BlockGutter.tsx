import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { markAutoSlash } from "./SlashCommand";
import { IconGrip, IconPlus } from "./icons";

interface HoveredBlock {
  blockIndex: number;
  top: number;
  height: number;
  tag: string;
}

interface BlockGutterProps {
  editor: Editor | null;
  wrapRef: RefObject<HTMLDivElement>;
}

function topLevelBlockOf(target: EventTarget | null, pm: Element): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target === pm) return null;
  const direct = target.closest(".ProseMirror > *");
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
      return 10;
    case "H2":
      return 8;
    case "H3":
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
      const el = topLevelBlockOf(e.target, pm);
      if (el === null) {
        return;
      }
      const children = Array.from(pm.children);
      const blockIndex = children.indexOf(el);
      if (blockIndex < 0) {
        return;
      }
      const wrapRect = node.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const top = rect.top - wrapRect.top;
      const tag = el.tagName;
      setHovered((prev) => {
        if (
          prev !== null &&
          prev.blockIndex === blockIndex &&
          Math.abs(prev.top - top) < 0.5 &&
          Math.abs(prev.height - rect.height) < 0.5 &&
          prev.tag === tag
        ) {
          return prev;
        }
        return { blockIndex, top, height: rect.height, tag };
      });
    }

    function onLeave(): void {
      setHovered(null);
    }

    node.addEventListener("mousemove", onMove);
    node.addEventListener("mouseleave", onLeave);
    return () => {
      node.removeEventListener("mousemove", onMove);
      node.removeEventListener("mouseleave", onLeave);
    };
  }, [wrapRef, editor]);

  function refreshGutterTo(index: number): void {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const pm = wrap.querySelector(".ProseMirror");
    if (pm === null) return;
    const child = pm.children.item(index);
    if (!(child instanceof HTMLElement)) return;
    const wrapRect = wrap.getBoundingClientRect();
    const rect = child.getBoundingClientRect();
    setHovered({
      blockIndex: index,
      top: rect.top - wrapRect.top,
      height: rect.height,
      tag: child.tagName,
    });
  }

  function openSlashOnEmpty(index: number, cursorPos: number): void {
    if (editor === null || editor.isDestroyed) return;
    markAutoSlash(editor);
    editor.chain().focus(cursorPos).insertContent("/").run();
    refreshGutterTo(index);
  }

  function handleAdd(e: React.MouseEvent, above: boolean): void {
    e.preventDefault();
    e.stopPropagation();
    if (editor === null || editor.isDestroyed || hovered === null) return;
    const doc = editor.state.doc;
    if (doc.childCount === 0) {
      editor.chain().focus().insertContentAt(0, { type: "paragraph" }).run();
      openSlashOnEmpty(0, 1);
      return;
    }
    const index = Math.max(0, Math.min(hovered.blockIndex, doc.childCount - 1));
    let pos = 0;
    for (let i = 0; i < index; i++) {
      pos += doc.child(i).nodeSize;
    }
    const current = doc.child(index);
    const emptyParagraph = current.type.name === "paragraph" && current.textContent === "";
    if (emptyParagraph) {
      openSlashOnEmpty(index, pos + 1);
      return;
    }
    const insertPos = above ? pos : pos + current.nodeSize;
    const clamped = Math.max(0, Math.min(insertPos, doc.content.size));
    editor.chain().focus().insertContentAt(clamped, { type: "paragraph" }).run();
    openSlashOnEmpty(above ? index : index + 1, clamped + 1);
  }

  const aboveModifier = isMacOS() ? "⌘" : "Alt";
  const visible = editor !== null && hovered !== null;
  const top = hovered === null ? 0 : Math.max(hovered.top, 0) + topOffsetFor(hovered.tag);
  const height = hovered === null ? 28 : Math.max(hovered.height, 28);

  return (
    <div
      className="block-gutter"
      data-visible={visible ? "true" : "false"}
      aria-hidden={visible ? "false" : "true"}
      style={{ top, height }}
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
          <span>Add below</span>
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
