// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { migratedKey } from "./migrateKey.ts";

test("earlier namespace keys move to the current one", () => {
  assert.equal(migratedKey("de.example.vtt/sheet-text"), "sappique.sr-obr/sheet-text");
  assert.equal(migratedKey("de.example.vtt/window"), "sappique.sr-obr/window");
});

test("current and foreign keys stay", () => {
  assert.equal(migratedKey("sappique.sr-obr/window"), null);
  assert.equal(migratedKey("rodeo.owlbear.other/thing"), null);
  assert.equal(migratedKey("com.battle-system.vtt"), null);
});
