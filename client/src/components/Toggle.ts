import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeRange } from "@tiptap/pm/model";
import type { NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType;
      unsetToggle: () => ReturnType;
    };
  }
}

const CHEVRON_SVG =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

class ToggleNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private chevron: HTMLButtonElement;
  private node: PMNode;
  private editor: Editor;
  private getPos: () => number | undefined;

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;

    const dom = document.createElement("div");
    dom.className = "toggle-block";
    dom.setAttribute("data-type", "toggle");

    const chevron = document.createElement("button");
    chevron.className = "toggle-chevron";
    chevron.type = "button";
    chevron.contentEditable = "false";
    chevron.innerHTML = CHEVRON_SVG;

    const content = document.createElement("div");
    content.className = "toggle-content";

    dom.appendChild(chevron);
    dom.appendChild(content);

    this.dom = dom;
    this.contentDOM = content;
    this.chevron = chevron;

    chevron.addEventListener("mousedown", (event: MouseEvent) => {
      event.preventDefault();
    });
    chevron.addEventListener("click", () => {
      const pos = this.getPos();
      if (typeof pos !== "number") return;
      if (this.editor.isDestroyed) return;
      const collapsed = this.node.attrs["collapsed"] === true;
      this.editor.view.dispatch(
        this.editor.view.state.tr.setNodeAttribute(pos, "collapsed", !collapsed),
      );
    });

    this.sync(node);
  }

  private sync(node: PMNode): void {
    const collapsed = node.attrs["collapsed"] === true;
    this.dom.dataset["collapsed"] = collapsed ? "true" : "false";
    this.chevron.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "toggle") return false;
    this.node = node;
    this.sync(node);
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (target instanceof window.Node) {
      const el = target instanceof Element ? target : target.parentElement;
      if (el !== null && (el === this.chevron || el.closest(".toggle-chevron") === this.chevron)) {
        return true;
      }
    }
    return false;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target;
    if (target instanceof window.Node) {
      const el = target instanceof Element ? target : target.parentElement;
      if (el !== null && (el === this.chevron || this.chevron.contains(el))) {
        return true;
      }
    }
    return false;
  }
}

export const Toggle = Node.create({
  name: "toggle",

  group: "block",

  content: "block+",

  defining: true,

  addAttributes() {
    return {
      collapsed: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-collapsed") === "true",
        renderHTML: (attrs) => (attrs.collapsed === true ? { "data-collapsed": "true" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "toggle", class: "toggle-block" }), 0];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      return new ToggleNodeView(node, editor, getPos as () => number | undefined);
    };
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ state, dispatch, editor }) => {
          const toggleType = state.schema.nodes["toggle"];
          if (toggleType === undefined) return false;
          if (editor.isActive("toggle")) return false;
          const range = state.selection.$from.blockRange(state.selection.$to);
          if (range === null) return false;
          if (dispatch) {
            try {
              dispatch(state.tr.wrap(range, [{ type: toggleType }]));
            } catch {
              return false;
            }
          }
          return true;
        },
      unsetToggle:
        () =>
        ({ state, dispatch }) => {
          let depth: number | null = null;
          for (let d = state.selection.$from.depth; d > 0; d -= 1) {
            if (state.selection.$from.node(d).type.name === "toggle") {
              depth = d;
              break;
            }
          }
          if (depth === null) return false;
          if (dispatch) {
            try {
              const range = new NodeRange(state.selection.$from, state.selection.$to, depth);
              dispatch(state.tr.lift(range, depth - 1));
            } catch {
              return false;
            }
          }
          return true;
        },
    };
  },
});
