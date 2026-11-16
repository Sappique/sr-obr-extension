import { resolveColor } from "./colors.ts";

/**
 * Calendar entries: one per line, comma-separated (blank lines and `//` comment lines ignored):
 *
 *   date, end date, title, colour, style
 *   24.05.2077, , Deadline Ludis Studio, red
 *   16.04., 17.04., Reha, Peppermint, line
 *
 * Dates are dd.mm.yyyy or dd.mm. (the year defaults to the current date's).
 * The end date is optional (empty = one day). Colour (optional, default
 * yellow): a runner's name, a colour name (yellow, cyan, red, … or any CSS
 * name) or #rrggbb. Style (optional): box (default), line or text.
 * Entries whose days are all before the current date are drawn lighter: a box
 * becomes an outline, a line gets thinner, text gets a lighter weight.
 * Write `\,` for a comma inside a title and `\\` for a backslash.
 * The current date is not part of the text; it is its own field of the window.
 */
export type EntryStyle = "box" | "line" | "text";
export const ENTRY_STYLES: EntryStyle[] = ["box", "line", "text"];

export interface Day {
  y: number;
  m: number;
  d: number;
}

export interface CalEvent extends Day {
  title: string;
  /** "#rrggbb". */
  color: string;
  style: EntryStyle;
  /** Every day of the entry is before the current date. */
  past: boolean;
  /** Position in a multi-day entry: 0-based index and length. */
  span?: [number, number];
  /** Which line the entry came from (the days of one entry share it). */
  entry: number;
}

export interface Calendar {
  today: Day;
  events: CalEvent[];
  errors: string[];
}

export const DEFAULT_TODAY = "01.01.2077";

const DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/;

export const dayNumber = (d: Day) => Math.round(Date.UTC(d.y, d.m - 1, d.d) / 86400000);
export const fromNumber = (n: number): Day => {
  const date = new Date(n * 86400000);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};
/** 0 = Monday. */
export const weekday = (d: Day) => (new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay() + 6) % 7;
export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const pad = (n: number) => String(n).padStart(2, "0");
export const full = (d: Day) => `${pad(d.d)}.${pad(d.m)}.${d.y}`;

export function parseDate(text: string, year: number): Day | null {
  const m = DATE.exec(text.trim());
  if (!m) return null;
  const day = { d: +m[1], m: +m[2], y: m[3] ? +m[3] : year };
  if (day.m < 1 || day.m > 12 || day.d < 1 || day.d > daysIn(day.y, day.m)) return null;
  return day;
}

/** The window's current date; falls back to 01.01.2077. */
export const parseToday = (text: string | undefined): Day => parseDate(text ?? "", 2077) ?? parseDate(DEFAULT_TODAY, 2077)!;

/** The current date moved by `days`, as dd.mm.yyyy. */
export const shiftDay = (text: string | undefined, days: number) => full(fromNumber(dayNumber(parseToday(text)) + days));

/** Splits one line at unescaped commas; `\,` is a comma and `\\` a backslash. */
export function splitLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && (line[i + 1] === "," || line[i + 1] === "\\")) cell += line[++i];
    else if (c === ",") {
      cells.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

/** `runners`: crew names and their colours, for the colour column. */
export function parseCalendar(source: string, todayText?: string, runners: Record<string, string> = {}): Calendar {
  const today = parseToday(todayText);
  const todayN = dayNumber(today);
  const cal: Calendar = { today, events: [], errors: [] };
  source.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;
    const [startText = "", endText = "", title = "", colorText = "", styleText = ""] = splitLine(line);
    const where = `Line ${i + 1}`;
    const from = parseDate(startText, today.y);
    if (!from) {
      cal.errors.push(`${where}: bad date "${startText}"`);
      return;
    }
    let to = from;
    if (endText) {
      const end = parseDate(endText, from.y);
      if (!end) {
        cal.errors.push(`${where}: bad end date "${endText}"`);
        return;
      }
      to = end;
    }
    // Unknown colours and styles keep the entry with the default and are reported.
    let color = resolveColor(colorText, runners);
    if (!color) {
      cal.errors.push(`${where}: unknown colour "${colorText}" (a runner, a colour name or #rrggbb)`);
      color = resolveColor("")!;
    }
    let style: EntryStyle = "box";
    if (styleText) {
      const s = styleText.toLowerCase() as EntryStyle;
      if (ENTRY_STYLES.includes(s)) style = s;
      else cal.errors.push(`${where}: unknown style "${styleText}" (${ENTRY_STYLES.join(", ")})`);
    }
    const a = dayNumber(from);
    const b = Math.max(a, dayNumber(to));
    const past = b < todayN;
    for (let n = a; n <= b && n - a < 366; n++) {
      cal.events.push({ ...fromNumber(n), title, color, style, past, span: b > a ? [n - a, b - a + 1] : undefined, entry: i });
    }
  });
  return cal;
}

export const SAMPLE_TODAY = "19.05.2077";
export const SAMPLE_CALENDAR = `// date, end date, title, colour, style
12.03., , Run: Bog Treasure Leak
20.04., , Treffen mit Abigale (Ice Palace), cyan
08.05., 11.05., Aqua Umbra brauen, Phlox, line
12.05., , Knöchel gebrochen, Hawk, line
17.05., , Run: Adventure Land Start
18.05., 20.05., Betham Farming Gelände
21.05., 25.05., Konferenz in Seattle (Ludis Studio), cyan
24.05., , Deadline Ludis Studio, red
01.06., , Miete fällig, red, text
02.06., 04.06., Reha\\, Teil 2, Peppermint, line
26.06., , Adventure Land 2 Launch-Event, cyan
`;
