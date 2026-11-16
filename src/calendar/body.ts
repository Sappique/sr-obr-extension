import type { BodyContext } from "../core/body";
import type { FontKey } from "../core/fonts";
import { rect, rectRing } from "../core/geometry";
import { COLOR } from "../core/style";
import type { WindowSpec } from "../windows/layout";
import { CalEvent, Calendar, Day, dayNumber, daysIn, EventType, parseCalendar, weekday } from "./format";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DAYNAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** Deadlines first, then runs, meetings, past runs, everything else. */
const ORDER: Record<EventType | "other", number> = { deadline: 0, run: 1, meeting: 2, past: 3, other: 4 };

/** Every month has six rows, so a day cell is always the same size. */
const ROWS = 6;

/**
 * The calendar: a big current date, then the month before, the current month
 * and the month after, all the same size. Day cells have a fixed size; event titles wrap
 * inside them, and what doesn't fit is summed up as "+N".
 */
export function calendarBody(ctx: BodyContext, spec: WindowSpec, x: number, y: number, width: number): number {
  const cal = parseCalendar(spec.markdown, spec.today);
  const { u } = ctx;
  let bottom = hero(ctx, cal, x, y, width) + u(26);

  const gap = u(30);
  const w = (width - 2 * gap) / 3;
  const t = cal.today;
  const prev = t.m === 1 ? { y: t.y - 1, m: 12 } : { y: t.y, m: t.m - 1 };
  const next = t.m === 12 ? { y: t.y + 1, m: 1 } : { y: t.y, m: t.m + 1 };
  const ends = [prev, { y: t.y, m: t.m }, next].map((which, i) =>
    month(ctx, cal, which, x + i * (w + gap), bottom, w, i === 1),
  );
  bottom = Math.max(...ends);
  if (cal.errors.length) bottom = errors(ctx, cal.errors, x, bottom + u(16), width);
  return bottom;
}

function hero(ctx: BodyContext, cal: Calendar, x: number, y: number, width: number): number {
  const { u } = ctx;
  const t = cal.today;
  const big = u(104);
  const lh = big * 0.92;
  const w = ctx.line(String(t.d).padStart(2, "0"), x - u(4), y, lh, { font: "display", size: big, color: COLOR.yellow });
  const tx = x + w + u(26);
  ctx.line(`${MONTHS[t.m - 1]} ${t.y}`, tx, y + u(14), u(46), {
    font: "bold", size: u(42), color: COLOR.white, spacing: 0.1, upper: true, maxWidth: width - (tx - x),
  });
  ctx.line(DAYNAMES[weekday(t)], tx, y + u(66), u(20), {
    font: "mono", size: u(14), color: COLOR.dim, spacing: 0.2, upper: true, maxWidth: width - (tx - x),
  });
  ctx.flush(y);
  return y + lh;
}

const kindOf = (e: CalEvent): EventType | "other" => e.type ?? "other";

/** One month: name (yellow for the current one), weekday row and six rows of fixed-size day cells. */
function month(ctx: BodyContext, cal: Calendar, which: { y: number; m: number }, x: number, y: number, width: number, current: boolean): number {
  const { u } = ctx;
  const s = u;
  const titleH = s(34);
  ctx.line(`${MONTHS[which.m - 1]} ${which.y}`, x, y, titleH, {
    font: "bold", size: s(24), color: current ? COLOR.yellow : COLOR.white, spacing: 0.12, upper: true, maxWidth: width,
  });
  y += titleH;
  const colW = width / 7;
  const labelH = s(22);
  WEEKDAYS.forEach((name, i) => {
    ctx.line(name, x + i * colW + s(6), y, labelH, { font: "mono", size: s(12), color: COLOR.dim, spacing: 0.1 });
  });
  ctx.flush(y - titleH);
  y += labelH;

  const cellGap = s(4);
  const cellH = colW * 0.86;
  const offset = weekday({ y: which.y, m: which.m, d: 1 });
  const days = daysIn(which.y, which.m);
  const todayN = dayNumber(cal.today);
  for (let row = 0; row < ROWS; row++) {
    const rowY = y + row * cellH;
    for (let i = 0; i < 7; i++) {
      const d = row * 7 + i - offset + 1;
      if (d < 1 || d > days) continue;
      const day: Day = { y: which.y, m: which.m, d };
      cell(ctx, cal, day, x + i * colW, rowY, colW - cellGap, cellH - cellGap, dayNumber(day) - todayN);
    }
    ctx.flush(rowY);
  }
  return y + ROWS * cellH;
}

