// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { docFromSections, parseDoc, plainLifestyle } from "./doc.ts";

const ALL = { name: true, skills: true, nuyen: true };
const kinds = (cols: ReturnType<typeof parseDoc>) => cols.map((c) => c.map((b) => (b.kind === "md" ? `md:${b.src.split("\n")[0]}` : b.kind)));

test("column markers split columns, placeholders place parts", () => {
  const doc = "<!-- name -->\n<!-- skills -->\n<!-- column -->\n## A\n- x\n<!-- column -->\n## B\ntext\n<!-- nuyen -->";
  assert.deepEqual(kinds(parseDoc(doc, ALL)), [["name", "skills"], ["md:## A"], ["md:## B", "nuyen"]]);
});

test("markers are case- and space-insensitive; other comments are ignored", () => {
  const doc = "## A\n<!--COLUMN-->\n<!--  Nuyen  -->\n<!-- note to self -->\n## B";
  assert.deepEqual(kinds(parseDoc(doc, ALL)), [["name", "skills", "md:## A"], ["nuyen", "md:## B"]]);
});

test("missing parts go to default spots", () => {
  assert.deepEqual(kinds(parseDoc("## A\n<!-- column -->\n## B", ALL)), [["name", "skills", "md:## A"], ["md:## B", "nuyen"]]);
  assert.deepEqual(kinds(parseDoc("", ALL)), [["name", "skills", "nuyen"]]);
});

test("explicitly placed skills keep their spot; a missing name still leads the first column", () => {
  assert.deepEqual(kinds(parseDoc("## A\n<!-- column -->\n<!-- skills -->", ALL)), [["name", "md:## A"], ["skills", "nuyen"]]);
});

test("repeated placeholders count once; parts a sheet lacks are dropped", () => {
  const shared = { name: false, skills: false, nuyen: true };
  assert.deepEqual(kinds(parseDoc("<!-- nuyen -->\n## A\n<!-- nuyen -->\n<!-- skills -->", shared)), [["nuyen", "md:## A"]]);
});

test("Lebensstil callout becomes a plain list", () => {
  const src = "## Lebensstil\n> [!Wohnort] Harrow Ost, kleine Wohnung\n> Ausgaben **50 ¥ / Tag** · Miete **3.000 ¥ / Monat**";
  assert.equal(
    plainLifestyle(src),
    "## Lebensstil\n- **Wohnort:** Harrow Ost, kleine Wohnung\n- **Ausgaben:** 50 ¥ / Tag\n- **Miete:** 3.000 ¥ / Monat",
  );
  assert.equal(plainLifestyle("## Kontakte\n> [!Note] x"), "## Kontakte\n> [!Note] x");
});

test("migration reproduces the old layout", () => {
  const doc = docFromSections(["## Bodytech\n- a", "## Drohnen\n- b", "## Ausrüstung\n- c"], false);
  const parsed = parseDoc(doc, ALL);
  // Sections without a marker between them form one Markdown block.
  assert.deepEqual(kinds(parsed), [["name", "skills"], ["md:## Bodytech", "nuyen"], ["md:## Drohnen"]]);
  const mid = parsed[1][0];
  assert.ok(mid.kind === "md" && mid.src.includes("## Ausrüstung\n- c"));
  const shared = docFromSections(["## Kontakte\n- a"], true);
  assert.deepEqual(kinds(parseDoc(shared, { name: false, skills: false, nuyen: true })), [["md:## Kontakte", "nuyen"]]);
});
