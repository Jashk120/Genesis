import { BubbleMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import {
  IconBulletList,
  IconCode,
  IconCodeBlock,
  IconLink,
  IconOrderedList,
  IconQuote,
} from "./icons";

export interface FormatToolbarProps {
  editor: Editor | null;
}

/**
 * AFFiNE-style inline format toolbar, shown on text selection.
 *
 * Marks first, then block conversions — same grouping AFFiNE uses.
 */
export function FormatToolbar({ editor }: FormatToolbarProps) {
  if (editor === null) return null;

  function promptLink(): void {
    if (editor === null) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
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
        data-active={editor.isActive("bold") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="fmt-glyph fmt-bold">B</span>
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Italic"
        data-active={editor.isActive("italic") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="fmt-glyph fmt-italic">I</span>
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Inline code"
        data-active={editor.isActive("code") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <IconCode size={16} />
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Link"
        data-active={editor.isActive("link") ? "true" : "false"}
        onClick={promptLink}
      >
        <IconLink size={16} />
      </button>

      <span className="fmt-separator" />

      <button
        type="button"
        className="fmt-button"
        title="Heading 1"
        data-active={editor.isActive("heading", { level: 1 }) ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <span className="fmt-glyph">H1</span>
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Heading 2"
        data-active={editor.isActive("heading", { level: 2 }) ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <span className="fmt-glyph">H2</span>
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Heading 3"
        data-active={editor.isActive("heading", { level: 3 }) ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <span className="fmt-glyph">H3</span>
      </button>

      <span className="fmt-separator" />

      <button
        type="button"
        className="fmt-button"
        title="Bullet list"
        data-active={editor.isActive("bulletList") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <IconBulletList size={16} />
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Numbered list"
        data-active={editor.isActive("orderedList") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <IconOrderedList size={16} />
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Quote"
        data-active={editor.isActive("blockquote") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <IconQuote size={16} />
      </button>
      <button
        type="button"
        className="fmt-button"
        title="Code block"
        data-active={editor.isActive("codeBlock") ? "true" : "false"}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <IconCodeBlock size={16} />
      </button>
    </BubbleMenu>
  );
}