function cell(ctx: BodyContext, cal: Calendar, day: Day, x: number, y: number, w: number, h: number, fromToday: number) {
  const { u } = ctx;
  const s = u;
  const today = fromToday === 0;
  ctx.add("fill", COLOR.white, today ? 0.07 : 0.03, rect(x, y, w, h));
  if (today) ctx.add("text", COLOR.yellow, 1, rectRing(x, y, w, h, s(3)));
  const numH = s(22);
  ctx.line(String(day.d).padStart(2, "0"), x + s(6), y + s(2), numH, {
    font: "mono", size: s(13), color: today ? COLOR.yellow : fromToday < 0 ? COLOR.steel : COLOR.dim,
  });

  const n = dayNumber(day);
  const events = cal.events
    .filter((e) => dayNumber(e) === n)
    .sort((a, b) => ORDER[kindOf(a)] - ORDER[kindOf(b)]);
  const pad = s(5);
  const font: FontKey = "regular";
  const size = s(12.5);
  const lh = size * 1.2;
  const chipPad = s(2.5);
  const innerW = w - 2 * pad - 2 * chipPad;
  let cy = y + numH + s(2);
  const bottom = y + h - pad;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    // A multi-day entry names itself on its first day and at the start of each week.
    const named = !e.span || e.span[0] === 0 || weekday(e) === 0 || e.d === 1;
    const lines = named ? wrap(ctx, e.title || " ", font, size, innerW) : [""];
    const left = events.length - i - 1;
    const room = bottom - cy;
    const needed = lines.length * lh + 2 * chipPad;
    // Keep one line for "+N" if more entries follow and this one doesn't fit.
    if (needed > room - (left > 0 ? lh : 0)) {
      const fit = Math.floor((room - 2 * chipPad - (left > 0 ? lh : 0)) / lh);
      if (fit >= 1 && named) {
        const cut = lines.slice(0, fit);
        cut[fit - 1] = ellipsis(ctx, cut[fit - 1], font, size, innerW);
        cy = chip(ctx, e, cut, x + pad, cy, w - 2 * pad, lh, chipPad, size, font);
        if (left > 0) more(ctx, left, x + pad, cy, lh, s);
      } else more(ctx, left + 1, x + pad, cy, lh, s);
      return;
    }
    cy = chip(ctx, e, lines, x + pad, cy, w - 2 * pad, lh, chipPad, size, font) + s(2);
  }
}

function more(ctx: BodyContext, count: number, x: number, y: number, lh: number, s: (n: number) => number) {
  ctx.line(`+${count}`, x + s(2), y, lh, { font: "mono", size: s(11), color: COLOR.dim });
}

/** Text colour that reads on a filled chip of this colour. */
function onFill(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
  return lum > 140 ? COLOR.black : COLOR.white;
}

/** Draws one entry; returns its bottom. */
function chip(ctx: BodyContext, e: CalEvent, lines: string[], x: number, y: number, w: number, lh: number, pad: number, size: number, font: FontKey) {
  const h = lines.length * lh + 2 * pad;
  let text: string = COLOR.body;
  if (e.color || e.type === "run" || e.type === "deadline") {
    const fill = e.color ?? (e.type === "run" ? COLOR.yellow : COLOR.red);
    ctx.add("fill", fill, 1, rect(x, y, w, h));
    text = e.type === "deadline" && !e.color ? COLOR.white : onFill(fill);
  } else if (e.type === "past") {
    ctx.add("fill", COLOR.grey, 0.45, rect(x, y, w, h));
    text = COLOR.white;
  } else if (e.type === "meeting") {
    ctx.add("text", COLOR.cyan, 1, rectRing(x, y, w, h, Math.max(1, pad * 0.5)));
    text = COLOR.cyan;
  } else {
    ctx.add("fill", COLOR.body, 1, rect(x, y, Math.max(1, pad), h));
  }
  lines.forEach((line, i) => {
    if (line) ctx.line(line, x + pad * 2, y + pad + i * lh, lh, { font, size, color: text });
  });
  return y + h;
}

/** Word wrap to `width`; words longer than a line are broken. */
function wrap(ctx: BodyContext, text: string, font: FontKey, size: number, width: number): string[] {
  const fits = (s: string) => ctx.measure(s, font, size) <= width;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (fits(tryLine)) {
      line = tryLine;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    let rest = word;
    while (!fits(rest)) {
      let n = rest.length - 1;
      while (n > 1 && !fits(rest.slice(0, n))) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

function ellipsis(ctx: BodyContext, line: string, font: FontKey, size: number, width: number): string {
  let s = line;
  while (s && ctx.measure(`${s}…`, font, size) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function errors(ctx: BodyContext, list: string[], x: number, y: number, width: number): number {
  const { u } = ctx;
  const top = y;
  for (const e of list.slice(0, 8)) {
    ctx.line(e, x, y, u(22), { font: "mono", size: u(13), color: COLOR.red, maxWidth: width });
    y += u(22);
  }
  ctx.flush(top);
  return y;
}
