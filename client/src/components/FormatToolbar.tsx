import { useEffect, useRef, useState } from "react";
import { BubbleMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import {
  IconBulletList,
  IconCode,
  IconCodeBlock,
  IconFocus,
  IconLink,
  IconOrderedList,
  IconQuote,
  IconToggle,
} from "./icons";

export interface FormatToolbarProps {
  editor: Editor | null;
  onFocusPassage?: () => void;
}

export function FormatToolbar({ editor, onFocusPassage }: FormatToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const linkPopRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!linkOpen) return;
    linkInputRef.current?.focus();
    linkInputRef.current?.select();
    const reference = linkButtonRef.current;
    const floating = linkPopRef.current;
    if (reference === null || floating === null) return;
    void computePosition(reference, floating, {
      placement: "bottom-start",
      strategy: "absolute",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
    });
  }, [linkOpen]);

  if (editor === null) return null;

  function openLink(): void {
    if (editor === null) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    setLinkUrl(previous ?? "https://");
    setLinkOpen(true);
  }

  function applyLink(): void {
    if (editor === null) return;
    const url = linkUrl.trim();
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkOpen(false);
  }

  function cancelLink(): void {
    setLinkOpen(false);
    editor?.chain().focus().run();
  }

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={80}
      tippyOptions={{ duration: 100, placement: "top", maxWidth: "none" }}
      className="fmt-bar"
    >
      <button
        type="button"
        className="fmt-button"
        title="Bold"
        aria-label="Bold"
        data-active={editor.isActive("bold") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="fmt-glyph fmt-bold">B</span>
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Italic"
        aria-label="Italic"
        data-active={editor.isActive("italic") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="fmt-glyph fmt-italic">I</span>
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Inline code"
        aria-label="Inline code"
        data-active={editor.isActive("code") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <IconCode size={16} />
      </button>
      <button
        ref={linkButtonRef}
        type="button"
        className="fmt-button"
        title="Link"
        aria-label="Link"
        aria-haspopup="dialog"
        aria-expanded={linkOpen}
        data-active={editor.isActive("link") ? "true" : "false"}
        onClick={() => (linkOpen ? cancelLink() : openLink())}
      >
        <IconLink size={16} />
      </button>

      <span className="fmt-separator" aria-hidden="true" />

      <button
        type="button"
        className="fmt-button"
        title="Heading 1"
        aria-label="Heading 1"
        data-active={editor.isActive("heading", { level: 1 }) ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <span className="fmt-glyph">H1</span>
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Heading 2"
        aria-label="Heading 2"
        data-active={editor.isActive("heading", { level: 2 }) ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <span className="fmt-glyph">H2</span>
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Heading 3"
        aria-label="Heading 3"
        data-active={editor.isActive("heading", { level: 3 }) ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <span className="fmt-glyph">H3</span>
      </button>

      <span className="fmt-separator" aria-hidden="true" />

      <button
        type="button"
        className="fmt-button"
        title="Bullet list"
        aria-label="Bullet list"
        data-active={editor.isActive("bulletList") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <IconBulletList size={16} />
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Numbered list"
        aria-label="Numbered list"
        data-active={editor.isActive("orderedList") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <IconOrderedList size={16} />
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Quote"
        aria-label="Quote"
        data-active={editor.isActive("blockquote") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <IconQuote size={16} />
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Code block"
        aria-label="Code block"
        data-active={editor.isActive("codeBlock") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <IconCodeBlock size={16} />
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Toggle"
        aria-label="Toggle"
        data-active={editor.isActive("toggle") ? "true" : "false"}
        onClick={() =>
          editor.isActive("toggle")
            ? editor.chain().focus().unsetToggle().run()
            : editor.chain().focus().setToggle().run()
        }
      >
        <IconToggle size={16} />
      </button>

      {linkOpen && (
        <div ref={linkPopRef} className="fmt-link-pop" role="dialog" aria-label="Edit link">
          <input
            ref={linkInputRef}
            className="fmt-link-input"
            aria-label="Link URL"
            placeholder="https://"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelLink();
              }
            }}
          />
          <button type="button" className="btn-primary btn-sm" onClick={applyLink}>
            Apply
          </button>
        </div>
      )}

      {onFocusPassage !== undefined && <span className="fmt-separator" aria-hidden="true" />}
      {onFocusPassage !== undefined && (
        <button
          type="button"
          className="fmt-button fmt-focus"
          data-testid="fmt-focus"
          title="Focus this passage"
          aria-label="Focus this passage"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onFocusPassage}
        >
          <IconFocus size={16} />
        </button>
      )}
    </BubbleMenu>
  );
}
