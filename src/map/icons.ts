/**
 * Location icons, chosen in designs/18-location-icons.html. Pure geometry
 * (no fonts, no OBR), in design units centred on the marker: the box is
 * -12..12. Everything is polygons: filled outlines run clockwise and holes
 * anticlockwise, for OBR Paths with the nonzero fill rule.
 */
import type { Pt } from "../core/geometry";

export interface Poly {
  p: Pt[];
  hole: boolean;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const area = (p: Pt[]) => p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0) / 2;

export function shape(pts: Pt[], hole = false): Poly {
  const p = pts.map(([x, y]) => [r1(x), r1(y)] as Pt);
  if (area(p) > 0 === hole) p.reverse();
  return { p, hole };
}
const poly = (...pts: Pt[]) => shape(pts);
const rect = (x: number, y: number, w: number, h: number) => poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
const ring = (n: number, f: (a: number) => Pt) => Array.from({ length: n }, (_, i) => f((i / n) * 2 * Math.PI));
const circ = (cx: number, cy: number, r: number, n = 28) => shape(ring(n, (a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)]));
const hole = (s: Poly) => shape(s.p, true);

/** Ring sector; angles in degrees, 0 = up, clockwise. */
function sector(cx: number, cy: number, r0: number, r: number, a0: number, a1: number, n = 16): Poly {
  const at = (q: number, a: number): Pt => [cx + q * Math.sin((a * Math.PI) / 180), cy - q * Math.cos((a * Math.PI) / 180)];
  const out: Pt[] = [];
  const inn: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(at(r, a));
    inn.unshift(at(r0, a));
  }
  return shape(r0 > 0 ? [...out, ...inn] : [...out, [cx, cy]]);
}

/** Cubic path "M x y C x1 y1 x2 y2 x y ... Z" (M/L/C only), sampled to a polygon. */
function path(d: string, n = 10): Poly {
  const t = d.match(/[MLCZ]|-?\d*\.?\d+/g) ?? [];
  const pts: Pt[] = [];
  let i = 0;
  let cur: Pt = [0, 0];
  let cmd = "";
  const num = () => Number(t[i++]);
  while (i < t.length) {
    if (/[MLCZ]/.test(t[i])) cmd = t[i++];
    if (cmd === "Z") break;
    if (cmd === "M" || cmd === "L") {
      cur = [num(), num()];
      pts.push(cur);
    } else if (cmd === "C") {
      const a: Pt = [num(), num()];
      const b: Pt = [num(), num()];
      const e: Pt = [num(), num()];
      const s = cur;
      for (let k = 1; k <= n; k++) {
        const u = k / n;
        const v = 1 - u;
        pts.push([
          v * v * v * s[0] + 3 * v * v * u * a[0] + 3 * v * u * u * b[0] + u * u * u * e[0],
          v * v * v * s[1] + 3 * v * v * u * a[1] + 3 * v * u * u * b[1] + u * u * u * e[1],
        ]);
      }
      cur = e;
    }
  }
  return shape(pts);
}

// Outer bodies.
const FRAME = {
  diamond: () => poly([0, -12], [12, 0], [0, 12], [-12, 0]),
  circle: () => circ(0, 0, 11.5, 36),
  hex: () => poly([0, -12], [10.4, -6], [10.4, 6], [0, 12], [-10.4, 6], [-10.4, -6]),
  // Smaller than the other bodies: a plain triangle looks big at full size.
  tri: () => poly([0, -9.5], [10, 8], [-10, 8]),
  house: () => poly([0, -12], [12, -2], [12, 12], [-12, 12], [-12, -2]),
};

export interface Icon {
  outer: Poly;
  detail: Poly[];
}

export type IconId = "person" | "group" | "corp" | "poi" | "bar" | "danger" | "home" | "plane" | "docks" | "ley" | "info";

