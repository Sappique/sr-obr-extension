/**
 * Calendar entries: one per line, comma-separated (blank lines and `//` comment lines ignored):
 *
 *   date, end date, title, type or colour
 *   24.05.2077, , Deadline Ludis Studio, deadline
 *   16.04., 17.04., Peppermint Reha, #a46cff
 *
 * Dates are dd.mm.yyyy or dd.mm. (the year defaults to the current date's).
 * The end date is optional (empty = one day). The last column is optional:
 * a type (run, deadline, meeting, past) or a colour like #3fd87f.
 * Write `\,` for a comma inside a title and `\\` for a backslash.
 * The current date is not part of the text; it is its own field of the window.
 */
export type EventType = "run" | "deadline" | "meeting" | "past";
export const EVENT_TYPES: EventType[] = ["run", "deadline", "meeting", "past"];

export interface Day {
  y: number;
  m: number;
  d: number;
}

export interface CalEvent extends Day {
  title: string;
  /** A type's look, or a custom colour (filled chip); neither = plain chip. */
  type?: EventType;
  color?: string;
  /** Position in a multi-day entry: 0-based index and length. */
  span?: [number, number];
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

export function parseCalendar(source: string, todayText?: string): Calendar {
  const today = parseToday(todayText);
  const cal: Calendar = { today, events: [], errors: [] };
  source.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;
    const [startText = "", endText = "", title = "", look = ""] = splitLine(line);
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
    let type: EventType | undefined;
    let color: string | undefined;
    if (look) {
      if (/^#[0-9a-f]{6}$/i.test(look)) color = look;
      else if (EVENT_TYPES.includes(look.toLowerCase() as EventType)) type = look.toLowerCase() as EventType;
      else cal.errors.push(`${where}: unknown type "${look}" (run, deadline, meeting, past or #rrggbb)`);
    }
    const a = dayNumber(from);
    const b = Math.max(a, dayNumber(to));
    for (let n = a; n <= b && n - a < 366; n++) {
      cal.events.push({ ...fromNumber(n), title, type, color, span: b > a ? [n - a, b - a + 1] : undefined });
    }
  });
  return cal;
}

export const SAMPLE_TODAY = "19.05.2077";
export const SAMPLE_CALENDAR = `// date, end date, title, type or #colour
12.03., , Run: Bog Treasure Leak, past
20.04., , Treffen mit Abigale (Ice Palace), meeting
08.05., 09.05., Phlox: Aqua Umbra brauen, #3fd87f
12.05., , Hawk: Knöchel gebrochen, #ff8a1f
17.05., , Run: Adventure Land Start, run
18.05., , Betham Farming Gelände, run
19.05., , Hinterhof NC-7, run
24.05., , Deadline Ludis Studio, deadline
01.06., , Miete fällig, deadline
02.06., 04.06., Peppermint: Reha\\, Teil 2, #a46cff
26.06., , Adventure Land 2 Launch-Event, meeting
`;
