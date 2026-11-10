/**
 * Calendar text format (one item per line, blank lines and `//` comments ignored):
 *
 *   Today: 19.05.2077
 *   Note: Run-Tag 3 · 22:47
 *   Runner: Phlox #3fd87f
 *   24.05. deadline Deadline Ludis Studio
 *   16.04.-17.04. downtime Peppermint Reha
 *
 * Dates are dd.mm. or dd.mm.yyyy (the year defaults to today's year). A range
 * repeats the entry for every day. Types: run, deadline, meeting, past, downtime.
 * A downtime title starts with the runner's name.
 */
export type EventType = "run" | "deadline" | "meeting" | "past" | "downtime";
export const EVENT_TYPES: EventType[] = ["run", "deadline", "meeting", "past", "downtime"];

export interface Day {
  y: number;
  m: number;
  d: number;
}

export interface CalEvent extends Day {
  type: EventType;
  title: string;
  /** Downtime only: the runner, if the title starts with a known runner name. */
  who?: string;
  /** Position in a multi-day range: 0-based index and length. */
  span?: [number, number];
}

export interface Runner {
  name: string;
  color: string;
}

export interface Calendar {
  today: Day;
  note: string;
  runners: Runner[];
  events: CalEvent[];
  errors: string[];
}

const DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?/;

export const dayNumber = (d: Day) => Math.round(Date.UTC(d.y, d.m - 1, d.d) / 86400000);
export const fromNumber = (n: number): Day => {
  const date = new Date(n * 86400000);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};
/** 0 = Monday. */
export const weekday = (d: Day) => (new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay() + 6) % 7;
export const pad = (n: number) => String(n).padStart(2, "0");
export const short = (d: Day) => `${pad(d.d)}.${pad(d.m)}.`;
export const full = (d: Day) => `${pad(d.d)}.${pad(d.m)}.${d.y}`;

function parseDate(text: string, year: number): [Day, string] | null {
  const m = DATE.exec(text);
  if (!m) return null;
  const day = { d: +m[1], m: +m[2], y: m[3] ? +m[3] : year };
  if (day.m < 1 || day.m > 12 || day.d < 1 || day.d > 31) return null;
  return [day, text.slice(m[0].length)];
}

export function parseCalendar(source: string): Calendar {
  const lines = source.split("\n").map((l) => l.trim());
  const cal: Calendar = { today: { y: 2077, m: 1, d: 1 }, note: "", runners: [], events: [], errors: [] };
  // Today first, so dates without a year can use it.
  for (const line of lines) {
    const today = /^today:\s*(.+)$/i.exec(line);
    if (today) {
      const parsed = parseDate(today[1].trim(), cal.today.y);
      if (parsed) cal.today = parsed[0];
      else cal.errors.push(`Bad date: ${line}`);
    }
  }
  for (const line of lines) {
    if (!line || line.startsWith("//") || /^today:/i.test(line)) continue;
    const note = /^note:\s*(.*)$/i.exec(line);
    if (note) {
      cal.note = note[1];
      continue;
    }
    const runner = /^runner:\s*(.+?)\s+(#[0-9a-f]{6})\s*$/i.exec(line);
    if (runner) {
      cal.runners.push({ name: runner[1], color: runner[2] });
      continue;
    }
    const start = parseDate(line, cal.today.y);
    if (!start) {
      cal.errors.push(`Not understood: ${line}`);
      continue;
    }
    let [from, rest] = start;
    let to = from;
    const range = /^\s*[-–]\s*/.exec(rest);
    if (range) {
      const end = parseDate(rest.slice(range[0].length), from.y);
      if (end) [to, rest] = end;
    }
    const typed = /^\s+(\w+)\s+(.*)$/.exec(rest);
    const type = typed?.[1].toLowerCase() as EventType | undefined;
    if (!typed || !type || !EVENT_TYPES.includes(type)) {
      cal.errors.push(`Unknown type: ${line}`);
      continue;
    }
    let title = typed[2].trim();
    let who: string | undefined;
    if (type === "downtime") {
      const r = cal.runners.find((x) => title.toLowerCase().startsWith(x.name.toLowerCase()));
      if (r) {
        who = r.name;
        title = title.slice(r.name.length).replace(/^[\s:·,-]+/, "");
      }
    }
    const a = dayNumber(from);
    const b = Math.max(a, dayNumber(to));
    for (let n = a; n <= b && n - a < 366; n++) {
      cal.events.push({ ...fromNumber(n), type, title, who, span: b > a ? [n - a, b - a + 1] : undefined });
    }
  }
  return cal;
}

/** Moves the Today line by `days`, keeping everything else as typed. */
export function shiftToday(source: string, days: number): string {
  const cal = parseCalendar(source);
  const next = fromNumber(dayNumber(cal.today) + days);
  const line = `Today: ${full(next)}`;
  return /^\s*today:.*$/im.test(source) ? source.replace(/^\s*today:.*$/im, line) : `${line}\n${source}`;
}

export const SAMPLE_CALENDAR = `Today: 19.05.2077
Note: Run-Tag 3 · Adventure Land
Runner: Phlox #3fd87f
Runner: Hawk #ff8a1f
Runner: Peppermint #a46cff

// Termine
24.05. deadline Deadline Ludis Studio
01.06. deadline Miete fällig
26.06. meeting Adventure Land 2 Launch-Event
20.04. meeting Treffen mit Abigale (Ice Palace)

// Runs
12.03. past Run: Bog Treasure Leak
27.03. past Abschluss Bog Treasure
17.05. run Run: Adventure Land Start
18.05. run Betham Farming Gelände
19.05. run Hinterhof NC-7

// Downtime
15.04. downtime Peppermint OP an der Hand
16.04.-17.04. downtime Peppermint Reha
21.04. downtime Hawk Drohne umbauen bei Trix
08.05.-09.05. downtime Phlox Aqua Umbra brauen
12.05. downtime Hawk Knöchel gebrochen
`;