export const ICONS: Record<IconId, () => Icon> = {
  person: () => ({ outer: FRAME.circle(), detail: [circ(0, -3.2, 3.3), path("M-6.5 7 C-6 2 -3.5 0.8 0 0.8 C3.5 0.8 6 2 6.5 7 Z")] }),
  group: () => ({
    outer: FRAME.circle(),
    detail: [
      circ(-5, -1.6, 2.1), circ(5, -1.6, 2.1), circ(0, -3.6, 2.5),
      path("M-9 6 C-8.7 2.6 -7 1.6 -5 1.6 C-3.6 1.6 -2.6 2 -2 2.8 L-2 6 Z"),
      path("M2 6 L2 2.8 C2.6 2 3.6 1.6 5 1.6 C7 1.6 8.7 2.6 9 6 Z"),
      path("M-3.6 6.5 C-3.4 1.8 -1.8 0.6 0 0.6 C1.8 0.6 3.4 1.8 3.6 6.5 Z"),
    ],
  }),
  corp: () => ({ outer: FRAME.hex(), detail: [rect(-5, -1.5, 10, 3)] }),
  poi: () => ({ outer: FRAME.diamond(), detail: [rect(-3, -3, 6, 6)] }),
  bar: () => ({
    outer: FRAME.circle(),
    detail: [poly([-6.5, -6.5], [6.5, -6.5], [1.1, -0.5], [1.1, 4.8], [3.5, 6.5], [-3.5, 6.5], [-1.1, 4.8], [-1.1, -0.5])],
  }),
  // Just the red triangle, nothing inside.
  danger: () => ({ outer: FRAME.tri(), detail: [] }),
  home: () => ({ outer: FRAME.house(), detail: [rect(-4, 1, 8, 11)] }),
  plane: () => ({
    outer: FRAME.circle(),
    detail: [poly([0, -8.5], [1.4, -6.5], [1.4, -2.5], [8, 1.5], [8, 3.2], [1.4, 1.2], [1.4, 5], [3.5, 7], [3.5, 8.3], [0, 7.3], [-3.5, 8.3], [-3.5, 7], [-1.4, 5], [-1.4, 1.2], [-8, 3.2], [-8, 1.5], [-1.4, -2.5], [-1.4, -6.5])],
  }),
  docks: () => ({
    outer: FRAME.circle(),
    detail: [rect(-1.1, -4.5, 2.2, 11), circ(0, -6.2, 2.4), hole(circ(0, -6.2, 1)), rect(-4.5, -2.8, 9, 1.8), sector(0, 0.5, 4.8, 6.8, 95, 265)],
  }),
  ley: () => ({ outer: FRAME.circle(), detail: [sector(0, 0, 4.6, 6.8, 0, 360, 32), circ(0, 0, 2.2)] }),
  info: () => ({ outer: FRAME.circle(), detail: [rect(-1.7, -2, 3.4, 9), rect(-1.7, -7.2, 3.4, 3.4)] }),
};

/** Half the icon width, for the default label gap. */
export const ICON_HALF = 12;

// ---------------------------------------------------------------------------
// Outline and the broken state

/** Outline width (centred on the body edge). */
export const OUTLINE = 2.5;

/**
 * Polygon offset by `dist` (outward for dist > 0) with mitred corners, capped
 * for sharp tips. Filled polygons run clockwise, so an edge (dx, dy) has the
 * outward normal (dy, -dx).
 */
export function offset(pts: Pt[], dist: number): Pt[] {
  const n = pts.length;
  const norm = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l];
  };
  return pts.map((p, i) => {
    const n1 = norm(pts[(i - 1 + n) % n], p);
    const n2 = norm(p, pts[(i + 1) % n]);
    const raw = dist / Math.max(1 + n1[0] * n2[0] + n1[1] * n2[1], 1e-6);
    const k = Math.sign(raw) * Math.min(Math.abs(raw), Math.abs(dist) * 3);
    return [r1(p[0] + (n1[0] + n2[0]) * k), r1(p[1] + (n1[1] + n2[1]) * k)];
  });
}

/**
 * The outline as a filled ring and the dark inside. Drawing the outline as a
 * shape (not a stroke) keeps the ends clean where the broken gap cuts it.
 */
export function body(icon: Icon): { ring: Poly[]; inside: Poly[] } {
  const w = OUTLINE / 2;
  return {
    ring: [shape(offset(icon.outer.p, w)), shape(offset(icon.outer.p, -w), true)],
    inside: [shape(offset(icon.outer.p, -w))],
  };
}

/** The strike line of a broken marker: bottom left to top right, rounded ends. */
export const SLASH = { reach: 10.5, half: 1.6, gap: 2.6 };

export function slash(): Poly {
  const { reach: e, half: t } = SLASH;
  const k = Math.SQRT1_2;
  const a: Pt = [-e, e];
  const b: Pt = [e, -e];
  const cap = (c: Pt, from: number) =>
    Array.from({ length: 9 }, (_, i) => [c[0] + t * Math.cos(from + (i / 8) * Math.PI), c[1] + t * Math.sin(from + (i / 8) * Math.PI)] as Pt);
  const normal = Math.atan2(k, k);
  return shape([...cap(b, normal + Math.PI), ...cap(a, normal)]);
}

/**
 * Cuts away a band around the strike line: every polygon is clipped to both
 * sides of the band (Sutherland-Hodgman against a half plane). Holes keep
 * their direction, so the nonzero fill still works.
 */
export function cutBand(polys: Poly[], half = SLASH.half + SLASH.gap): Poly[] {
  const dist = ([x, y]: Pt) => (x + y) * Math.SQRT1_2;
  const clip = (pts: Pt[], keep: (d: number) => number) => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const dp = keep(dist(p));
      const dq = keep(dist(q));
      if (dp >= 0) out.push(p);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        out.push([r1(p[0] + (q[0] - p[0]) * t), r1(p[1] + (q[1] - p[1]) * t)]);
      }
    }
    return out;
  };
  return polys.flatMap((s) =>
    [clip(s.p, (v) => -half - v), clip(s.p, (v) => v - half)].filter((p) => p.length > 2).map((p) => ({ p, hole: s.hole })),
  );
}
