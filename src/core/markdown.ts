import { marked, Token, Tokens } from "marked";

/** CommonMark/GFM (via marked) reduced to the blocks a window can draw. */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
  /** A soft line break in the source; renders as a space. */
  soft?: boolean;
}

export type Block =
  | { type: "paragraph"; runs: Run[] }
  | { type: "heading"; depth: number; runs: Run[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "quote"; blocks: Block[] }
  | { type: "callout"; kind: string; title: Run[]; blocks: Block[] }
  | { type: "code"; lines: string[] }
  | { type: "rule" };

export interface ListItem {
  task: boolean;
  checked: boolean;
  blocks: Block[];
}

type Marks = Pick<Run, "bold" | "italic" | "strike" | "code" | "link">;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  euro: "€", yen: "¥", ndash: "–", mdash: "—", hellip: "…",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] !== "#") return NAMED[body] ?? all;
    const hex = body[1] === "x" || body[1] === "X";
    return String.fromCodePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10));
  });
}

function textRuns(text: string, marks: Marks): Run[] {
  const runs: Run[] = [];
  decode(text)
    .split("\n")
    .forEach((part, i) => {
      if (i > 0) runs.push({ ...marks, text: " ", soft: true });
      if (part) runs.push({ ...marks, text: part });
    });
  return runs;
}

function inline(tokens: Token[] | undefined, marks: Marks = {}): Run[] {
  const out: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(...inline((t as Tokens.Strong).tokens, { ...marks, bold: true }));
        break;
      case "em":
        out.push(...inline((t as Tokens.Em).tokens, { ...marks, italic: true }));
        break;
      case "del":
        // marked also accepts ~single~ tildes; only ~~double~~ is strikethrough.
        if (t.raw.startsWith("~~")) {
          out.push(...inline((t as Tokens.Del).tokens, { ...marks, strike: true }));
        } else {
          out.push({ ...marks, text: "~" }, ...inline((t as Tokens.Del).tokens, marks), { ...marks, text: "~" });
        }
        break;
      case "link":
        out.push(...inline((t as Tokens.Link).tokens, { ...marks, link: true }));
        break;
      case "codespan":
        out.push({ ...marks, text: decode((t as Tokens.Codespan).text).replace(/\n/g, " "), code: true });
        break;
      case "image":
        out.push(...textRuns((t as Tokens.Image).text, marks));
        break;
      case "br":
        out.push({ ...marks, text: "\n" });
        break;
      case "html":
      case "checkbox":
        break;
      default: {
        const nested = (t as Tokens.Text).tokens;
        if (nested) out.push(...inline(nested, marks));
        else if ("text" in t) out.push(...textRuns(String(t.text), marks));
      }
    }
  }
  return out;
}

function blocks(tokens: Token[] | undefined): Block[] {
  const out: Block[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "space":
      case "checkbox":
      case "def":
        break;
      case "heading": {
        const h = t as Tokens.Heading;
        out.push({ type: "heading", depth: h.depth, runs: inline(h.tokens) });
        break;
      }
      case "paragraph":
      case "text": {
        const p = t as Tokens.Paragraph;
        out.push({ type: "paragraph", runs: p.tokens ? inline(p.tokens) : textRuns(p.text, {}) });
        break;
      }
      case "list": {
        const l = t as Tokens.List;
        out.push({
          type: "list",
          ordered: l.ordered,
          start: typeof l.start === "number" ? l.start : 1,
          items: l.items.map((item) => ({
            task: !!item.task,
            checked: !!item.checked,
            blocks: blocks(item.tokens),
          })),
        });
        break;
      }
      case "blockquote":
        out.push(quote(blocks((t as Tokens.Blockquote).tokens)));
        break;
      case "code":
        out.push({ type: "code", lines: (t as Tokens.Code).text.split("\n") });
        break;
      case "hr":
        out.push({ type: "rule" });
        break;
      case "table": {
        const table = t as Tokens.Table;
        const row = (cells: Tokens.TableCell[], bold: boolean): Block => ({
          type: "paragraph",
          runs: cells.flatMap((cell, i) => [
            ...(i > 0 ? [{ text: " · " }] : []),
            ...inline(cell.tokens, bold ? { bold } : {}),
          ]),
        });
        out.push(row(table.header, true), ...table.rows.map((r) => row(r, false)));
        break;
      }
      case "html": {
        const text = decode((t as Tokens.HTML).text.replace(/<[^>]*>/g, "")).trim();
        if (text) out.push({ type: "paragraph", runs: textRuns(text, {}) });
        break;
      }
      default:
        if ("text" in t && t.text) out.push({ type: "paragraph", runs: textRuns(String(t.text), {}) });
    }
  }
  return out;
}

const CALLOUT_MARKER = /^\[!([^\]\s]+)\][+-]?[ \t]*/;

/** Removes the first n characters from a list of runs. */
function dropChars(runs: Run[], n: number): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (n >= run.text.length) {
      n -= run.text.length;
      continue;
    }
    out.push({ ...run, text: run.text.slice(n) });
    n = 0;
  }
  return out;
}

/** `> [!Type] Title` is a callout (Obsidian/GFM alert syntax); other quotes stay quotes. */
function quote(inner: Block[]): Block {
  const [first, ...rest] = inner;
  if (first?.type !== "paragraph") return { type: "quote", blocks: inner };
  const soft = first.runs.findIndex((r) => r.soft);
  const titleRuns = soft < 0 ? first.runs : first.runs.slice(0, soft);
  const match = CALLOUT_MARKER.exec(titleRuns.map((r) => r.text).join(""));
  if (!match) return { type: "quote", blocks: inner };
  const body = soft < 0 ? [] : first.runs.slice(soft + 1);
  return {
    type: "callout",
    kind: match[1],
    title: dropChars(titleRuns, match[0].length),
    blocks: [...(body.length ? [{ type: "paragraph" as const, runs: body }] : []), ...rest],
  };
}

export function parseMarkdown(source: string): Block[] {
  return blocks(marked.lexer(source, { gfm: true }));
}
