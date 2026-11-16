// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSheet, normalCase, parseSheetText, toSheet, validateStructure, type Sheet } from "./schema.ts";

const sheet: Sheet = {
  v: 2,
  id: "hawk",
  handle: "Hawk",
  initials: "HK",
  color: "#ff8a1f",
  order: 1,
  nuyen: 1200,
  cond: { k: { text: "gebrochener Knöchel", state: "warn" }, p: { text: "unversehrt", state: "ok" } },
  meta: [["Name", "Eagon Shepherd"]],
  attributes: [{ die: 8, name: "Technik", skills: [{ die: 6, name: "Flugdrohnen", specializations: [{ die: 4, name: "Spionage" }] }] }],
  doc: "<!-- name -->\n## Drohnen\n- NeoNET Crawler\n",
};

test("formatted text parses back to the same sheet", () => {
  const r = parseSheetText(formatSheet(sheet));
  assert.ok("sheet" in r);
  assert.deepEqual(r.sheet, sheet);
});

test("formatting: fixed field order, short parts on one line, body last", () => {
  const text = formatSheet({ ...sheet, doc: "x\n" });
  const keys = [...text.matchAll(/^ {2}"(\w+)"/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ["v", "id", "handle", "initials", "color", "order", "nuyen", "cond", "meta", "attributes", "doc"]);
  assert.match(text, /\{"die":4,"name":"Spionage"\}/);
});

test("v1 sheets are upgraded: integer dice, specializations, normal-case attributes, doc from sections", () => {
  const v1 = {
    v: 1, id: "phlox", handle: "Phlox", initials: "PH", color: "#3fd87f", order: 0, nuyen: 5,
    cond: { k: { text: "", state: "ok" }, p: { text: "", state: "ok" } }, meta: [],
    attributes: [{ die: "D10", name: "TECHNIK", skills: [{ die: "D10", name: "Sprengstoff", specs: [{ die: "+D4", name: "Mehrstufig" }] }] }],
    sections: ["## Spruchzauber\n- Trugbild"],
  };
  const r = toSheet(v1);
  assert.ok("sheet" in r, "error" in r ? r.error : "");
  assert.equal(r.sheet.v, 2);
  assert.deepEqual(r.sheet.attributes, [{ die: 10, name: "Technik", skills: [{ die: 10, name: "Sprengstoff", specializations: [{ die: 4, name: "Mehrstufig" }] }] }]);
  assert.match(r.sheet.doc, /## Spruchzauber/);
  assert.ok(!("sections" in r.sheet));
});

test("hand-edit mistakes give readable errors", () => {
  const bad = (patch: object) => {
    const r = toSheet({ ...sheet, ...patch });
    return "error" in r ? r.error : "";
  };
  assert.match((parseSheetText("{ nope") as { error: string }).error, /^Invalid JSON/);
  assert.match(bad({ nuyen: "12" }), /nuyen/);
  assert.match(bad({ attributes: [{ die: 7, name: "X", skills: [] }] }), /Attribute "X".*4, 6, 8, 10, 12/);
  assert.match(bad({ attributes: [{ die: 6, name: "X", skills: [{ die: 6, name: "Y", specs: [] }] }] }), /Skill "Y".*specializations/);
  assert.match(bad({ cond: { k: { text: "", state: "bad" }, p: { text: "", state: "ok" } } }), /cond\.k/);
});

test("normal case only changes names written in capitals", () => {
  assert.equal(normalCase("PHYSISCH"), "Physisch");
  assert.equal(normalCase("Physisch"), "Physisch");
});

test("vr_ask is optional on attributes, skills and specialisations and must be a die size", () => {
  const sheet = (vr: Record<string, unknown>) => ({
    handle: "Hawk", initials: "HK", color: "#ff8a1f", meta: [],
    attributes: [{ die: 8, name: "Digital", ...vr.a as object, skills: [{ die: 6, name: "Hacken", ...vr.s as object, specializations: [{ die: 4, name: "Drohnen", ...vr.p as object }] }] }],
  });
  assert.equal(validateStructure(sheet({}), false), null);
  assert.equal(validateStructure(sheet({ a: { vr_ask: 8 }, s: { vr_ask: 6 }, p: { vr_ask: 12 } }), false), null);
  assert.match(validateStructure(sheet({ a: { vr_ask: 7 } }), false) ?? "", /Attribute "Digital": "vr_ask"/);
  assert.match(validateStructure(sheet({ s: { vr_ask: "8" } }), false) ?? "", /Skill "Hacken": "vr_ask"/);
  assert.match(validateStructure(sheet({ p: { vr_ask: 3 } }), false) ?? "", /Specialization "Drohnen": "vr_ask"/);
});
