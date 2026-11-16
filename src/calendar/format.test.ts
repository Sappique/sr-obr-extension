import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCalendar, parseToday, shiftDay, splitLine, weekday } from "./format.ts";

test("the current date is its own field and moves by days", () => {
  assert.deepEqual(parseToday("19.05.2077"), { y: 2077, m: 5, d: 19 });
  assert.equal(weekday(parseToday("19.05.2077")), 2); // Wednesday
  assert.equal(shiftDay("31.05.2077", 1), "01.06.2077");
  assert.equal(shiftDay("01.03.2077", -1), "28.02.2077");
  assert.deepEqual(parseToday("nonsense"), { y: 2077, m: 1, d: 1 });
});

test("csv lines: date, optional end date, title, optional type or colour", () => {
  const cal = parseCalendar("24.05., , Deadline Ludis, deadline\n16.04.2077, 17.04., Reha, #a46cff\n01.06.,,Miete", "19.05.2077");
  assert.deepEqual(cal.errors, []);
  assert.equal(cal.events.length, 4);
  assert.deepEqual(cal.events[0], { y: 2077, m: 5, d: 24, title: "Deadline Ludis", type: "deadline", color: undefined, span: undefined });
  assert.deepEqual(cal.events[1].span, [0, 2]);
  assert.equal(cal.events[2].color, "#a46cff");
  assert.equal(cal.events[3].title, "Miete");
  assert.equal(cal.events[3].type, undefined);
});

test("backslash escapes commas", () => {
  assert.deepEqual(splitLine("01.06., , Reha\\, Teil 2, run"), ["01.06.", "", "Reha, Teil 2", "run"]);
  assert.deepEqual(splitLine("a\\\\,b"), ["a\\", "b"]);
});

test("bad lines are reported, comments skipped; an unknown type keeps the entry", () => {
  const cal = parseCalendar("// comment\n32.05., , X\n01.05., 99.99., Y\n01.05., , Z, party", "19.05.2077");
  assert.equal(cal.errors.length, 3);
  assert.deepEqual(cal.events.map((e) => [e.title, e.type]), [["Z", undefined]]);
});
