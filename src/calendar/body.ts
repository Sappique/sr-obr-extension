import type { BodyContext } from "../core/body";
import type { FontKey } from "../core/fonts";
import { polygon, Pt, rect, rectRing } from "../core/geometry";
import { COLOR } from "../core/style";
import type { WindowSpec } from "../windows/layout";
import { CalEvent, Calendar, Day, dayNumber, daysIn, parseCalendar, weekday } from "./format";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DAYNAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];


/** Every month has six rows, so a day cell is always the same size. */
const ROWS = 6;

/**
 * The calendar: a big current date, then the month before, the current month
 * and the month after, all the same size. Day cells have a fixed size; event titles wrap
 * inside them, and what doesn't fit is summed up as "+N".
 */
export function calendarBody(ctx: BodyContext, spec: WindowSpec, x: number, y: number, width: number): number {
  const cal = parseCalendar(spec.markdown, spec.today, spec.crewColors);
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
  for (let row = 0; row < ROWS; row++) {
    const rowY = y + row * cellH;
    const week = Array.from({ length: 7 }, (_, i): Day | null => {
      const d = row * 7 + i - offset + 1;
      return d >= 1 && d <= days ? { y: which.y, m: which.m, d } : null;
    });
    if (week.some(Boolean)) weekRow(ctx, cal, week, x, rowY, colW, colW - cellGap, cellH - cellGap);
    ctx.flush(rowY);
  }
  return y + ROWS * cellH;
}

/** Sizes inside a day cell, in scene units. */
function cellMetrics(ctx: BodyContext) {
  const s = ctx.u;
  const size = s(12.5);
  return {
    numH: s(22),
    pad: s(5),
    font: "regular" as FontKey,
    size,
    lh: size * 1.2,
    chipPad: s(2.5),
    gap: s(2),
    /** Arrow tip length where a multi-day entry goes on past a Sunday or the month's end. */
    tip: s(9),
    /** Line style: thickness of the line and height of its arrow head. */
    lineW: s(2.5),
    headH: s(9),
  };
}

/** A multi-day entry's part within one week row of one month. */
interface Segment {
  e: CalEvent;
  /** First and last column. */
  a: number;
  b: number;
  /** Carries the title: the entry's first part, or its first part in this month. */
  named: boolean;
  /** The entry goes on after this part (arrow tip). */
  continues: boolean;
}

/**
 * One week of a month: day tiles, then multi-day entries as continuous parts
 * on top (each placed as high as the days it covers allow), then single-day
 * entries below them in each cell. The cells never grow; what doesn't fit
 * becomes "+N".
 */
function weekRow(ctx: BodyContext, cal: Calendar, week: (Day | null)[], x: number, y: number, colW: number, w: number, h: number) {
  const s = ctx.u;
  const m = cellMetrics(ctx);
  const todayN = dayNumber(cal.today);
  const colX = (i: number) => x + i * colW;

  const byCol = week.map((day) => (day ? cal.events.filter((e) => dayNumber(e) === dayNumber(day)) : []));
  week.forEach((day, i) => {
    if (!day) return;
    const n = dayNumber(day);
    // Past days keep the plain tile; today and later are a little brighter.
    ctx.add("fill", COLOR.white, n < todayN ? 0.05 : 0.09, rect(colX(i), y, w, h));
    if (n === todayN) ctx.add("text", COLOR.yellow, 1, rectRing(colX(i), y, w, h, s(3)));
    ctx.line(String(day.d).padStart(2, "0"), colX(i) + s(6), y + s(2), m.numH, {
      font: "mono", size: s(13), color: n === todayN ? COLOR.yellow : COLOR.body,
    });
  });

  // Multi-day parts in this row, in order of their first day (longer first).
  const segments: Segment[] = [];
  byCol.forEach((events, i) => {
    for (const e of events.filter((ev) => ev.span)) {
      const seg = segments.find((sg) => sg.e.entry === e.entry && sg.b === i - 1);
      const last = e.span![0] === e.span![1] - 1;
      if (seg) {
        seg.b = i;
        seg.continues = !last;
      } else {
        segments.push({ e, a: i, b: i, named: e.span![0] === 0 || week[i]!.d === 1, continues: !last });
      }
    }
  });
  segments.sort((p, q) => p.a - q.a || q.b - q.a - (p.b - p.a));

  const top = y + m.numH + m.gap;
  const bottom = y + h - m.pad;
  const sky = Array(7).fill(top);
  const hidden = Array(7).fill(0);
  for (const seg of segments) {
    const cols = [...Array(seg.b - seg.a + 1).keys()].map((k) => seg.a + k);
    const sy = Math.max(...cols.map((c) => sky[c]));
    const left = colX(seg.a) + m.pad;
    const right = colX(seg.b) + w - m.pad;
    const textW = right - left - 4 * m.chipPad - (seg.continues ? m.tip : 0);
    let lines = seg.named ? wrap(ctx, seg.e.title || " ", m.font, m.size, textW) : [];
    const heightOf = (n: number) => spanHeight(seg.e, n, m);
    const room = bottom - sy;
    if (heightOf(lines.length) > room) {
      let fit = lines.length;
      while (fit > 0 && heightOf(fit) > room) fit--;
      if (fit === 0 && heightOf(0) > room) {
        for (const c of cols) hidden[c]++;
        continue;
      }
      lines = lines.slice(0, fit);
      if (fit > 0) lines[fit - 1] = ellipsis(ctx, lines[fit - 1], m.font, m.size, textW);
    }
    const end = drawSpan(ctx, seg.e, lines, left, sy, right - left, seg.continues, m);
    for (const c of cols) sky[c] = end + m.gap;
  }

  // Single-day entries below, per cell.
  byCol.forEach((events, i) => {
    if (!week[i]) return;
    const singles = events.filter((e) => !e.span);
    let cy = sky[i];
    const cx = colX(i) + m.pad;
    const cw = w - 2 * m.pad;
    const innerW = cw - 2 * m.chipPad;
    for (let k = 0; k < singles.length; k++) {
      const e = singles[k];
      const lines = wrap(ctx, e.title || " ", m.font, m.size, innerW);
      const left = singles.length - k - 1 + hidden[i];
      const room = bottom - cy;
      const needed = lines.length * m.lh + 2 * m.chipPad;
      // Keep one line for "+N" if more entries follow and this one doesn't fit.
      if (needed > room - (left > 0 ? m.lh : 0)) {
        const fit = Math.floor((room - 2 * m.chipPad - (left > 0 ? m.lh : 0)) / m.lh);
        if (fit >= 1) {
          const cut = lines.slice(0, fit);
          cut[fit - 1] = ellipsis(ctx, cut[fit - 1], m.font, m.size, innerW);
          cy = chip(ctx, e, cut, cx, cy, cw, m.lh, m.chipPad, m.size, m.font);
          if (left > 0) more(ctx, left, cx, cy, m.lh, s);
        } else more(ctx, left + 1, cx, cy, m.lh, s);
        return;
      }
      cy = chip(ctx, e, lines, cx, cy, cw, m.lh, m.chipPad, m.size, m.font) + m.gap;
    }
    if (hidden[i] > 0 && bottom - cy >= m.lh) more(ctx, hidden[i], cx, cy, m.lh, s);
  });
}

