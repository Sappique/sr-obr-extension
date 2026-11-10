import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCalendar, shiftToday, weekday } from "./format.ts";

test("today, note and runners", () => {
  const cal = parseCalendar("Today: 19.05.2077\nNote: Run-Tag 3\nRunner: Hawk #ff8a1f");
  assert.deepEqual(cal.today, { y: 2077, m: 5, d: 19 });
  assert.equal(cal.note, "Run-Tag 3");
  assert.deepEqual(cal.runners, [{ name: "Hawk", color: "#ff8a1f" }]);
  assert.equal(weekday(cal.today), 2); // Wednesday
});

test("events default to today's year, ranges expand, downtime finds the runner", () => {
  const cal = parseCalendar("Today: 19.05.2077\nRunner: Peppermint #a46cff\n16.04.-17.04. downtime Peppermint Reha\n24.05. deadline Ludis");
  assert.equal(cal.events.length, 3);
  assert.deepEqual(cal.events.map((e) => [e.d, e.m, e.y, e.type, e.who ?? "", e.title]), [
    [16, 4, 2077, "downtime", "Peppermint", "Reha"],
    [17, 4, 2077, "downtime", "Peppermint", "Reha"],
    [24, 5, 2077, "deadline", "", "Ludis"],
  ]);
  assert.deepEqual(cal.events[1].span, [1, 2]);
});

test("bad lines are reported, comments ignored", () => {
  const cal = parseCalendar("Today: 19.05.2077\n// note\n24.05. party Fest\nfoo");
  assert.equal(cal.events.length, 0);
  assert.equal(cal.errors.length, 2);
});

test("shiftToday crosses month ends and keeps the rest", () => {
  assert.equal(shiftToday("Today: 31.05.2077\nx", 1), "Today: 01.06.2077\nx");
  assert.equal(shiftToday("24.05. run X", 1).split("\n")[0].startsWith("Today:"), true);
});
