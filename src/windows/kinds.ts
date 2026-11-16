import type { WindowKind } from "./layout";

/** Editor chrome per window kind: text field label and a format cheat sheet. */
export interface KindEditor {
  label: string;
  help: string;
}

/** Kinds without a text field. */
export const NO_TEXT: WindowKind[] = ["blank"];

export const KIND_EDITORS: Record<WindowKind, KindEditor> = {
  blank: { label: "", help: "" },
  markdown: {
    label: "Text (Markdown)",
    help: "# H1, ## H2, ### H3 (with line)\n**bold**  *italic*  ~~strike~~\n- bullet   1. numbered   - [x] task\n> quote\n> [!Reward] 6.000 ¥ / P\n> callout body",
  },
  calendar: {
    label: "Entries (CSV)",
    help: "date, end date, title, colour, style\n24.05.2077, , Deadline Ludis Studio, red\n16.04., 17.04., Reha, Peppermint, line\n26.06., , Launch-Event, cyan\n01.06., , Miete fällig\n\nDates dd.mm.yyyy or dd.mm. (year of the current date).\nEnd date empty = one day.\nColour: a runner's name, a colour name (yellow, cyan,\nred, … or any CSS name) or #rrggbb; empty = yellow.\nStyle: box (default), line, text.\nEntries entirely before the current date are drawn lighter:\nbox → outline, thinner line, light text.\n\\, = comma in a title.  // comment lines are ignored.",
  },
};
