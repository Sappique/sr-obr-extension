import OBR from "@owlbear-rodeo/sdk";
import "../windows/editor.css";
import type { Align } from "./placement";
import { placeColor as placeColorOf } from "./layout";
import { toEntries } from "../sheets/backend";
import { CrewInfo, LABEL_SNAP_KEY, livePin, livePlace, MAP_SPEC_KEY, mapRole, MapSpec, PinSpec, PLACE_KINDS, PlaceKind, PlaceSpec, readMapSpec } from "./model";

/** Context-menu embed: edits the selected location marker (or its label) or pin. */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const name = $<HTMLTextAreaElement>("name");
const kind = $<HTMLSelectElement>("kind");
const short = $<HTMLInputElement>("short");
const color = $<HTMLInputElement>("color");
const placeColor = $<HTMLInputElement>("placeColor");
const colorMode = $<HTMLSelectElement>("colorMode");
const broken = $<HTMLInputElement>("broken");
/** Custom colour of the location, or "" for the kind's own. */
let custom = "";
/** Crew sheet whose colour the location takes (homes), or "". */
let colorSheet = "";
for (const k of PLACE_KINDS) kind.add(new Option(k.label, k.id));
const alignButtons = [...$("align").querySelectorAll<HTMLButtonElement>("button")];
const sheet = $<HTMLSelectElement>("sheet");
const modeButtons = [...$("mode").querySelectorAll<HTMLButtonElement>("button")];
const rows = {
  place: $("placeRow"), place2: $("placeRow2"), pin: $("pinRow"), hint: $("nameHint"),
  mode: $("modeRow"), link: $("linkRow"), name: $("nameBox"),
};
/** Crew sheets in the scene (not the shared one), by item id. */
let crew = new Map<string, CrewInfo>();
let linked = false;

let itemId: string | null = null;
let selectedId: string | null = null;
let loaded: MapSpec | null = null;
let align: Align = "left";
let centreSide: "top" | "bottom" = "bottom";
/** The alignment button that is on: an alignment plus, for centred labels, above or below. */
const sideNow = () => (align === "center" ? centreSide : align);
let timer: number | undefined;

function showAlign() {
  for (const b of alignButtons) b.setAttribute("aria-pressed", String(b.dataset.side === sideNow()));
}

/** Colour choice: the kind's colour, a custom one, or (for homes) a crew sheet's. */
function showColor() {
  const home = kind.value === "home";
  const opts = [new Option("Kind colour", "kind"), new Option("Custom", "custom")];
  if (home) for (const [id, c] of crew) opts.push(new Option(`From sheet: ${c.handle}`, `sheet:${id}`));
  if (colorSheet && !crew.has(colorSheet)) opts.push(new Option("From sheet: (deleted)", `sheet:${colorSheet}`));
  colorMode.replaceChildren(...opts);
  colorMode.value = colorSheet ? `sheet:${colorSheet}` : custom ? "custom" : "kind";
  const spec: PlaceSpec = { type: "place", name: "", kind: kind.value as PlaceKind, align, color: custom || undefined, colorSheet: colorSheet || undefined };
  placeColor.value = placeColorOf(livePlace(spec, crew));
  placeColor.hidden = colorMode.value !== "custom";
}

function showMode() {
  const pin = loaded?.type === "pin";
  for (const b of modeButtons) b.setAttribute("aria-pressed", String((b.dataset.mode === "linked") === linked));
  rows.mode.hidden = !pin;
  rows.link.hidden = !pin || !linked;
  rows.pin.hidden = !pin || linked;
  rows.name.hidden = pin && linked;
}

function fillSheets(selected?: string) {
  sheet.replaceChildren(...[...crew].map(([id, c]) => new Option(c.handle, id)));
  if (selected && !crew.has(selected)) sheet.add(new Option("(sheet deleted)", selected));
  if (selected) sheet.value = selected;
}

/** Shows a pin's own fields, from what it currently looks like. */
function showPinFields(spec: PinSpec) {
  name.value = spec.name;
  short.value = spec.short;
  color.value = spec.color;
}

function current(): MapSpec | null {
  if (!loaded) return null;
  if (loaded.type === "place") {
    return {
      ...loaded, name: name.value, kind: kind.value as PlaceKind, align, centreSide: align === "center" ? centreSide : undefined,
      color: custom || undefined, colorSheet: colorSheet || undefined, broken: broken.checked || undefined,
    };
  }
  if (linked && sheet.value) {
    // Keep a copy of the sheet's look, in case the sheet is deleted later.
    return livePin({ ...loaded, sheet: sheet.value }, crew);
  }
  const initials = short.value.trim().toUpperCase() || name.value.slice(0, 2).toUpperCase();
  return { type: "pin", name: name.value.replace(/\n/g, " "), short: initials, color: color.value };
}

