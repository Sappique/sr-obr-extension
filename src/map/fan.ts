/**
 * Pure placement maths for map markers, free of fonts and OBR so it can be
 * tested on its own. Design units: 100 = one map cell at marker size 1; `unit`
 * is scene units per design unit.
 */

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
  /** Space between fanned heads. */
  gap: 5,
};

export interface PinTip {
  id: string;
  x: number;
  y: number;
}

/** Where a pin's head is drawn, relative to its tip, in design units. */
export interface PinSlot {
  /** Head centre x. */
  hx: number;
  /** Head top y. */
  top: number;
}

export const LONE_SLOT: PinSlot = { hx: 0, top: -PIN.size - PIN.stem };

/**
 * Pins whose heads would overlap form a group (chains count: A near B near C).
 * A group's heads are laid out side by side above its topmost tip, ordered by
 * tip x, so every pointer still ends at its own pin's position.
 */
export function fanSlots(tips: PinTip[], unit: number): Map<string, PinSlot> {
  const reach = (PIN.size + PIN.gap) * unit;
  const parent = tips.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < tips.length; i++) {
    for (let j = i + 1; j < tips.length; j++) {
      if (Math.hypot(tips[i].x - tips[j].x, tips[i].y - tips[j].y) < reach) parent[root(i)] = root(j);
    }
  }
  const step = PIN.size + PIN.gap;
  const groupsOf = () => {
    const groups = new Map<number, PinTip[]>();
    tips.forEach((tip, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), tip]));
    return groups;
  };
  /** Scene box of a group's row of heads. */
  const headRow = (group: PinTip[]) => {
    const cx = group.reduce((s, t) => s + t.x, 0) / group.length;
    const half = ((group.length * step - PIN.gap) / 2) * unit;
    const top = Math.min(...group.map((t) => t.y)) - (PIN.size + PIN.stem) * unit;
    return { l: cx - half, r: cx + half, t: top, b: top + PIN.size * unit };
  };
  // A fan can spread over a neighbour's head: then that neighbour joins it.
  for (let merged = true; merged; ) {
    merged = false;
    const rows = [...groupsOf()].map(([key, group]) => ({ key, box: headRow(group) }));
    const gap = PIN.gap * unit;
    for (let i = 0; i < rows.length && !merged; i++) {
      for (let j = i + 1; j < rows.length && !merged; j++) {
        const a = rows[i].box;
        const b = rows[j].box;
        if (a.l < b.r + gap && b.l < a.r + gap && a.t < b.b && b.t < a.b) {
          parent[root(rows[i].key)] = root(rows[j].key);
          merged = true;
        }
      }
    }
  }
  const groups = groupsOf();

  const slots = new Map<string, PinSlot>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      slots.set(group[0].id, LONE_SLOT);
      continue;
    }
    group.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
    const cx = group.reduce((s, t) => s + t.x, 0) / group.length;
    const topTip = Math.min(...group.map((t) => t.y));
    group.forEach((tip, i) => {
      const headX = cx / unit + (i - (group.length - 1) / 2) * step;
      slots.set(tip.id, {
        hx: round(headX - tip.x / unit),
        top: round((topTip - tip.y) / unit - PIN.size - PIN.stem),
      });
    });
  }
  return slots;
}

const round = (v: number) => Math.round(v * 10) / 10;

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
