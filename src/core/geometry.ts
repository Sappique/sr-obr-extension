/** Path commands use the same numeric codes as the OBR SDK's Command enum. */
export type Cmd = number[];
export const MOVE = 0;
export const LINE = 1;
export const QUAD = 2;
export const CUBIC = 4;
export const CLOSE = 5;

export type Pt = [number, number];
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Hexagon with cut corners at the top right and bottom left. */
export function windowOutline(w: number, h: number, cut: number): Pt[] {
  const c = Math.min(cut, h / 2, w / 2);
  return [
    [0, 0],
    [w - c, 0],
    [w, c],
    [w, h],
    [c, h],
    [0, h - c],
  ];
}

export function polygon(points: Pt[]): Cmd[] {
  const out: Cmd[] = points.map(([x, y], i) => [i === 0 ? MOVE : LINE, x, y]);
  out.push([CLOSE]);
  return out;
}

export function rect(x: number, y: number, w: number, h: number): Cmd[] {
  return polygon([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);
}

/** A hollow rectangle (inner contour wound the other way, for nonzero fill). */
export function rectRing(x: number, y: number, w: number, h: number, t: number): Cmd[] {
  return [
    ...rect(x, y, w, h),
    ...polygon([
      [x + t, y + t],
      [x + t, y + h - t],
      [x + w - t, y + h - t],
      [x + w - t, y + t],
    ]),
  ];
}

export function diamondPoints(cx: number, cy: number, r: number): Pt[] {
  return [
    [cx, cy - r],
    [cx + r, cy],
    [cx, cy + r],
    [cx - r, cy],
  ];
}

export function diamond(cx: number, cy: number, r: number): Cmd[] {
  return polygon(diamondPoints(cx, cy, r));
}

export function diamondRing(cx: number, cy: number, r: number, t: number): Cmd[] {
  return [...diamond(cx, cy, r), ...polygon(diamondPoints(cx, cy, r - t * Math.SQRT2).reverse())];
}

/** Sutherland-Hodgman clip to the half plane f(p) <= 0, f linear. */
export function clipHalfPlane(points: Pt[], f: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    const fp = f(p);
    const fq = f(q);
    if (fp <= 0) out.push(p);
    if (fp < 0 !== fq < 0 && fp !== fq) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  });
  return out;
}

/** 45 degree stripes clipped to a convex polygon, as in repeating-linear-gradient(45deg). */
export function hatch(outline: Pt[], stripe: number, period: number): Cmd[] {
  const along = ([x, y]: Pt) => (x - y) * Math.SQRT1_2;
  const values = outline.map(along);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const out: Cmd[] = [];
  for (let k = Math.floor(min / period); k * period < max; k++) {
    const a = k * period;
    const b = a + stripe;
    let band = clipHalfPlane(outline, (p) => a - along(p));
    band = clipHalfPlane(band, (p) => along(p) - b);
    // The bottom-left cut runs parallel to the stripes and can leave a hairline.
    const extent = band.map(along);
    if (band.length >= 3 && Math.max(...extent) - Math.min(...extent) > stripe / 2) {
      out.push(...polygon(band));
    }
  }
  return out;
}

export function outlineMatches(points: { x: number; y: number }[], expected: Pt[]): boolean {
  return (
    points.length === expected.length &&
    points.every((p, i) => Math.abs(p.x - expected[i][0]) < 0.5 && Math.abs(p.y - expected[i][1]) < 0.5)
  );
}

// ---------------------------------------------------------------------------
// Connectors: org-chart routing with one shared trunk per window side.

export interface LinkBoxes {
  a: Box;
  b: Box;
}

type Side = "right" | "left" | "bottom" | "top";

/** Orders a pair: `first` leaves by its right/bottom side, `second` enters left/top. */
function classify({ a, b }: LinkBoxes) {
  if (a.x + a.w < b.x) return { first: a, second: b, horizontal: true };
  if (b.x + b.w < a.x) return { first: b, second: a, horizontal: true };
  const [first, second] = a.y <= b.y ? [a, b] : [b, a];
  return { first, second, horizontal: false };
}

function portOf(box: Box, side: Side, sideOffset: number): Pt {
  const y = box.y + Math.min(sideOffset, box.h / 2);
  const x = box.x + box.w * 0.75;
  if (side === "right") return [box.x + box.w, y];
  if (side === "left") return [box.x, y];
  return side === "bottom" ? [x, box.y + box.h] : [x, box.y];
}

