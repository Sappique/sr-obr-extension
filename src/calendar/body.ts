import type { BodyContext } from "../core/body";
import { rect, rectRing } from "../core/geometry";
import { COLOR } from "../core/style";
import {
  CalEvent, Calendar, Day, dayNumber, EventType, fromNumber, parseCalendar, short, weekday,
} from "./format";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DAYNAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

const TYPE_COLOR: Record<EventType, string> = {
  run: COLOR.yellow,
  deadline: COLOR.red,
  meeting: COLOR.cyan,
  past: COLOR.grey,
  downtime: COLOR.body,
};
const ORDER: Record<EventType, number> = { deadline: 0, run: 1, meeting: 2, past: 3, downtime: 4 };

/** Two columns from this width on (design px); narrower windows stack. */
const TWO_COLUMNS = 1000;

export function calendarBody(ctx: BodyContext, source: string, x: number, y: number, width: number): number {
  const cal = parseCalendar(source);
  const { u } = ctx;
  const two = width >= u(TWO_COLUMNS);
  const gap = u(40);
  const leftW = two ? Math.round((width - gap) * 0.54) : width;
  const rightX = two ? x + leftW + gap : x;
  const rightW = two ? width - leftW - gap : width;

  let left = hero(ctx, cal, x, y, leftW);
  left = monthGrid(ctx, cal, x, left + u(14), leftW);
  left = legend(ctx, cal, x, left + u(16), leftW);

  let right = two ? y : left + u(26);
  right = upcoming(ctx, cal, rightX, right, rightW);
  right = runLog(ctx, cal, rightX, right + u(18), rightW);
  right = downtime(ctx, cal, rightX, right + u(18), rightW);
  if (cal.errors.length) right = errors(ctx, cal.errors, rightX, right + u(14), rightW);
  return Math.max(two ? left : 0, right);
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
  const sub = [DAYNAMES[weekday(t)], cal.note].filter(Boolean).join(" · ");
  ctx.line(sub, tx, y + u(66), u(20), {
    font: "mono", size: u(14), color: COLOR.dim, spacing: 0.2, upper: true, maxWidth: width - (tx - x),
  });
  ctx.flush(y);
  return y + lh;
}

function eventsOn(cal: Calendar, d: Day): CalEvent[] {
  const n = dayNumber(d);
  return cal.events
    .filter((e) => dayNumber(e) === n)
    .sort((a, b) => ORDER[a.type] - ORDER[b.type]);
}

function runnerColor(cal: Calendar, who?: string) {
  return cal.runners.find((r) => r.name === who)?.color ?? COLOR.body;
}

function monthGrid(ctx: BodyContext, cal: Calendar, x: number, y: number, width: number): number {
  const { u } = ctx;
  const t = cal.today;
  const colW = width / 7;
  const cellGap = u(4);
  const cellH = u(86);
  const labelH = u(26);
  WEEKDAYS.forEach((name, i) => {
    ctx.line(name, x + i * colW + u(8), y, labelH, { font: "mono", size: u(13), color: COLOR.dim, spacing: 0.1 });
  });
  ctx.flush(y);
  y += labelH;

  const first: Day = { y: t.y, m: t.m, d: 1 };
  const days = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate();
  const offset = weekday(first);
  const weeks = Math.ceil((offset + days) / 7);
  const todayN = dayNumber(t);
  let top = y;
  for (let w = 0; w < weeks; w++) {
    const rowY = y + w * cellH;
    if (ctx.pending() > 2500) {
      ctx.flush(top);
      top = rowY;
    }
    for (let i = 0; i < 7; i++) {
      const d = w * 7 + i - offset + 1;
      if (d < 1 || d > days) continue;
      const day: Day = { y: t.y, m: t.m, d };
      const cx = x + i * colW;
      const cw = colW - cellGap;
      const ch = cellH - cellGap;
      const n = dayNumber(day);
      const isToday = n === todayN;
      const past = n < todayN;
      ctx.add("fill", COLOR.white, isToday ? 0.06 : 0.03, rect(cx, rowY, cw, ch));
      if (isToday) ctx.add("text", COLOR.yellow, 1, rectRing(cx, rowY, cw, ch, u(3)));
      ctx.line(String(d).padStart(2, "0"), cx + u(8), rowY + u(4), u(22), {
        font: "mono", size: u(13), color: isToday ? COLOR.yellow : past ? COLOR.steel : COLOR.dim,
      });
      eventsOn(cal, day).slice(0, 2).forEach((e, k) => chip(ctx, cal, e, cx + u(6), rowY + u(28) + k * u(26), cw - u(12)));
    }
  }
  ctx.flush(top);
  return y + weeks * cellH;
}

