import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    spoiler: { toggleSpoiler: () => ReturnType };
  }
}

export const Spoiler = Mark.create({
  name: "spoiler",
  inclusive: false,
  parseHTML() {
    return [{ tag: 'span[data-spoiler="true"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-spoiler": "true", class: "spoiler" }), 0];
  },
  addCommands() {
    return { toggleSpoiler: () => ({ commands }) => commands.toggleMark("spoiler") };
  },
});
