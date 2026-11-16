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

test("csv lines: date, optional end date, title, optional colour and style", () => {
  const cal = parseCalendar("24.05., , Deadline Ludis, red\n16.04.2077, 17.04., Reha, Peppermint, line\n01.06.,,Miete\n02.06., , X, #abc, outline", "19.05.2077", { Peppermint: "#a46cff" });
  assert.deepEqual(cal.errors, []);
  assert.equal(cal.events.length, 5);
  assert.deepEqual(cal.events[0], { y: 2077, m: 5, d: 24, title: "Deadline Ludis", color: "#ff2848", style: "box", past: false, span: undefined, entry: 0 });
  assert.deepEqual(cal.events[1].span, [0, 2]);
  assert.equal(cal.events[2].color, "#a46cff");
  assert.equal(cal.events[2].style, "line");
  assert.equal(cal.events[3].color, "#f5e10a"); // default yellow
  assert.equal(cal.events[4].color, "#aabbcc");
  assert.equal(cal.events[4].style, "outline");
});

test("colour names: palette first, then CSS; runner names any case", () => {
  const cal = parseCalendar("01.06., , A, yellow\n01.06., , B, CornflowerBlue\n01.06., , C, hawk", "19.05.2077", { Hawk: "#ff8a1f" });
  assert.deepEqual(cal.events.map((e) => e.color), ["#f5e10a", "#6495ed", "#ff8a1f"]);
});

test("an entry is past only when all its days are before the current date", () => {
  const cal = parseCalendar("17.05., 18.05., Done\n18.05., 19.05., Ends today\n18.05., , Yesterday", "19.05.2077");
  assert.deepEqual(cal.events.map((e) => e.past), [true, true, false, false, true]);
});

test("backslash escapes commas", () => {
  assert.deepEqual(splitLine("01.06., , Reha\\, Teil 2, run"), ["01.06.", "", "Reha, Teil 2", "run"]);
  assert.deepEqual(splitLine("a\\\\,b"), ["a\\", "b"]);
});

test("bad lines are reported, comments skipped; an unknown colour keeps the entry", () => {
  const cal = parseCalendar("// comment\n32.05., , X\n01.05., 99.99., Y\n01.05., , Z, party", "19.05.2077");
  assert.equal(cal.errors.length, 3);
  assert.deepEqual(cal.events.map((e) => [e.title, e.color]), [["Z", "#f5e10a"]]);
});
