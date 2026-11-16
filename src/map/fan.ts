/**
 * Pure placement maths for map markers, free of fonts and OBR so it can be
 * tested on its own. Design units: 100 = one map cell at marker size 1; `unit`
 * is scene units per design unit.
 */
import type { Pt } from "../core/geometry";

export type Align = "left" | "center" | "right";
export const ALIGNS: Align[] = ["left", "center", "right"];

// ---------------------------------------------------------------------------
// Runner pins

export const PIN = {
  /** Head square side. */
  size: 30,
  /** Cut corner of the head. */
  cut: 7,
  /** Gap between the head bottom and the tip of a lone pin. */
  stem: 9,
  /** Half width of the pointer where it leaves the head. */
  neck: 5,
  /** Reach beyond a head width within which pins count as on one spot. */
  gap: 5,
};

/**
 * Pins on one spot are drawn as a thin column: one joined box of short
 * segments stacked upwards, initials side by side.
 */
const COLUMN = { w: 30, h: 15, text: { stack: false, size: 10 } as PinText };

export interface PinText {
  /** One letter per line instead of side by side. */
  stack: boolean;
  size: number;
}

export interface PinTip {
  id: string;
  x: number;
  y: number;
  /** Sort key for the order inside a group (crew order, then name). */
  rank: string;
}

/** A pin's drawing relative to its tip, in design units. */
export interface PinSlot {
  outline: Pt[];
  /** Centre x, top and height of the head, for the initials. */
  hx: number;
  top: number;
  h: number;
  text: PinText;
}

/** Pins closer than one head width (chains count) stand on one spot. */
export function groupTips(tips: PinTip[], unit: number): PinTip[][] {
  const reach = (PIN.size + PIN.gap) * unit;
  const parent = tips.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < tips.length; i++) {
    for (let j = i + 1; j < tips.length; j++) {
      if (Math.hypot(tips[i].x - tips[j].x, tips[i].y - tips[j].y) < reach) parent[root(i)] = root(j);
    }
  }
  const groups = new Map<number, PinTip[]>();
  tips.forEach((tip, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), tip]));
  return [...groups.values()].map((g) => g.sort(byRank));
}

const byRank = (a: PinTip, b: PinTip) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1);
const same = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/**
 * The spot a group snaps to: where the pins that didn't just move stand (the
 * spot most of them share), so a dropped pin joins the others rather than
 * pulling them over. `last` holds the positions from the previous sync.
 */
export function pickSpot(group: PinTip[], last: Map<string, { x: number; y: number }>): { x: number; y: number } {
  const still = group.filter((t) => {
    const was = last.get(t.id);
    return was && same(was, t);
  });
  const pool = still.length ? still : group;
  let best = pool[0];
  let count = 0;
  for (const t of pool) {
    const n = pool.filter((o) => same(o, t)).length;
    if (n > count) [best, count] = [t, n];
  }
  return { x: best.x, y: best.y };
}

/**
 * A head box with its top-right corner cut. `neck` is the stretch of the
 * bottom edge the pointer leaves from (it may be only a half pointer).
 */
function head(l: number, top: number, w: number, h: number, cut: boolean, neck: [number, number] | null, tip: Pt = [0, 0]): Pt[] {
  const r = l + w;
  const b = top + h;
  const c = Math.min(PIN.cut, w / 3, h / 3);
  const pts: Pt[] = [[l, top], ...(cut ? ([[r - c, top], [r, top + c]] as Pt[]) : ([[r, top]] as Pt[])), [r, b]];
  if (neck) {
    if (neck[1] < r) pts.push([neck[1], b]);
    pts.push(tip);
    if (neck[0] > l) pts.push([neck[0], b]);
  }
  if (!neck || neck[0] > l) pts.push([l, b]);
  return pts;
}

const ROW: PinText = { stack: false, size: 15 };
const full = (x: number): [number, number] => [x - PIN.neck, x + PIN.neck];

const lone = (): PinSlot => {
  const top = -PIN.size - PIN.stem;
  return { outline: head(-PIN.size / 2, top, PIN.size, PIN.size, true, full(0)), hx: 0, top, h: PIN.size, text: ROW };
};
export const LONE_SLOT: PinSlot = lone();

/** Drawings for a group standing on one spot, in group order. */
export function groupSlots(n: number): PinSlot[] {
  if (n <= 1) return [LONE_SLOT];
  // One box of heads stacked upwards: the top one has the cut corner, the
  // bottom one carries the pointer.
  const { w, h, text } = COLUMN;
  return [...Array(n).keys()].map((i) => {
    const top = -h - PIN.stem - (n - 1 - i) * h;
    return { outline: head(-w / 2, top, w, h, i === 0, i === n - 1 ? full(0) : null), hx: 0, top, h, text };
  });
}

// ---------------------------------------------------------------------------
// Location labels

/**
 * A label's position is its anchor: the left edge, centre or right edge of
 * the plate (by alignment), vertically centred. A longer name then grows away
 * from the anchor in the direction the text is aligned.
 */
export function boxLeft(align: Align, width: number): number {
  return align === "left" ? 0 : align === "center" ? -width / 2 : -width;
}

export interface LabelState {
  /** Marker size unit the label was drawn with. */
  unit: number;
  align: Align;
  /** Plate width in scene units. */
  width: number;
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * New anchor for a redrawn label, in scene units. The plate's left edge stays
 * where it was (scaled with the marker size around the symbol), so changing
 * the alignment doesn't make the label jump.
 */
export function moveAnchor(
  anchor: { x: number; y: number },
  symbol: { x: number; y: number },
  was: LabelState,
  next: LabelState,
): { x: number; y: number } {
  const k = next.unit / was.unit;
  const left = symbol.x + (anchor.x - symbol.x + boxLeft(was.align, was.width)) * k;
  return {
    x: round(left - boxLeft(next.align, next.width)),
    y: round(symbol.y + (anchor.y - symbol.y) * k),
  };
}

/** Where a label sits around its icon. */
export type LabelSide = "left" | "right" | "top" | "bottom";

/**
 * The label's spot next to its icon, with the aligned edge facing the icon:
 * "left" (left-aligned) to the right of it, "right" to the left, "top" and
 * "bottom" centred above or below. `half` is half the icon's size and `gap`
 * the space to the plate (scene units).
 */
export function snapAnchor(icon: { x: number; y: number }, side: LabelSide, height: number, half: number, gap: number) {
  if (side === "left") return { x: round(icon.x + half + gap), y: icon.y };
  if (side === "right") return { x: round(icon.x - half - gap), y: icon.y };
  const dy = half + gap + height / 2;
  return { x: icon.x, y: round(side === "top" ? icon.y - dy : icon.y + dy) };
}