function chip(ctx: BodyContext, cal: Calendar, e: CalEvent, x: number, y: number, width: number) {
  const { u } = ctx;
  const h = u(22);
  const style = { font: "regular" as const, size: u(14), maxWidth: width - u(12) };
  const title = e.type === "downtime" && e.who ? `${e.who}: ${e.title}` : e.title;
  switch (e.type) {
    case "run":
    case "deadline":
    case "past": {
      const bg = e.type === "run" ? COLOR.yellow : e.type === "deadline" ? COLOR.red : COLOR.grey;
      ctx.add("fill", bg, e.type === "past" ? 0.45 : 1, rect(x, y, width, h));
      ctx.line(title, x + u(6), y, h, { ...style, color: e.type === "deadline" ? COLOR.white : COLOR.black });
      break;
    }
    case "meeting":
      ctx.add("text", COLOR.cyan, 1, rectRing(x, y, width, h, u(1.5)));
      ctx.line(title, x + u(6), y, h, { ...style, color: COLOR.cyan });
      break;
    case "downtime": {
      const c = runnerColor(cal, e.who);
      ctx.add("fill", c, 1, rect(x, y, u(3), h));
      ctx.line(title, x + u(9), y, h, { ...style, color: COLOR.body });
      break;
    }
  }
}

function legend(ctx: BodyContext, cal: Calendar, x: number, y: number, width: number): number {
  const { u } = ctx;
  const h = u(20);
  const s = u(10);
  let cx = x;
  const item = (label: string, draw: (bx: number, by: number) => void) => {
    const w = ctx.measure(label.toUpperCase(), "mono", u(12), 0.12) + s + u(26);
    if (cx + w > x + width) return;
    draw(cx, y + (h - s) / 2);
    ctx.line(label, cx + s + u(7), y, h, { font: "mono", size: u(12), color: COLOR.dim, spacing: 0.12, upper: true });
    cx += w;
  };
  item("Run", (bx, by) => ctx.add("fill", COLOR.yellow, 1, rect(bx, by, s, s)));
  item("Deadline", (bx, by) => ctx.add("fill", COLOR.red, 1, rect(bx, by, s, s)));
  item("Treffen", (bx, by) => ctx.add("text", COLOR.cyan, 1, rectRing(bx, by, s, s, u(2))));
  item("Vergangener Run", (bx, by) => ctx.add("fill", COLOR.grey, 0.45, rect(bx, by, s, s)));
  for (const r of cal.runners) item(r.name, (bx, by) => ctx.add("fill", r.color, 1, rect(bx, by, s, s)));
  ctx.flush(y);
  return y + h;
}

function upcoming(ctx: BodyContext, cal: Calendar, x: number, y: number, width: number): number {
  const { u } = ctx;
  y = ctx.heading("Deadlines & Termine", 2, x, y, width) + u(8);
  const todayN = dayNumber(cal.today);
  const seen = new Set<string>();
  const list = cal.events
    .filter((e) => e.type !== "downtime" && e.type !== "past" && dayNumber(e) > todayN)
    .filter((e) => {
      const key = `${e.type}|${e.title}`;
      if (seen.has(key)) return false; // multi-day entries show once, at their start
      seen.add(key);
      return true;
    })
    .sort((a, b) => dayNumber(a) - dayNumber(b))
    .slice(0, 6);
  if (!list.length) return emptyLine(ctx, "Keine anstehenden Termine", x, y, width);
  const rowH = u(42);
  const top = y;
  for (const e of list) {
    const c = TYPE_COLOR[e.type];
    ctx.add("fill", COLOR.white, 0.03, rect(x, y, width, rowH - u(4)));
    ctx.add("fill", c, 1, rect(x, y, u(3), rowH - u(4)));
    const tw = ctx.line(`T-${dayNumber(e) - todayN}`, x + u(14), y, rowH - u(4), { font: "display", size: u(18), color: c });
    const dateW = ctx.line(short(e), x + width - u(10), y, rowH - u(4), { font: "mono", size: u(13), color: COLOR.dim, align: "right" });
    const tx = x + u(14) + Math.max(tw, u(70)) + u(14);
    ctx.line(e.title, tx, y, rowH - u(4), {
      font: "bold", size: u(19), color: COLOR.white, maxWidth: x + width - tx - dateW - u(20),
    });
    y += rowH;
  }
  ctx.flush(top);
  return y;
}

function runLog(ctx: BodyContext, cal: Calendar, x: number, y: number, width: number): number {
  const { u } = ctx;
  y = ctx.heading("Run-Log", 2, x, y, width) + u(6);
  const todayN = dayNumber(cal.today);
  const list = cal.events
    .filter((e) => (e.type === "run" || e.type === "past") && dayNumber(e) <= todayN)
    .sort((a, b) => dayNumber(b) - dayNumber(a))
    .slice(0, 8);
  if (!list.length) return emptyLine(ctx, "Noch keine Runs", x, y, width);
  const rowH = u(32);
  const top = y;
  for (const e of list) {
    ctx.line(short(e), x, y, rowH, { font: "mono", size: u(13), color: COLOR.dim });
    ctx.line(e.title, x + u(70), y, rowH, {
      font: "regular", size: u(19), color: e.type === "past" ? COLOR.grey : COLOR.white, maxWidth: width - u(70),
    });
    y += rowH;
  }
  ctx.flush(top);
  return y;
}

