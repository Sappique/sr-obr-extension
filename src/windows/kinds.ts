import { shiftToday } from "../calendar/format";
import { addWeek } from "../influence/format";
import type { WindowKind } from "./layout";

/** Editor chrome per window kind: text field label, quick actions and a format cheat sheet. */
export interface KindEditor {
  label: string;
  actions: { label: string; apply: (text: string) => string }[];
  help: string;
}

export const KIND_EDITORS: Record<WindowKind, KindEditor> = {
  markdown: {
    label: "Text (Markdown)",
    actions: [],
    help: "# H1, ## H2, ### H3 (with line)\n**bold**  *italic*  ~~strike~~\n- bullet   1. numbered   - [x] task\n> quote\n> [!Reward] 6.000 ¥ / P\n> callout body",
  },
  calendar: {
    label: "Calendar entries",
    actions: [
      { label: "Today −1", apply: (t) => shiftToday(t, -1) },
      { label: "Today +1", apply: (t) => shiftToday(t, 1) },
      { label: "Today +7", apply: (t) => shiftToday(t, 7) },
    ],
    help: "Today: 19.05.2077\nNote: Run-Tag 3 · 22:47\nRunner: Phlox #3fd87f\n\n24.05. deadline Deadline Ludis Studio\n26.06. meeting Launch-Event\n17.05. run Run: Adventure Land\n12.03. past Run: Bog Treasure\n16.04.-17.04. downtime Peppermint Reha\n\nDates dd.mm. or dd.mm.yyyy; ranges a-b.\n// comment lines are ignored.",
  },
  feed: {
    label: "Posts (newest first)",
    actions: [{ label: "+ New post on top", apply: (t) => `NEWS | Quelle | @handle | ${"19.05.77 12:00"}\n# Titel\nText\n\n---\n\n${t}` }],
    help: "Posts are separated by a line with ---\n\n*NEWS | LDN//NewsNet | @newsnet | 19.05.77 08:14\n# Title\nText with **Markdown**.\n\nHeader: TAG | Source | Handle | Time\nA leading * marks the post as new (yellow).",
  },
  influence: {
    label: "Factions and weekly values",
    actions: [{ label: "+ Week (copy last values)", apply: (t) => addWeek(t) }],
    help: "Start: KW8\nRange: 25-80\nHighlight: LUDS\n\nLUDS | Ludis Studio | 42 44 47 51 55\nTRIA | Triaden | 58 57 59 58 60\n\nOne line per faction: ticker | name | values,\noldest first; the last value is today.",
  },
};
