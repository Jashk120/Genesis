import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { createPage } from "../api";
import { newBlockId } from "../mapper";
import { SlashMenuList } from "./SlashMenuList";
import type { SlashMenuListRef } from "./SlashMenuList";

export type SlashIconKind =
  | "text"
  | "page"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "bullet"
  | "numbered"
  | "quote"
  | "code";

export type SlashGroup = "Basic blocks" | "Headings" | "Lists" | "Advanced";

export interface SlashCommandItem {
  title: string;
  hint?: string;
  shortcut?: string;
  keywords?: string;
  icon?: SlashIconKind;
  group: SlashGroup;
  run: (ctx: { editor: Editor; range: Range }) => void;
}

export interface SlashCommandOptions {
  workspaceId: string;
  parentPageId: string;
  onPagesChanged: () => void;
  onError: (message: string) => void;
}

export interface SlashCommandStorage {
  /**
   * True while a slash menu was opened programmatically by the block gutter
   * (which types a `/` trigger into a fresh empty paragraph). When the menu
   * is dismissed without picking an item, `onExit` deletes the trigger text
   * so no stray `/` is left in the document. Selecting an item clears the
   * flag first; the item's own `run` deletes the trigger range itself.
   */
  autoTrigger: boolean;
}

/**
 * Arm the auto-trigger cleanup, then the caller types `/` into an empty
 * paragraph to open the suggestion menu (see BlockGutter).
 */
export function markAutoSlash(editor: Editor): void {
  const ext = editor.extensionManager.extensions.find((e) => e.name === "slashCommand");
  if (ext === undefined) return;
  (ext.storage as SlashCommandStorage).autoTrigger = true;
}

function buildCommands(options: SlashCommandOptions): SlashCommandItem[] {
  return [
    {
      title: "Text",
      group: "Basic blocks",
      hint: "Plain text paragraph",
      shortcut: "T",
      icon: "text",
      keywords: "text plain paragraph p",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).clearNodes().run();
        editor.chain().focus().setNode("paragraph").run();
      },
    },
    {
      title: "Page",
      group: "Advanced",
      hint: "Create a sub-page",
      shortcut: "",
      icon: "page",
      keywords: "page subpage sub-page child create",
      run: ({ editor, range }) => {
        void (async () => {
          try {
            const child = await createPage({
              workspace_id: options.workspaceId,
              parent_page_id: options.parentPageId,
              kind: "note",
              title: "New page",
            });
            options.onPagesChanged();
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: "subPage",
                attrs: { pageId: child.id, blockId: newBlockId() },
              })
              .run();
          } catch (err) {
            options.onError(err instanceof Error ? err.message : String(err));
          }
        })();
      },
    },
    {
      title: "Heading 1",
      group: "Headings",
      hint: "Large section heading",
      shortcut: "#",
      icon: "h1",
      keywords: "heading h1 heading1 title head hash",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
      },
    },
    {
      title: "Heading 2",
      group: "Headings",
      hint: "Medium section heading",
      shortcut: "##",
      icon: "h2",
      keywords: "heading h2 heading2 subtitle head hash",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
      },
    },
    {
      title: "Heading 3",
      group: "Headings",
      hint: "Small section heading",
      shortcut: "###",
      icon: "h3",
      keywords: "heading h3 heading3 sub head hash",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
      },
    },
    {
      title: "Heading 4",
      group: "Headings",
      hint: "Tiny section heading",
      shortcut: "####",
      icon: "h4",
      keywords: "heading h4 heading4 sub head hash",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHeading({ level: 4 }).run();
      },
    },
    {
      title: "Bulleted list",
      group: "Lists",
      hint: "Unordered list",
      shortcut: "-",
      icon: "bullet",
      keywords: "bulleted bullet ul unordered list dash",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: "Numbered list",
      group: "Lists",
      hint: "Ordered list",
      shortcut: "1.",
      icon: "numbered",
      keywords: "numbered number ol ordered list",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      title: "Quote",
      group: "Advanced",
      hint: "Block quotation",
      shortcut: ">",
      icon: "quote",
      keywords: "quote blockquote cite",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run();
      },
    },
    {
      title: "Code",
      group: "Advanced",
      hint: "Code block",
      shortcut: "```",
      icon: "code",
      keywords: "code codeblock pre",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
      },
    },
  ];
}

