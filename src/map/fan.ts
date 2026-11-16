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
  /** Space between grouped heads. */
  gap: 5,
};

/** How pins standing on one spot are drawn. */
export type GroupStyle = "fan" | "badge" | "column" | "arc";
export const GROUP_STYLES: { id: GroupStyle; label: string }[] = [
  { id: "badge", label: "Badge (one strip, one pointer)" },
  { id: "column", label: "Column (stacked, one pointer)" },
  { id: "arc", label: "Arc (heads around the spot)" },
  { id: "fan", label: "Fan (row, converging pointers)" },
];
export const DEFAULT_GROUP_STYLE: GroupStyle = "badge";

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
  /** Centre x and top of the head, for the initials. */
  hx: number;
  top: number;
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

function head(l: number, top: number, w: number, cut: boolean, neckAt: number | null, tip: Pt = [0, 0]): Pt[] {
  const r = l + w;
  const b = top + PIN.size;
  const c = PIN.cut;
  const pts: Pt[] = [[l, top], ...(cut ? ([[r - c, top], [r, top + c]] as Pt[]) : ([[r, top]] as Pt[])), [r, b]];
  if (neckAt !== null) pts.push([neckAt + PIN.neck, b], tip, [neckAt - PIN.neck, b]);
  pts.push([l, b]);
  return pts;
}

const lone = (): PinSlot => {
  const top = -PIN.size - PIN.stem;
  return { outline: head(-PIN.size / 2, top, PIN.size, true, 0), hx: 0, top };
};
export const LONE_SLOT: PinSlot = lone();

/** Drawings for a group standing on one spot, in group order. */
export function groupSlots(n: number, style: GroupStyle): PinSlot[] {
  if (n <= 1) return [LONE_SLOT];
  const { size: s, stem, gap } = PIN;
  const idx = [...Array(n).keys()];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  switch (style) {
    case "fan": {
      // Heads in a row, a little higher the wider it gets; every pointer meets the spot.
      const top = -s - stem - 4 * (n - 1);
      return idx.map((i) => {
        const hx = (i - (n - 1) / 2) * (s + gap);
        return { outline: head(hx - s / 2, top, s, true, hx), hx, top };
      });
    }
    case "badge": {
      // One strip of segments; the pointer leaves the middle segment straight down.
      // Odd count: from the middle segment's centre; even: from the joint of the middle two.
      const even = n % 2 === 0;
      const k = even ? n / 2 - 1 : (n - 1) / 2;
      const top = -s - stem;
      return idx.map((i) => {
        const l = even ? (i - n / 2) * s : (i - k) * s - s / 2;
        const neck = i !== k ? null : even ? l + s : l + s / 2;
        return { outline: head(l, top, s, i === n - 1, neck), hx: l + s / 2, top };
      });
    }
    case "column": {
      // Heads stacked upwards; the bottom one carries the pointer.
      return idx.map((i) => {
        const top = -s - stem - (n - 1 - i) * (s + 3);
        return { outline: head(-s / 2, top, s, true, i === n - 1 ? 0 : null), hx: 0, top };
      });
    }
    case "arc": {
      // Heads on an arc above the spot, each pointing in.
      const step = Math.min((40 * Math.PI) / 180, ((120 * Math.PI) / 180) / (n - 1));
      const at = (radius: number, i: number) => {
        const a = (i - (n - 1) / 2) * step;
        return { hx: r1(radius * Math.sin(a)), top: r1(-radius * Math.cos(a) - s / 2) };
      };
      // Square heads: neighbours need a full head of clearance on one axis.
      let radius = (s + gap) / (2 * Math.sin(step / 2));
      const clear = (r: number) =>
        idx.slice(1).every((i) => {
          const a = at(r, i - 1);
          const b = at(r, i);
          return Math.max(Math.abs(a.hx - b.hx), Math.abs(a.top - b.top)) >= s + gap;
        });
      while (!clear(radius)) radius += 1;
      return idx.map((i) => {
        const { hx, top } = at(radius, i);
        return { outline: head(hx - s / 2, top, s, true, hx), hx, top };
      });
    }
  }
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

/** Default label spot: plate starting a little right of the symbol. */
export const LABEL_GAP = 14;
export function defaultAnchor(symbol: { x: number; y: number }, align: Align, width: number, unit: number) {
  return { x: round(symbol.x + LABEL_GAP * unit - boxLeft(align, width)), y: symbol.y };
}