/** Saves the spec; `snap` also asks the sync to move the label next to its icon. */
async function save(snap = false) {
  clearTimeout(timer);
  timer = undefined;
  const spec = current();
  if (!itemId || !spec) return;
  const id = itemId;
  const plates = snap ? await OBR.scene.items.getItems((i) => i.attachedTo === id && mapRole(i) === "map-label") : [];
  await OBR.scene.items.updateItems([id, ...plates.map((p) => p.id)], (drafts) => {
    for (const d of drafts) {
      if (d.id === id) d.metadata[MAP_SPEC_KEY] = spec;
      else d.metadata[LABEL_SNAP_KEY] = true;
    }
  });
}
const later = () => {
  clearTimeout(timer);
  timer = window.setTimeout(save, 400);
};

async function load(selectedId: string) {
  itemId = null;
  let [item] = await OBR.scene.items.getItems([selectedId]);
  // A label plate edits the marker it belongs to.
  if (item && mapRole(item) === "map-label" && item.attachedTo) [item] = await OBR.scene.items.getItems([item.attachedTo]);
  const spec = item && readMapSpec(item);
  if (!item || !spec) return;
  loaded = spec;
  name.value = spec.name;
  const items = await OBR.scene.items.getItems();
  crew = new Map(
    toEntries(items)
      .filter((e) => !e.error && !e.sheet.shared)
      .map((e) => [e.itemId, { handle: e.sheet.handle, initials: e.sheet.initials, color: e.sheet.color, order: e.sheet.order }]),
  );
  if (spec.type === "pin") {
    linked = !!spec.sheet;
    fillSheets(spec.sheet);
  }
  rows.place.hidden = spec.type !== "place";
  rows.place2.hidden = spec.type !== "place";
  rows.hint.hidden = spec.type !== "place";
  rows.pin.hidden = spec.type !== "pin";
  if (spec.type === "place") {
    kind.value = spec.kind;
    align = spec.align;
    centreSide = spec.centreSide ?? "bottom";
    showAlign();
    custom = spec.color ?? "";
    colorSheet = spec.colorSheet ?? "";
    broken.checked = !!spec.broken;
    showColor();
  } else {
    showPinFields(livePin(spec, crew));
  }
  showMode();
  itemId = item.id;
}

OBR.onReady(async () => {
  for (const f of [name, short]) f.addEventListener("input", later);
  name.addEventListener("keydown", (e) => {
    // Pins have one-line names.
    if (e.key === "Enter" && loaded?.type === "pin") e.preventDefault();
  });
  for (const f of [color, broken]) f.addEventListener("change", () => void save());
  kind.addEventListener("change", () => {
    // Only homes take a sheet's colour.
    if (kind.value !== "home") colorSheet = "";
    showColor();
    save();
  });
  colorMode.addEventListener("change", () => {
    const v = colorMode.value;
    colorSheet = v.startsWith("sheet:") ? v.slice(6) : "";
    // Custom starts from the colour shown so far.
    custom = v === "custom" ? custom || placeColor.value : "";
    showColor();
    save();
  });
  placeColor.addEventListener("change", () => {
    custom = placeColor.value;
    showColor();
    save();
  });
  for (const b of modeButtons) {
    b.addEventListener("click", () => {
      if (!loaded || loaded.type !== "pin") return;
      const next = b.dataset.mode === "linked";
      if (next === linked) return;
      if (!next && sheet.value) showPinFields(livePin({ ...loaded, sheet: sheet.value }, crew));
      if (next && !sheet.value) fillSheets(crew.keys().next().value);
      linked = next;
      showMode();
      save();
    });
  }
  sheet.addEventListener("change", () => void save());
  for (const b of alignButtons) {
    b.addEventListener("click", () => {
      const side = b.dataset.side as "left" | "right" | "top" | "bottom";
      align = side === "top" || side === "bottom" ? "center" : side;
      if (align === "center") centreSide = side as "top" | "bottom";
      showAlign();
      void save(true);
    });
  }
  window.addEventListener("pagehide", () => {
    if (timer !== undefined) save();
  });
  const selected = async (sel: string[] | undefined) => {
    const id = sel?.[0];
    if (!id || id === selectedId) return;
    selectedId = id;
    if (timer !== undefined) save();
    await load(id);
  };
  await selected(await OBR.player.getSelection());
  OBR.player.onChange((p) => void selected(p.selection));
});
