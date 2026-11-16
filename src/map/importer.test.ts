// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocations } from "./importer.ts";

test("JSON entries become location specs", () => {
  const { entries, errors } = parseLocations(JSON.stringify([
    { name: "Harrow Ost", kind: "home", sheet: "Hawk" },
    { name: "Bloody Mary", kind: "club", align: "right" },
    { name: "Zero Day" },
    { name: "Quarantäne", kind: "danger", broken: true, color: "#ff0000" },
  ]));
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[0], { spec: { type: "place", name: "Harrow Ost", kind: "home", align: "left" }, sheet: "Hawk" });
  assert.equal(entries[1].spec.align, "right");
  assert.equal(entries[2].spec.kind, "place");
  assert.equal(entries[3].spec.broken, true);
  assert.equal(entries[3].spec.color, "#ff0000");
});

test("aliases and an object wrapper work; bad entries are reported, good ones kept", () => {
  const { entries, errors } = parseLocations(JSON.stringify({ locations: [{ name: "P. Ivan", kind: "contact" }, { kind: "corp" }, { name: "X", kind: "spaceport" }] }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].spec.kind, "person");
  assert.equal(errors.length, 2);
});

test("plain text: 'kind: name' or just a name, '|' breaks the line", () => {
  const { entries, errors } = parseLocations("corp: Echo Motors\nThe Needle\n# a comment\nhome: Harrow | Zentrum\nTime: 12:00");
  assert.deepEqual(errors, []);
  assert.deepEqual(entries.map((e) => [e.spec.kind, e.spec.name]), [
    ["corp", "Echo Motors"], ["place", "The Needle"], ["home", "Harrow\nZentrum"], ["place", "Time: 12:00"],
  ]);
});

test("invalid JSON says so", () => {
  assert.match(parseLocations("[{").errors[0], /Not valid JSON/);
});