export interface RouteOptions {
  trunkOffset: number;
  sideOffset: number;
  /** Free space kept around every window. */
  clearance: number;
  /** The shadow falls this far to the left and down. */
  shadow: number;
  bendCost: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function inflate(box: Box, o: RouteOptions): Rect {
  return {
    x0: r1(box.x - o.shadow - o.clearance),
    y0: r1(box.y - o.clearance),
    x1: r1(box.x + box.w + o.clearance),
    y1: r1(box.y + box.h + o.shadow + o.clearance),
  };
}

/** How far a line must leave a side to clear that window's own shadow and margin. */
function clearDistance(side: Side, o: RouteOptions): number {
  return o.clearance + (side === "left" || side === "bottom" ? o.shadow : 0);
}

const OUTWARD: Record<Side, number> = { right: 0, left: 1, bottom: 2, top: 3 };
const STEP = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const TRUNK_DISCOUNT = 0.6;
const CLEARANCE_RETRIES = [1, 0.25];

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Minimal binary heap ordered by cost, then state, so ties resolve the same everywhere. */
class Heap {
  private items: [number, number][] = [];
  private static less(a: [number, number], b: [number, number]) {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }
  get size() {
    return this.items.length;
  }
  push(item: [number, number]) {
    const h = this.items;
    h.push(item);
    for (let i = h.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!Heap.less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  pop(): [number, number] {
    const h = this.items;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const n = l + 1;
        let m = i;
        if (l < h.length && Heap.less(h[l], h[m])) m = l;
        if (n < h.length && Heap.less(h[n], h[m])) m = n;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

interface Trunk {
  vertical: boolean;
  at: number;
}

/** Right-angle shortest path over a grid of obstacle edges; null if there is none. */
function searchPath(
  start: Pt, startDir: number, end: Pt, endDir: number,
  rects: Rect[], trunk: Trunk, bendCost: number,
): Pt[] | null {
  const xs = sortedUnique([start[0], end[0], ...rects.flatMap((q) => [q.x0, q.x1]), ...(trunk.vertical ? [trunk.at] : [])]);
  const ys = sortedUnique([start[1], end[1], ...rects.flatMap((q) => [q.y0, q.y1]), ...(trunk.vertical ? [] : [trunk.at])]);
  const nx = xs.length;
  const ny = ys.length;
  const cell = (i: number, j: number) => i + j * nx;
  // blocked[0]: edge from (i,j) to (i+1,j); blocked[1]: edge from (i,j) to (i,j+1).
  const blocked = [new Uint8Array(nx * ny), new Uint8Array(nx * ny)];
  for (const q of rects) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (i + 1 < nx && ys[j] > q.y0 && ys[j] < q.y1 && xs[i] >= q.x0 && xs[i + 1] <= q.x1) blocked[0][cell(i, j)] = 1;
        if (j + 1 < ny && xs[i] > q.x0 && xs[i] < q.x1 && ys[j] >= q.y0 && ys[j + 1] <= q.y1) blocked[1][cell(i, j)] = 1;
      }
    }
  }
  const si = xs.indexOf(start[0]);
  const sj = ys.indexOf(start[1]);
  const ei = xs.indexOf(end[0]);
  const ej = ys.indexOf(end[1]);
  const states = nx * ny * 4;
  const dist = new Float64Array(states).fill(Infinity);
  const prev = new Int32Array(states).fill(-1);
  const startState = cell(si, sj) * 4 + startDir;
  dist[startState] = 0;
  const heap = new Heap();
  heap.push([0, startState]);

  while (heap.size) {
    const [cost, state] = heap.pop();
    if (cost > dist[state]) continue;
    const dir = state % 4;
    const c = (state - dir) / 4;
    const i = c % nx;
    const j = (c - i) / nx;
    for (let d = 0; d < 4; d++) {
      const ni = i + STEP[d][0];
      const nj = j + STEP[d][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const horizontal = d < 2;
      const edge = horizontal ? cell(Math.min(i, ni), j) : cell(i, Math.min(j, nj));
      if (blocked[horizontal ? 0 : 1][edge]) continue;
      let length = horizontal ? Math.abs(xs[ni] - xs[i]) : Math.abs(ys[nj] - ys[j]);
      if (horizontal !== trunk.vertical && (horizontal ? ys[j] : xs[i]) === trunk.at) length *= TRUNK_DISCOUNT;
      const next = cell(ni, nj) * 4 + d;
      const total = cost + length + (d === dir ? 0 : bendCost);
      if (total < dist[next]) {
        dist[next] = total;
        prev[next] = state;
        heap.push([total, next]);
      }
    }
  }

  let best = -1;
  let bestCost = Infinity;
  for (let d = 0; d < 4; d++) {
    const state = cell(ei, ej) * 4 + d;
    const total = dist[state] + (d === endDir ? 0 : bendCost);
    if (total < bestCost) {
      bestCost = total;
      best = state;
    }
  }
  if (best < 0) return null;
  const cells: Pt[] = [];
  for (let state = best; state >= 0; state = prev[state]) {
    const c = (state - (state % 4)) / 4;
    const i = c % nx;
    const pt: Pt = [xs[i], ys[(c - i) / nx]];
    const last = cells[cells.length - 1];
    if (!last || last[0] !== pt[0] || last[1] !== pt[1]) cells.push(pt);
  }
  return cells.reverse();
}

function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (b && b[0] === p[0] && b[1] === p[1]) continue;
    if (a && b && ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

const lineIsFree = (trunk: Trunk, from: number, to: number, rects: Rect[]) =>
  !rects.some((q) =>
    trunk.vertical
      ? trunk.at > q.x0 && trunk.at < q.x1 && Math.max(from, to) > q.y0 && Math.min(from, to) < q.y1
      : trunk.at > q.y0 && trunk.at < q.y1 && Math.max(from, to) > q.x0 && Math.min(from, to) < q.x1,
  );

/**
 * One polyline per link, in the given order. Each window side has one port
 * and one trunk; links run around the obstacle windows and fall back to the
 * direct route when no way around exists. Deterministic for equal input.
 */
export function routeLinks(links: LinkBoxes[], obstacles: Box[], o: RouteOptions): Pt[][] {
  const rects = obstacles.map((box) => inflate(box, o));
  type Stat = { count: number; gap: number; low: number; high: number; trunk?: number };
  const stats = new Map<Box, Partial<Record<Side, Stat>>>();
  const statOf = (box: Box, side: Side): Stat => {
    const sides = stats.get(box) ?? {};
    stats.set(box, sides);
    return (sides[side] ??= { count: 0, gap: Infinity, low: Infinity, high: -Infinity });
  };

  const pairs = links.map((link) => {
    const { first, second, horizontal } = classify(link);
    const sides: [Side, Side] = horizontal ? ["right", "left"] : ["bottom", "top"];
    const gap = Math.max(
      0,
      horizontal ? second.x - (first.x + first.w) : second.y - (first.y + first.h),
    );
    const p = portOf(first, sides[0], o.sideOffset);
    const q = portOf(second, sides[1], o.sideOffset);
    for (const [box, side] of [[first, sides[0]], [second, sides[1]]] as [Box, Side][]) {
      const stat = statOf(box, side);
      stat.count++;
      stat.gap = Math.min(stat.gap, gap);
    }
    return { first, second, horizontal, sides, p, q };
  });

  const anchored = pairs.map((pair) => {
    const fs = statOf(pair.first, pair.sides[0]);
    const ss = statOf(pair.second, pair.sides[1]);
    // The trunk belongs to the busier end; on a tie, the left window.
    const anchorFirst = fs.count > ss.count || (fs.count === ss.count && pair.first.x <= pair.second.x);
    const stat = anchorFirst ? fs : ss;
    const cross = pair.horizontal ? 1 : 0;
    for (const v of [pair.p[cross], pair.q[cross]]) {
      stat.low = Math.min(stat.low, v);
      stat.high = Math.max(stat.high, v);
    }
    return { ...pair, anchorFirst, stat };
  });

  /** A trunk position in free space: the default distance, or further out. */
  const trunkAt = (a: (typeof anchored)[number]): number => {
    if (a.stat.trunk !== undefined) return a.stat.trunk;
    const side = a.anchorFirst ? a.sides[0] : a.sides[1];
    const port = a.anchorFirst ? a.p : a.q;
    const along = port[a.horizontal ? 0 : 1];
    const sign = side === "right" || side === "bottom" ? 1 : -1;
    const min = clearDistance(side, o);
    const first = Math.max(min, Math.min(o.trunkOffset, a.stat.gap / 2));
    const limit = Math.max(first, a.stat.gap);
    let chosen = r1(along + sign * first);
    for (let d = first; d <= limit; d += o.clearance) {
      const at = r1(along + sign * d);
      if (lineIsFree({ vertical: a.horizontal, at }, a.stat.low, a.stat.high, rects)) {
        chosen = at;
        break;
      }
    }
    a.stat.trunk = chosen;
    return chosen;
  };

  return anchored.map((a) => {
    const at = trunkAt(a);
    const { p, q, sides, horizontal } = a;
    const direct: Pt[] = horizontal ? [p, [at, p[1]], [at, q[1]], q] : [p, [p[0], at], [q[0], at], q];
    // Windows close together leave no room for the full margin: retry tighter.
    let path: Pt[] | null = null;
    for (const factor of CLEARANCE_RETRIES) {
      const tight = { ...o, clearance: o.clearance * factor };
      const stub = (port: Pt, side: Side): Pt => {
        const d = clearDistance(side, tight);
        const [dx, dy] = STEP[OUTWARD[side]];
        return [r1(port[0] + dx * d), r1(port[1] + dy * d)];
      };
      path = searchPath(
        stub(p, sides[0]), OUTWARD[sides[0]],
        stub(q, sides[1]), OUTWARD[sides[0]],
        obstacles.map((box) => inflate(box, tight)),
        { vertical: horizontal, at }, o.bendCost,
      );
      if (path) break;
    }
    const points = simplify(path ? [p, ...path, q] : direct);
    // Routes run outward from their hub; flow direction depends on this.
    return a.anchorFirst ? points : points.reverse();
  });
}

/**
 * Draws routes with every shared stretch exactly once: collinear pieces are
 * merged, so overlapping lines keep a single, regular dash pattern.
 */
export function drawRoutes(routes: Pt[][]): { line: Cmd[]; ports: Pt[] } {
  const r = (n: number) => Math.round(n * 10) / 10;
  const horizontal = new Map<number, [number, number][]>();
  const vertical = new Map<number, [number, number][]>();
  const put = (map: Map<number, [number, number][]>, key: number, a: number, b: number) => {
    if (a === b) return;
    map.set(key, [...(map.get(key) ?? []), [Math.min(a, b), Math.max(a, b)]]);
  };
  const ports = new Map<string, Pt>();
  for (const pts of routes) {
    for (const end of [pts[0], pts[pts.length - 1]]) {
      const port: Pt = [r(end[0]), r(end[1])];
      ports.set(port.join(), port);
    }
    pts.slice(1).forEach((q, i) => {
      const p = pts[i];
      if (r(p[1]) === r(q[1])) put(horizontal, r(p[1]), r(p[0]), r(q[0]));
      else put(vertical, r(p[0]), r(p[1]), r(q[1]));
    });
  }
  const line: Cmd[] = [];
  const emit = (map: Map<number, [number, number][]>, at: (fixed: number, v: number) => Pt) => {
    for (const fixed of [...map.keys()].sort((a, b) => a - b)) {
      const spans = map.get(fixed)!.sort((a, b) => a[0] - b[0]);
      let [start, end] = spans[0];
      const flush = () => line.push([MOVE, ...at(fixed, start)], [LINE, ...at(fixed, end)]);
      for (const [a, b] of spans.slice(1)) {
        if (a <= end) end = Math.max(end, b);
        else {
          flush();
          [start, end] = [a, b];
        }
      }
      flush();
    }
  };
  emit(horizontal, (y, x) => [x, y]);
  emit(vertical, (x, y) => [x, y]);
  return { line, ports: [...ports.values()] };
}

export interface FlowSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Distance along the route at (x0, y0), so dashes continue around corners. */
  phase: number;
}

/**
 * Non-overlapping straight segments for animated lines, each running outward
 * from its hub. Where routes share a stretch, the first route owns it.
 */
export function flowSegments(routes: Pt[][]): FlowSegment[] {
  const claimed = new Map<string, [number, number][]>();
  const out: FlowSegment[] = [];
  for (const pts of routes) {
    let distance = 0;
    pts.slice(1).forEach((end, i) => {
      const start = pts[i];
      const horizontal = r1(start[1]) === r1(end[1]);
      const axis = horizontal ? 0 : 1;
      const a = r1(start[axis]);
      const b = r1(end[axis]);
      const fixed = r1(start[1 - axis]);
      const key = `${axis}:${fixed}`;
      const taken = (claimed.get(key) ?? []).sort((p, q) => p[0] - q[0]);
      const forward = b >= a;
      const free: [number, number][] = [];
      let cursor = Math.min(a, b);
      const high = Math.max(a, b);
      for (const [lo, hi] of taken) {
        if (hi <= cursor || lo >= high) continue;
        if (lo > cursor) free.push([cursor, lo]);
        cursor = Math.max(cursor, hi);
      }
      if (cursor < high) free.push([cursor, high]);
      for (const [lo, hi] of free) {
        if (hi - lo < 0.05) continue;
        const from = forward ? lo : hi;
        const to = forward ? hi : lo;
        const phase = r1(distance + Math.abs(from - a));
        out.push(
          horizontal
            ? { x0: from, y0: fixed, x1: to, y1: fixed, phase }
            : { x0: fixed, y0: from, x1: fixed, y1: to, phase },
        );
        taken.push([lo, hi]);
      }
      claimed.set(key, taken);
      distance += Math.abs(b - a);
    });
  }
  return out;
}
