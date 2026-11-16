import OBR, { Item } from "@owlbear-rodeo/sdk";
import { loadFonts } from "../core/fonts";
import { toEntries } from "../sheets/backend";
import { buildLocation, readUnits } from "./create";
import { parseLocations } from "./importer";
import { labelLines } from "./layout";
import { CrewInfo, IMPORT_MODAL_ID, isMapBase, PLACE_KINDS } from "./model";

/** Modal: paste JSON or text, add the locations below each other in the view's centre. */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const text = $<HTMLTextAreaElement>("text");
const status = $("status");
const add = $<HTMLButtonElement>("add");
$("kinds").textContent = PLACE_KINDS.map((k) => k.id).join(", ");

function say(message: string, error = false) {
  status.textContent = message;
  status.classList.toggle("err", error);
}

async function run() {
  const { entries, errors } = parseLocations(text.value);
  if (!entries.length) {
    say(errors.join("\n") || "Nothing to add.", true);
    return;
  }
  add.disabled = true;
  try {
    const [fonts, units, items, vw, vh] = await Promise.all([
      loadFonts(), readUnits(), OBR.scene.items.getItems(), OBR.viewport.getWidth(), OBR.viewport.getHeight(),
    ]);
    const sheets = toEntries(items).filter((e) => !e.error);
    const crew = new Map<string, CrewInfo>(
      sheets.map((e) => [e.itemId, { handle: e.sheet.handle, initials: e.sheet.initials, color: e.sheet.color, order: e.sheet.order }]),
    );
    const byHandle = new Map(sheets.map((e) => [e.sheet.handle.toLowerCase(), e.itemId]));
    const notes = [...errors];

    // A column in the middle of the view, one row per location (taller rows for multi-line names).
    const rowOf = (name: string) => Math.max(30 * units.icon, (labelLines(name).length * 19 + 8) * units.label);
    const total = entries.reduce((s, e) => s + rowOf(e.spec.name), 0);
    const centre = await OBR.viewport.inverseTransformPoint({ x: vw / 2, y: vh / 2 });
    let y = centre.y - total / 2;
    const out: Item[] = [];
    for (const { spec, sheet } of entries) {
      if (sheet) {
        const id = byHandle.get(sheet.toLowerCase());
        if (id) spec.colorSheet = id;
        else notes.push(`${spec.name.split("\n")[0]}: no crew sheet "${sheet}", kept the kind's colour.`);
      }
      const row = rowOf(spec.name);
      out.push(...buildLocation(fonts, spec, { x: centre.x, y: y + row / 2 }, units, crew));
      y += row;
    }
    await OBR.scene.items.addItems(out);
    await OBR.player.select(out.filter(isMapBase).map((i) => i.id));
    say([`Added ${entries.length} location${entries.length === 1 ? "" : "s"}.`, ...notes].join("\n"), notes.length > 0);
    text.value = "";
  } catch (error) {
    say(`Failed: ${String(error)}`, true);
  } finally {
    add.disabled = false;
  }
}

OBR.onReady(() => {
  add.addEventListener("click", () => void run());
  $("close").addEventListener("click", () => void OBR.modal.close(IMPORT_MODAL_ID));
  text.focus();
});
