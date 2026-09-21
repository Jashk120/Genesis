import { createContext, useContext } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { Page } from "../api";

export interface SubPageContextValue {
  pages: Page[];
  onNavigate: (pageId: string) => void;
}

export const SubPageContext = createContext<SubPageContextValue>({
  pages: [],
  onNavigate: () => undefined,
});

function titleFor(pages: Page[], pageId: string): string {
  const found = pages.find((p) => p.id === pageId);
  const title = found?.title?.trim();
  return title !== undefined && title !== "" ? title : "Untitled";
}

export function SubPageView({ node }: Pick<NodeViewProps, "node">) {
  const { pages, onNavigate } = useContext(SubPageContext);
  const pageId = String(node.attrs.pageId ?? "");
  const blockId = String(node.attrs.blockId ?? "");
  return (
    <NodeViewWrapper as="div" data-subpage-block={blockId}>
      <button
        type="button"
        contentEditable={false}
        data-testid="subpage-chip"
        data-page-id={pageId}
        data-block-id={blockId}
        onClick={() => onNavigate(pageId)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 10px",
          margin: "2px 0",
          border: "1px solid #3a3a3a",
          borderRadius: 6,
          background: "#242424",
          color: "#d4d4d4",
          fontSize: 14,
          lineHeight: "1.5",
          cursor: "pointer",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path
            d="M3 1.5h6.5L13 5v9.5H3V1.5Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 1.5V5H13"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path
            d="M5.5 8h5M5.5 10.5h5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {titleFor(pages, pageId)}
        </span>
      </button>
    </NodeViewWrapper>
  );
}

export const SubPage = Node.create({
  name: "subPage",

  group: "block",

  atom: true,

  draggable: true,

  selectable: false,

  addAttributes() {
    return {
      pageId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-page-id") ?? "",
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-subpage-chip]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-subpage-chip": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubPageView);
  },
});
