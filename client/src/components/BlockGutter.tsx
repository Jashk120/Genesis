import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { markAutoSlash } from "./SlashCommand";

interface HoveredBlock {
  blockIndex: number;
  top: number;
  height: number;
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

export function BlockGutter({ editor, wrapRef }: BlockGutterProps) {
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);

  useEffect(() => {
    const wrapNode = wrapRef.current;
    if (wrapNode === null) return;
    const node: HTMLDivElement = wrapNode;

    function onMove(e: MouseEvent): void {
      const target = e.target;
      // The pointer is over the gutter itself: keep the current block.
      if (target instanceof HTMLElement && target.closest(".block-gutter") !== null) {
        return;
      }
      const pm = node.querySelector(".ProseMirror");
      if (pm === null) return;
      // Gaps between blocks (margins, padding): keep the current block so the
      // gutter stays mounted while travelling toward it.
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
      setHovered((prev) => {
        if (
          prev !== null &&
          prev.blockIndex === blockIndex &&
          Math.abs(prev.top - top) < 0.5 &&
          Math.abs(prev.height - rect.height) < 0.5
        ) {
          return prev;
        }
        return { blockIndex, top, height: rect.height };
      });
    }

    // The gutter hides only when the pointer leaves the whole editor wrap.
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
    setHovered({ blockIndex: index, top: rect.top - wrapRect.top, height: rect.height });
  }

  function openSlashOnEmpty(index: number, cursorPos: number): void {
    if (editor === null || editor.isDestroyed) return;
    // Arm the stray-`/` cleanup, then type the trigger so the existing
    // @tiptap/suggestion menu opens on this block.
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
      // AppFlowy: an empty paragraph gets no sibling; just focus it and open
      // the slash menu there.
      openSlashOnEmpty(index, pos + 1);
      return;
    }
    const insertPos = above ? pos : pos + current.nodeSize;
    const clamped = Math.max(0, Math.min(insertPos, doc.content.size));
    editor.chain().focus().insertContentAt(clamped, { type: "paragraph" }).run();
    openSlashOnEmpty(above ? index : index + 1, clamped + 1);
  }

  if (editor === null || hovered === null) return null;
  const aboveModifier = isMacOS() ? "⌘" : "Alt";

  return (
    <div
      className="block-gutter"
      aria-hidden={false}
      style={{
        position: "absolute",
        left: -58,
        top: Math.max(hovered.top, 0),
        width: 52,
        height: Math.max(hovered.height, 28),
        display: "flex",
        alignItems: "flex-start",
        gap: 2,
        paddingTop: 2,
        zIndex: 5,
      }}
    >
      <span className="gutter-add-wrap" style={{ position: "relative", display: "inline-flex" }}>
        <button
          type="button"
          data-testid="block-add"
          aria-label="Add a block"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => handleAdd(e, e.altKey)}
          style={{
            width: 24,
            height: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 5,
            color: "#8a8a8a",
            cursor: "pointer",
            padding: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#2e2e2e";
            (e.currentTarget as HTMLButtonElement).style.color = "#d4d4d4";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "#8a8a8a";
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 2.5v9M2.5 7h9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span
          className="gutter-tooltip"
          role="tooltip"
          style={{
            position: "absolute",
            left: "50%",
            bottom: "calc(100% + 8px)",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            background: "#2b2b2b",
            border: "1px solid #3d3d3d",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
            color: "#e6e6e6",
            fontSize: 12,
            lineHeight: "1.5",
            padding: "6px 10px",
            display: "none",
            flexDirection: "column",
            zIndex: 60,
            pointerEvents: "none",
          }}
        >
          <span>Add below</span>
          <span style={{ color: "#9b9b9b" }}>{`${aboveModifier}+click to add above`}</span>
        </span>
      </span>
      <button
        type="button"
        data-testid="block-drag"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        onMouseDown={(e) => e.preventDefault()}
        style={{
          width: 24,
          height: 24,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: 5,
          color: "#8a8a8a",
          cursor: "grab",
          padding: 0,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "#2e2e2e";
          (e.currentTarget as HTMLButtonElement).style.color = "#d4d4d4";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "#8a8a8a";
        }}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
          <circle cx="2.5" cy="2.5" r="1.4" />
          <circle cx="7.5" cy="2.5" r="1.4" />
          <circle cx="2.5" cy="8" r="1.4" />
          <circle cx="7.5" cy="8" r="1.4" />
          <circle cx="2.5" cy="13.5" r="1.4" />
          <circle cx="7.5" cy="13.5" r="1.4" />
        </svg>
      </button>
    </div>
  );
}
