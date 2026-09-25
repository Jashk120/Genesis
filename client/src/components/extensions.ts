import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { BlockId } from "./BlockId";
import { Spoiler } from "./Spoiler";
import { SubPage } from "./SubPage";
import { Toggle } from "./Toggle";
import { Visibility } from "./Visibility";
import { SlashCommand } from "./SlashCommand";
import type { SlashCommandOptions } from "./SlashCommand";

export function genesisExtensions(slash?: SlashCommandOptions) {
  return [
    StarterKit.configure({
      strike: false,
      horizontalRule: false,
      hardBreak: false,
    }),
    Link.configure({ openOnClick: false }),
    Spoiler,
    BlockId,
    SubPage,
    Toggle,
    Visibility,
    ...(slash === undefined ? [] : [SlashCommand.configure(slash)]),
  ];
}
