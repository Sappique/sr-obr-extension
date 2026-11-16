// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultAnchor, fanSlots, LONE_SLOT, moveAnchor, PIN } from "./fan.ts";

const unit = 1.5;

test("lone pins keep the plain head above their tip", () => {
  const slots = fanSlots([{ id: "a", x: 0, y: 0 }, { id: "b", x: 1000, y: 0 }], unit);
  assert.deepEqual(slots.get("a"), LONE_SLOT);
  assert.deepEqual(slots.get("b"), LONE_SLOT);
});

test("pins on one spot fan out side by side, ordered by x", () => {
  const slots = fanSlots(
    [
      { id: "c", x: 10, y: 0 },
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 5, y: 0 },
    ],
    unit,
  );
  const head = (id: string, x: number) => x / unit + slots.get(id)!.hx;
  const step = PIN.size + PIN.gap;
  assert.ok(Math.abs(head("b", 5) - head("a", 0) - step) < 0.2);
  assert.ok(Math.abs(head("c", 10) - head("b", 5) - step) < 0.2);
  // The middle head sits over the group's centre.
  assert.ok(Math.abs(head("b", 5) - 5 / unit) < 0.2);
});

test("heads line up above the topmost tip", () => {
  const slots = fanSlots([{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 20 }], unit);
  assert.equal(slots.get("a")!.top, LONE_SLOT.top);
  assert.equal(slots.get("b")!.top, Math.round((-20 / unit + LONE_SLOT.top) * 10) / 10);
});

test("groups chain: A near B near C share one fan", () => {
  const reach = (PIN.size + PIN.gap) * unit;
  const slots = fanSlots(
    [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: reach * 0.9, y: 0 },
      { id: "c", x: reach * 1.8, y: 0 },
    ],
    unit,
  );
  assert.notDeepEqual(slots.get("a"), LONE_SLOT);
  assert.notDeepEqual(slots.get("c"), LONE_SLOT);
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

test("a fan that would cover a nearby pin takes it in", () => {
  const reach = (PIN.size + PIN.gap) * unit;
  const slots = fanSlots(
    [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1, y: 0 },
      { id: "c", x: 2, y: 0 },
      { id: "d", x: reach * 1.5, y: 0 },
    ],
    unit,
  );
  assert.notDeepEqual(slots.get("d"), LONE_SLOT);
});