function matchesQuery(item: SlashCommandItem, rawQuery: string): boolean {
  const needle = rawQuery.trim().toLowerCase().replace(/^\/+/, "");
  if (needle === "") return true;
  const haystack =
    `${item.title} ${item.hint ?? ""} ${item.keywords ?? ""} ${item.shortcut ?? ""}`.toLowerCase();
  if (haystack.includes(needle)) return true;
  // Space-insensitive fallback so `heading1` matches "Heading 1"
  // (AppFlowy heading keyword parity: `heading 1`, `heading1`, `h1`).
  const compactNeedle = needle.replace(/\s+/g, "");
  if (compactNeedle !== needle) {
    return haystack.replace(/\s+/g, "").includes(compactNeedle);
  }
  return false;
}

function anchorRect(
  editor: Editor,
  range: Range,
  clientRect: (() => DOMRect | null) | null | undefined,
): DOMRect | null {
  if (clientRect !== undefined && clientRect !== null) {
    const direct = clientRect();
    if (direct !== null) return direct;
  }
  try {
    const at = Math.max(0, Math.min(range.to, editor.view.state.doc.content.size));
    const coords = editor.view.coordsAtPos(at);
    return new DOMRect(coords.left, coords.bottom, 0, 0);
  } catch {
    return null;
  }
}

function positionPopup(
  editor: Editor,
  range: Range,
  popup: HTMLElement,
  clientRect: (() => DOMRect | null) | null | undefined,
): void {
  const rect = anchorRect(editor, range, clientRect);
  if (rect === null) return;
  const width = 280;
  const height = Math.min(380, window.innerHeight - 16);
  const x = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = rect.bottom + 6;
  const y =
    below + height <= window.innerHeight - 8
      ? below
      : Math.max(8, rect.top - 6 - height);
  popup.style.position = "fixed";
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  popup.style.zIndex = "60";
}

export const SlashCommand = Extension.create<SlashCommandOptions, SlashCommandStorage>({
  name: "slashCommand",

  addOptions() {
    return {
      workspaceId: "",
      parentPageId: "",
      onPagesChanged: () => undefined,
      onError: () => undefined,
    };
  },

  addStorage() {
    return { autoTrigger: false };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const storage = this.storage;
    const commands = buildCommands(options);
    const suggestion: Omit<SuggestionOptions, "editor"> = {
      char: "/",
      allowSpaces: false,
      allow: ({ state, range }) => {
        const $from = state.doc.resolve(range.from);
        if ($from.parent.type.name === "codeBlock") return false;
        return true;
      },
      items: ({ query }: { query: string }) => commands.filter((item) => matchesQuery(item, query)),
      render: () => {
        let popup: HTMLElement | null = null;
        let renderer: ReactRenderer<SlashMenuListRef> | null = null;
        return {
          onStart: (props: SuggestionProps) => {
            popup = document.createElement("div");
            document.body.appendChild(popup);
            const query = typeof props.query === "string" ? props.query : "";
            renderer = new ReactRenderer(SlashMenuList, {
              props: {
                items: props.items,
                query,
                command: (item: SlashCommandItem) => props.command(item),
              },
              editor: props.editor,
            });
            popup.appendChild(renderer.element);
            positionPopup(props.editor, props.range, popup, props.clientRect);
          },
          onUpdate: (props: SuggestionProps) => {
            const query = typeof props.query === "string" ? props.query : "";
            renderer?.updateProps({
              items: props.items,
              query,
              command: (item: SlashCommandItem) => props.command(item),
            });
            if (popup !== null) positionPopup(props.editor, props.range, popup, props.clientRect);
          },
          onKeyDown: (props: { event: KeyboardEvent }) => renderer?.ref?.onKeyDown(props) ?? false,
          onExit: (exitProps: SuggestionProps) => {
            if (storage.autoTrigger) {
              storage.autoTrigger = false;
              const exitEditor = exitProps.editor;
              if (!exitEditor.isDestroyed) {
                try {
                  const text = exitEditor.state.doc.textBetween(
                    exitProps.range.from,
                    exitProps.range.to,
                  );
                  if (text.startsWith("/")) {
                    exitEditor.chain().focus().deleteRange(exitProps.range).run();
                  }
                } catch {
                  // Stale range after concurrent edits; nothing to clean up.
                }
              }
            }
            popup?.remove();
            popup = null;
            renderer?.destroy();
            renderer = null;
          },
        };
      },
      command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashCommandItem }) => {
        // Consume the auto-trigger first: the item's run deletes the `/`
        // trigger itself, so onExit must not clean up again.
        storage.autoTrigger = false;
        props.run({ editor, range });
      },
    };
    return [
      Suggestion({
        ...suggestion,
        editor: this.editor,
      }),
    ];
  },
});
