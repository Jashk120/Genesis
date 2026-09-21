import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { createPage } from "../api";
import { newBlockId } from "../mapper";
import { SlashMenuList } from "./SlashMenuList";
import type { SlashMenuListRef } from "./SlashMenuList";

export interface SlashCommandItem {
  title: string;
  hint?: string;
  keywords?: string;
  run: (ctx: { editor: Editor; range: Range }) => void;
}

export interface SlashCommandOptions {
  workspaceId: string;
  parentPageId: string;
  onPagesChanged: () => void;
  onError: (message: string) => void;
}

function buildCommands(options: SlashCommandOptions): SlashCommandItem[] {
  return [
    {
      title: "Page",
      hint: "Create a sub-page",
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
      hint: "Large section heading",
      keywords: "h1 title heading",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
      },
    },
    {
      title: "Heading 2",
      hint: "Medium section heading",
      keywords: "h2 subtitle heading",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
      },
    },
    {
      title: "Bullet list",
      hint: "Unordered list",
      keywords: "ul bullet list bullets",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: "Numbered list",
      hint: "Ordered list",
      keywords: "ol numbered ordered list numbers",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      title: "Quote",
      hint: "Block quotation",
      keywords: "quote blockquote cite",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run();
      },
    },
    {
      title: "Code",
      hint: "Code block",
      keywords: "code codeblock pre",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
      },
    },
  ];
}

function positionPopup(popup: HTMLElement, clientRect: (() => DOMRect | null) | null | undefined): void {
  if (clientRect === undefined || clientRect === null) return;
  const rect = clientRect();
  if (rect === null) return;
  const virtual = { getBoundingClientRect: () => rect };
  void computePosition(virtual, popup, {
    placement: "bottom-start",
    strategy: "fixed",
    middleware: [offset(6), flip(), shift()],
  }).then(({ x, y }) => {
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    popup.style.position = "fixed";
    popup.style.zIndex = "50";
  });
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      workspaceId: "",
      parentPageId: "",
      onPagesChanged: () => undefined,
      onError: () => undefined,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const commands = buildCommands(options);
    const suggestion: Omit<SuggestionOptions, "editor"> = {
      char: "/",
      allowSpaces: false,
      allow: ({ state, range }) => {
        const $from = state.doc.resolve(range.from);
        if ($from.parent.type.name === "codeBlock") return false;
        return true;
      },
      items: ({ query }: { query: string }) => {
        const q = query.trim().toLowerCase();
        if (q === "") return commands;
        return commands.filter((item) =>
          `${item.title} ${item.hint ?? ""} ${item.keywords ?? ""}`.toLowerCase().includes(q),
        );
      },
      render: () => {
        let popup: HTMLElement | null = null;
        let renderer: ReactRenderer<SlashMenuListRef> | null = null;
        return {
          onStart: (props: SuggestionProps) => {
            popup = document.createElement("div");
            document.body.appendChild(popup);
            renderer = new ReactRenderer(SlashMenuList, {
              props: { items: props.items, command: (item: SlashCommandItem) => props.command(item) },
              editor: props.editor,
            });
            popup.appendChild(renderer.element);
            positionPopup(popup, props.clientRect);
          },
          onUpdate: (props: SuggestionProps) => {
            renderer?.updateProps({
              items: props.items,
              command: (item: SlashCommandItem) => props.command(item),
            });
            if (popup !== null) positionPopup(popup, props.clientRect);
          },
          onKeyDown: (props: { event: KeyboardEvent }) => renderer?.ref?.onKeyDown(props) ?? false,
          onExit: () => {
            popup?.remove();
            popup = null;
            renderer?.destroy();
            renderer = null;
          },
        };
      },
      command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashCommandItem }) => {
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