/** Height of a multi-day part with `lines` lines of title (0 = no title). */
function spanHeight(e: CalEvent, lines: number, m: ReturnType<typeof cellMetrics>) {
  if (e.style === "line") return m.headH + (lines ? m.gap + lines * m.lh : 0);
  return Math.max(1, lines) * m.lh + 2 * m.chipPad;
}

/** A rectangle whose right end is an arrow tip (or square when `tip` is 0). */
function arrowBox(x: number, y: number, w: number, h: number, tip: number): Pt[] {
  const r = x + w;
  return tip > 0
    ? [[x, y], [r - tip, y], [r, y + h / 2], [r - tip, y + h], [x, y + h]]
    : [[x, y], [r, y], [r, y + h], [x, y + h]];
}

/** Draws one multi-day part in its style; returns its bottom. */
function drawSpan(ctx: BodyContext, e: CalEvent, lines: string[], x: number, y: number, w: number, continues: boolean, m: ReturnType<typeof cellMetrics>) {
  const color = e.past ? PAST.color : e.color;
  const h = spanHeight(e, lines.length, m);
  const tip = continues ? Math.min(m.tip, h / 2) : 0;
  let text = color;
  let textY = y + m.chipPad;
  switch (e.style) {
    case "box":
      ctx.add("fill", color, e.past ? PAST.fill : 1, polygon(arrowBox(x, y, w, h, tip)));
      text = e.past ? COLOR.white : onFill(color);
      break;
    case "outline": {
      const t = Math.max(1, m.chipPad * 0.5);
      const inner = arrowBox(x + t, y + t, w - 2 * t - (tip ? t * 0.6 : 0), h - 2 * t, tip ? Math.max(0, tip - t) : 0);
      ctx.add("text", color, 1, [...polygon(arrowBox(x, y, w, h, tip)), ...polygon(inner.reverse())]);
      break;
    }
    case "line": {
      // The line runs above the title, ending in an arrow head if the entry goes on.
      const bar = y + (m.headH - m.lineW) / 2;
      const r = x + w;
      const head = continues ? m.tip : 0;
      const pts: Pt[] = head
        ? [[x, bar], [r - head, bar], [r - head, y], [r, y + m.headH / 2], [r - head, y + m.headH], [r - head, bar + m.lineW], [x, bar + m.lineW]]
        : [[x, bar], [r, bar], [r, bar + m.lineW], [x, bar + m.lineW]];
      ctx.add("fill", color, 1, polygon(pts));
      text = e.past ? COLOR.grey : COLOR.body;
      textY = y + m.headH + m.gap;
      break;
    }
    case "text":
      break;
  }
  const textX = e.style === "line" ? x : x + m.chipPad * 2;
  lines.forEach((line, i) => {
    if (line) ctx.line(line, textX, textY + i * m.lh, m.lh, { font: m.font, size: m.size, color: text });
  });
  return y + h;
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

/** Past entries keep their style but turn grey. */
const PAST = { color: COLOR.grey, fill: 0.45 };

/** Draws one entry in its style; returns its bottom. */
function chip(ctx: BodyContext, e: CalEvent, lines: string[], x: number, y: number, w: number, lh: number, pad: number, size: number, font: FontKey) {
  const h = lines.length * lh + 2 * pad;
  const color = e.past ? PAST.color : e.color;
  let text = color;
  let textX = x + pad * 2;
  switch (e.style) {
    case "box":
      ctx.add("fill", color, e.past ? PAST.fill : 1, rect(x, y, w, h));
      text = e.past ? COLOR.white : onFill(color);
      break;
    case "line":
      ctx.add("fill", color, 1, rect(x, y, Math.max(1, pad * 1.2), h));
      text = e.past ? COLOR.grey : COLOR.body;
      textX = x + pad * 3;
      break;
    case "outline":
      ctx.add("text", color, 1, rectRing(x, y, w, h, Math.max(1, pad * 0.5)));
      break;
    case "text":
      break;
  }
  lines.forEach((line, i) => {
    if (line) ctx.line(line, textX, y + pad + i * lh, lh, { font, size, color: text });
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
