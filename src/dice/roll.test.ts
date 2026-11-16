// Run with: npm test   (node's built-in test runner, TypeScript via type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, makeRoll, rollDie, isRollMessage } from "./roll.ts";

const d = (size: number, value: number) => ({ size, value });

test("single die is its value", () => {
  assert.deepEqual(evaluate([d(8, 5)]), { base: 0, bonus: [], total: 5 });
  assert.equal(evaluate([d(6, 6)]).total, 6); // base never adds +1 for itself
});

test("highest die wins, no bonus without max faces", () => {
  assert.equal(evaluate([d(6, 3), d(8, 7)]).total, 7);
  assert.equal(evaluate([d(10, 2), d(6, 5), d(4, 3)]).total, 5);
});

test("other dice on their max face add +1", () => {
  assert.deepEqual(evaluate([d(8, 7), d(4, 4)]), { base: 0, bonus: [1], total: 8 });
  assert.equal(evaluate([d(12, 9), d(6, 6), d(4, 4)]).total, 11);
});

test("ties: base is the die NOT on its max face", () => {
  // d4=4, d6=4 → base d6 (4), d4 maxed → +1 = 5
  assert.deepEqual(evaluate([d(4, 4), d(6, 4)]), { base: 1, bonus: [0], total: 5 });
  assert.deepEqual(evaluate([d(6, 4), d(4, 4)]), { base: 0, bonus: [1], total: 5 });
  // d6=6, d8=6 → base d8, d6 maxed → 7
  assert.equal(evaluate([d(6, 6), d(8, 6)]).total, 7);
});

test("all tied dice maxed: one is base, the others add +1", () => {
  assert.equal(evaluate([d(6, 6), d(6, 6)]).total, 7);
  assert.equal(evaluate([d(6, 6), d(6, 6), d(6, 6)]).total, 8);
});

test("rollDie stays in range", () => {
  for (const size of [4, 6, 8, 10, 12]) {
    assert.equal(rollDie(size, () => 0), 1);
    assert.equal(rollDie(size, () => 0.999999), size);
  }
});

test("makeRoll produces a valid message", () => {
  const m = makeRoll("Hawk · GESCHICK", "#ff8a1f", [8, 6, 4]);
  assert.ok(isRollMessage(m));
  assert.equal(m.dice.length, 3);
  assert.ok(JSON.stringify(m).length < 400);
  assert.ok(!isRollMessage({ ...m, dice: [{ size: 7, value: 3 }] }));
  const n = makeRoll("Hawk · TECHNIK + Flugdrohnen", "#ff8a1f", [8, 6], Math.random, { initials: "HK", names: ["TECHNIK", "Flugdrohnen"] });
  assert.ok(isRollMessage(n));
  assert.equal(n.initials, "HK");
  assert.ok(!isRollMessage({ ...n, names: ["TECHNIK"] })); // one name per die
});

test("bonus dice ride along and are counted", () => {
  const msg = makeRoll("Hawk · AGI + Bonus", "#ff8a1f", [8, 6, 10], Math.random, { names: ["AGI", "Schleichen", "VR Bonus"], bonus: 1 });
  assert.equal(msg.bonus, 1);
  assert.ok(isRollMessage(msg));
  assert.ok(!isRollMessage({ ...msg, bonus: 4 }));
  assert.ok(isRollMessage(makeRoll("x", "#fff", Array(12).fill(6))));
  assert.ok(!isRollMessage(makeRoll("x", "#fff", Array(13).fill(6))));
});
