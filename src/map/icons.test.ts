// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { body, cutBand, ICONS, offset, shape, slash, SLASH } from "./icons.ts";

const signedArea = (p: [number, number][]) => p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0) / 2;

test("fills run clockwise and holes anticlockwise", () => {
  for (const [id, make] of Object.entries(ICONS)) {
    const icon = make();
    for (const s of [icon.outer, ...icon.detail]) assert.equal(signedArea(s.p) > 0, !s.hole, id);
  }
});

test("the outline ring is the outer edge minus the inner edge", () => {
  const square = shape([[-10, -10], [10, -10], [10, 10], [-10, 10]]);
  assert.deepEqual(offset(square.p, 1), [[-11, -11], [11, -11], [11, 11], [-11, 11]]);
  const { ring, inside } = body({ outer: square, detail: [] });
  assert.equal(ring.length, 2);
  assert.ok(ring[1].hole);
  assert.deepEqual(inside[0].p, ring[1].p.slice().reverse());
});

test("the broken gap removes everything near the strike line", () => {
  const half = SLASH.half + SLASH.gap;
  for (const [id, make] of Object.entries(ICONS)) {
    const { ring, inside } = body(make());
    for (const piece of cutBand([...ring, ...inside])) {
      for (const [x, y] of piece.p) assert.ok(Math.abs((x + y) * Math.SQRT1_2) >= half - 0.15, `${id}: point in the gap`);
    }
  }
});

test("the strike line is a closed rounded bar from bottom left to top right", () => {
  const s = slash();
  const xs = s.p.map(([x]) => x);
  const ys = s.p.map(([, y]) => y);
  assert.ok(Math.min(...xs) < -SLASH.reach && Math.max(...xs) > SLASH.reach);
  assert.ok(Math.max(...ys) > SLASH.reach && Math.min(...ys) < -SLASH.reach);
  assert.ok(signedArea(s.p) > 0);
});
