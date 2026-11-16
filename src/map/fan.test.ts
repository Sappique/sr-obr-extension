// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultAnchor, GROUP_STYLES, groupSlots, groupTips, LONE_SLOT, moveAnchor, pickSpot, PIN } from "./fan.ts";

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
  for (const { id } of GROUP_STYLES) assert.deepEqual(groupSlots(1, id), [LONE_SLOT]);
});

const reachesSpot = (outline: [number, number][]) => outline.some(([x, y]) => x === 0 && y === 0);

test("every group style points at the spot and keeps heads apart", () => {
  for (const { id } of GROUP_STYLES) {
    for (const n of [2, 3, 4, 6]) {
      const slots = groupSlots(n, id);
      assert.equal(slots.length, n);
      assert.ok(slots.some((s) => reachesSpot(s.outline)), `${id} ${n}: no pointer`);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = Math.abs(slots[i].hx - slots[j].hx);
          const dy = Math.abs(slots[i].top - slots[j].top);
          assert.ok(dx >= PIN.size - 0.5 || dy >= PIN.size - 0.5, `${id} ${n}: heads ${i} and ${j} overlap`);
        }
      }
    }
  }
});

test("changing alignment keeps the plate's left edge", () => {
  const symbol = { x: 100, y: 100 };
  const anchor = defaultAnchor(symbol, "left", 80, unit);
  const moved = moveAnchor(anchor, symbol, { unit, align: "left", width: 80 }, { unit, align: "right", width: 80 });
  assert.deepEqual(moved, { x: anchor.x + 80, y: anchor.y });
});

test("a new marker size scales the label offset around the symbol", () => {
  const symbol = { x: 0, y: 0 };
  const moved = moveAnchor({ x: 30, y: -10 }, symbol, { unit: 1, align: "left", width: 50 }, { unit: 2, align: "left", width: 100 });
  assert.deepEqual(moved, { x: 60, y: -20 });
});
