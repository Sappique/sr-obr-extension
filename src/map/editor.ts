import OBR from "@owlbear-rodeo/sdk";
import "../windows/editor.css";
import type { Align } from "./fan";
import { placeColor as placeColorOf } from "./layout";
import { MAP_SPEC_KEY, mapRole, MapSpec, PlaceKind, readMapSpec } from "./model";

/** Context-menu embed: edits the selected location marker (or its label) or pin. */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const name = $<HTMLTextAreaElement>("name");
const kind = $<HTMLSelectElement>("kind");
const short = $<HTMLInputElement>("short");
const color = $<HTMLInputElement>("color");
const placeColor = $<HTMLInputElement>("placeColor");
const kindColor = $<HTMLButtonElement>("kindColor");
const broken = $<HTMLInputElement>("broken");
/** Custom colour of the location, or "" for the kind's own. */
let custom = "";
const alignButtons = [...$("align").querySelectorAll<HTMLButtonElement>("button")];
const rows = { place: $("placeRow"), place2: $("placeRow2"), pin: $("pinRow"), hint: $("nameHint") };

let itemId: string | null = null;
let selectedId: string | null = null;
let loaded: MapSpec | null = null;
let align: Align = "left";
let timer: number | undefined;

function showAlign() {
  for (const b of alignButtons) b.setAttribute("aria-pressed", String(b.dataset.align === align));
}

function showColor() {
  placeColor.value = placeColorOf({ type: "place", name: "", kind: kind.value as PlaceKind, align, color: custom });
  kindColor.disabled = !custom;
}

function current(): MapSpec | null {
  if (!loaded) return null;
  if (loaded.type === "place") {
    return { ...loaded, name: name.value, kind: kind.value as PlaceKind, align, color: custom || undefined, broken: broken.checked || undefined };
  }
  const initials = short.value.trim().toUpperCase() || name.value.slice(0, 2).toUpperCase();
  return { ...loaded, name: name.value.replace(/\n/g, " "), short: initials, color: color.value };
}

function save() {
  clearTimeout(timer);
  timer = undefined;
  const spec = current();
  if (!itemId || !spec) return;
  void OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const d of drafts) d.metadata[MAP_SPEC_KEY] = spec;
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
  rows.place.hidden = spec.type !== "place";
  rows.place2.hidden = spec.type !== "place";
  rows.hint.hidden = spec.type !== "place";
  rows.pin.hidden = spec.type !== "pin";
  if (spec.type === "place") {
    kind.value = spec.kind;
    align = spec.align;
    showAlign();
    custom = spec.color ?? "";
    broken.checked = !!spec.broken;
    showColor();
  } else {
    short.value = spec.short;
    color.value = spec.color;
  }
  itemId = item.id;
}

OBR.onReady(async () => {
  for (const f of [name, short]) f.addEventListener("input", later);
  name.addEventListener("keydown", (e) => {
    // Pins have one-line names.
    if (e.key === "Enter" && loaded?.type === "pin") e.preventDefault();
  });
  for (const f of [color, broken]) f.addEventListener("change", save);
  kind.addEventListener("change", () => {
    showColor();
    save();
  });
  placeColor.addEventListener("change", () => {
    custom = placeColor.value;
    showColor();
    save();
  });
  kindColor.addEventListener("click", () => {
    custom = "";
    showColor();
    save();
  });
  for (const b of alignButtons) {
    b.addEventListener("click", () => {
      align = b.dataset.align as Align;
      showAlign();
      save();
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