function downtime(ctx: BodyContext, cal: Calendar, x: number, y: number, width: number): number {
  const { u } = ctx;
  const todayN = dayNumber(cal.today);
  const days = 37;
  const startN = todayN - days + 1;
  y = ctx.heading(`Downtime // ${short(fromNumber(startN))} – ${short(cal.today)}`, 2, x, y, width) + u(8);
  if (!cal.runners.length) return emptyLine(ctx, "Runner: Name #farbe eintragen", x, y, width);

  const nameW = Math.max(...cal.runners.map((r) => ctx.measure(r.name.toUpperCase(), "bold", u(17), 0.04))) + u(26);
  const laneX = x + nameW;
  const laneW = width - nameW;
  const cell = laneW / days;
  const rowH = u(26);
  const lanesTop = y;
  for (const r of cal.runners) {
    ctx.add("fill", r.color, 1, rect(x, y + rowH / 2 - u(5), u(10), u(10)));
    ctx.line(r.name, x + u(16), y, rowH, { font: "bold", size: u(17), color: COLOR.white, spacing: 0.04, upper: true });
    const busy = new Set(cal.events.filter((e) => e.type === "downtime" && e.who === r.name).map((e) => dayNumber(e) - startN));
    for (let i = 0; i < days; i++) {
      const on = busy.has(i);
      const cx = laneX + i * cell;
      ctx.add("fill", on ? r.color : COLOR.white, on ? 1 : 0.05, rect(cx, y + u(4), cell - u(2), rowH - u(8)));
    }
    ctx.add("text", COLOR.yellow, 1, rectRing(laneX + (days - 1) * cell - u(1), y + u(2), cell + u(0), rowH - u(4), u(1.5)));
    y += rowH;
  }
  const axisH = u(20);
  ctx.line(short(fromNumber(startN)), laneX, y, axisH, { font: "mono", size: u(11), color: COLOR.dim });
  ctx.line(short(fromNumber(startN + Math.floor(days / 2))), laneX + laneW / 2, y, axisH, { font: "mono", size: u(11), color: COLOR.dim, align: "center" });
  ctx.line("Heute", laneX + laneW, y, axisH, { font: "mono", size: u(11), color: COLOR.yellow, align: "right", upper: true });
  ctx.flush(lanesTop);
  y += axisH + u(10);

  // Downtime entries, one line per entry (ranges once), oldest first, the last 10.
  const seen = new Set<string>();
  const entries = cal.events
    .filter((e) => e.type === "downtime" && dayNumber(e) <= todayN + 30)
    .filter((e) => {
      if (!e.span) return true;
      const key = `${e.who}|${e.title}|${dayNumber(e) - e.span[0]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => dayNumber(a) - dayNumber(b))
    .slice(-10);
  const rowL = u(28);
  const listTop = y;
  for (const e of entries) {
    const date = e.span && e.span[1] > 1 ? spanLabel(e) : short(e);
    ctx.line(date, x, y, rowL, { font: "mono", size: u(13), color: COLOR.dim });
    const c = runnerColor(cal, e.who);
    ctx.add("fill", c, 1, rect(x + u(96), y + rowL / 2 - u(4), u(8), u(8)));
    const nameW = e.who ? ctx.line(e.who, x + u(112), y, rowL, { font: "bold", size: u(17), color: COLOR.white }) : 0;
    ctx.line(`${e.who ? " · " : ""}${e.title}`, x + u(112) + nameW, y, rowL, {
      font: "regular", size: u(17), color: COLOR.body, maxWidth: width - u(92) - nameW,
    });
    y += rowL;
  }
  ctx.flush(listTop);
  return y;
}

/** "16.–17.04." for a range starting at e. */
function spanLabel(e: CalEvent): string {
  const end = fromNumber(dayNumber(e) + e.span![1] - 1);
  return end.m === e.m ? `${String(e.d).padStart(2, "0")}.–${short(end)}` : `${short(e)}–${short(end)}`;
}

function emptyLine(ctx: BodyContext, text: string, x: number, y: number, width: number): number {
  const h = ctx.u(28);
  ctx.line(text, x, y, h, { font: "regular", size: ctx.u(17), color: COLOR.dim, maxWidth: width });
  ctx.flush(y);
  return y + h;
}

function errors(ctx: BodyContext, list: string[], x: number, y: number, width: number): number {
  const h = ctx.u(22);
  for (const e of list.slice(0, 5)) {
    ctx.line(`! ${e}`, x, y, h, { font: "mono", size: ctx.u(12), color: COLOR.red, maxWidth: width });
    y += h;
  }
  ctx.flush(y - h * Math.min(5, list.length));
  return y;
}
