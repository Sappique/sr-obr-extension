// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { boxLeft, groupSlots, groupTips, LONE_SLOT, moveAnchor, pickSpot, PIN, snapAnchor } from "./fan.ts";

const unit = 1.5;
const tip = (id: string, x: number, y: number, rank = id) => ({ id, x, y, rank });

test("pins closer than a head width form one group, in rank order", () => {
  const reach = (PIN.size + PIN.gap) * unit;
  const groups = groupTips([tip("c", 0, 0, "2"), tip("a", reach * 0.9, 0, "0"), tip("far", 1000, 0), tip("b", reach * 1.8, 0, "1")], unit);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find((g) => g.length === 3)!.map((t) => t.id), ["a", "b", "c"]);
});

test("a dropped pin snaps to where the others already stand", () => {
  const last = new Map([["a", { x: 0, y: 0 }], ["b", { x: 0, y: 0 }], ["c", { x: 500, y: 500 }]]);
  assert.deepEqual(pickSpot([tip("a", 0, 0), tip("b", 0, 0), tip("c", 12, 7)], last), { x: 0, y: 0 });
});

test("without history the most shared spot wins", () => {
  assert.deepEqual(pickSpot([tip("a", 5, 5), tip("b", 0, 0), tip("c", 0, 0)], new Map()), { x: 0, y: 0 });
});

test("a lone pin keeps the plain shape", () => {
  assert.deepEqual(groupSlots(1), [LONE_SLOT]);
});

const reachesSpot = (outline: [number, number][]) => outline.some(([x, y]) => x === 0 && y === 0);

test("a group is one column that points at the spot, heads apart", () => {
  for (const n of [2, 3, 4, 6]) {
    const slots = groupSlots(n);
    assert.equal(slots.length, n);
    // Only the bottom segment carries the pointer.
    assert.deepEqual(slots.map((s) => reachesSpot(s.outline)), slots.map((_, i) => i === n - 1));
    // Segments are stacked edge to edge, top to bottom in group order.
    for (let i = 1; i < n; i++) assert.equal(slots[i].top, slots[i - 1].top + slots[i - 1].h, `${n}: segment ${i}`);
  }
});

test("changing alignment keeps the plate's left edge", () => {
  const symbol = { x: 100, y: 100 };
  const anchor = snapAnchor(symbol, "left", 20, 12, 7);
  const moved = moveAnchor(anchor, symbol, { unit, align: "left", width: 80 }, { unit, align: "right", width: 80 });
  assert.deepEqual(moved, { x: anchor.x + 80, y: anchor.y });
});

test("a new marker size scales the label offset around the symbol", () => {
  const symbol = { x: 0, y: 0 };
  const moved = moveAnchor({ x: 30, y: -10 }, symbol, { unit: 1, align: "left", width: 50 }, { unit: 2, align: "left", width: 100 });
  assert.deepEqual(moved, { x: 60, y: -20 });
});

test("snapping puts the aligned edge next to the icon, centred labels below it", () => {
  const icon = { x: 100, y: 50 };
  const [half, gap, width, height] = [12, 7, 80, 20];
  const left = snapAnchor(icon, "left", height, half, gap);
  assert.equal(left.x + boxLeft("left", width), 119);
  const right = snapAnchor(icon, "right", height, half, gap);
  assert.equal(right.x + boxLeft("right", width) + width, 81);
  assert.deepEqual(snapAnchor(icon, "bottom", height, half, gap), { x: 100, y: 50 + 12 + 7 + 10 });
  assert.deepEqual(snapAnchor(icon, "top", height, half, gap), { x: 100, y: 50 - 12 - 7 - 10 });
});
