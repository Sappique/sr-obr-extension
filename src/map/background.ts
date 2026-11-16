import OBR, { Item, Path, Vector2 } from "@owlbear-rodeo/sdk";
import { Fonts, loadFonts } from "../core/fonts";
import { toEntries } from "../sheets/backend";
import { groupSlots, groupTips, LONE_SLOT, moveAnchor, pickSpot, PinSlot, PinTip, snapAnchor } from "./placement";
import { buildLocation, LABEL_GAP } from "./create";
import { applyShape, buildLabel, buildPart, buildPin, SYMBOL_PARTS } from "./items";
import { labelLayout, pinLayout, symbolLayout } from "./layout";
import {
  ID, isMapBase, LABEL_KEY, LabelMeta, MAP_HASH_KEY, MAP_ROLE_KEY, MAP_SPEC_KEY, mapRole, iconUnit, markerUnit, labelSide, labelUnitOf, LABEL_SNAP_KEY, newPin, newPlace,
  CrewInfo, livePin, livePlace, PART_KEY, PartName, PinSpec, readLabelScale, readMapScale, readMapSpec,
} from "./model";

/**
 * Map markers: the GM client keeps every marker's drawing in step with its
 * spec, the marker size and (for pins) its neighbours. New markers are built
 * complete, so placing one is a single write.
 */
const ICON = (name: string) => `/icons/${name}.svg`;
const TOOL_ID = `${ID}/map-tool`;
const MAX_PASSES = 4;

let isGm = false;
let mapScale = 1;
let labelScale = 1;
let gridDpi = 150;
/** Pin positions after the last sync, to tell which pin was just moved. */
let lastTips = new Map<string, Vector2>();
/** Lock state of location icons and labels after the last sync, to tell which one was just (un)locked. */
let lastLocked = new Map<string, boolean>();
/** Same for visibility: hiding or showing either the icon or its label does it to both. */
let lastVisible = new Map<string, boolean>();
const unit = () => iconUnit(gridDpi, mapScale);
/** Pins keep their first size at 100 % (no ICON_BASE), but follow the same icon slider. */
const pinUnit = () => markerUnit(gridDpi, mapScale);
const labelUnit = () => labelUnitOf(gridDpi, labelScale);

// ---------------------------------------------------------------------------
// Sync (GM only, serialized like the window sync)

let running = false;
let queued: Item[] | null = null;

function schedule(items: Item[]) {
  if (!isGm) return;
  queued = items;
  if (!running) void drain();
}

async function drain() {
  running = true;
  try {
    let passes = 0;
    while (queued) {
      const items = queued;
      queued = null;
      const wrote = await sync(items);
      if (wrote && ++passes < MAX_PASSES) queued = await OBR.scene.items.getItems();
      else if (!wrote) passes = 0;
    }
  } catch (error) {
    console.error(`[${ID}] map sync failed`, error);
  } finally {
    running = false;
  }
}

type Edit = (draft: Item) => void;

/**
 * Order inside a group: the crew sidebar's order, read live from the pin's
 * sheet (so reordering the crew reorders the pins), then the name.
 */
function pinTips(items: Item[], crew: Map<string, CrewInfo>): PinTip[] {
  return items.flatMap((i) => {
    const raw = isMapBase(i) ? readMapSpec(i) : undefined;
    if (raw?.type !== "pin") return [];
    const spec = livePin(raw, crew);
    return [{ id: i.id, x: i.position.x, y: i.position.y, rank: `${String(spec.order ?? 9999).padStart(5, "0")}|${spec.name}` }];
  });
}

/** Crew sheets by item id, for linked pins. */
const crewOf = (items: Item[]) =>
  new Map<string, CrewInfo>(
    toEntries(items)
      .filter((e) => !e.error)
      .map((e) => [e.itemId, { handle: e.sheet.handle, initials: e.sheet.initials, color: e.sheet.color, order: e.sheet.order }]),
  );

/** Where every pin stands and how it is drawn: pins on one spot snap together. */
function planPins(tips: PinTip[], u: number) {
  const plan = new Map<string, { spot: Vector2; slot: PinSlot }>();
  for (const group of groupTips(tips, u)) {
    const spot = group.length > 1 ? pickSpot(group, lastTips) : { x: group[0].x, y: group[0].y };
    const slots = groupSlots(group.length);
    group.forEach((tip, i) => plan.set(tip.id, { spot, slot: slots[i] }));
  }
  return plan;
}

async function sync(items: Item[]): Promise<boolean> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const childrenOf = (role: string) => {
    const out = new Map<string, Item[]>();
    for (const item of items) {
      if (mapRole(item) !== role || !item.attachedTo) continue;
      out.set(item.attachedTo, [...(out.get(item.attachedTo) ?? []), item]);
    }
    return out;
  };
  const labels = childrenOf("map-label");
  const parts = childrenOf("map-part");
  const partOf = (owner: string, name: PartName) => parts.get(owner)?.find((p) => p.metadata[PART_KEY] === name);

  const edits = new Map<string, Edit[]>();
  const edit = (id: string, fn: Edit) => edits.set(id, [...(edits.get(id) ?? []), fn]);
  const add: Item[] = [];
  const remove: string[] = [];
  const u = unit();
  const lu = labelUnit();
  const crew = crewOf(items);
  const nextLocked = new Map<string, boolean>();
  const nextVisible = new Map<string, boolean>();
  const pu = pinUnit();
  const pins = planPins(pinTips(items, crew), pu);
  let fonts: Fonts | null = null;

  /** Redraws a part, or recreates it if it went missing. */
  const setPart = (owner: Item, name: PartName, shape: Parameters<typeof applyShape>[1], z: number) => {
    const part = partOf(owner.id, name);
    if (part) edit(part.id, (d) => applyShape(d as Path, shape));
    else add.push(buildPart(owner, name, shape, z));
  };
  const follow = (owner: Item, visible: boolean) => {
    if (owner.visible !== visible) edit(owner.id, (d) => (d.visible = visible));
  };

  for (const base of items.filter(isMapBase)) {
    const raw = readMapSpec(base);
    if (!raw) continue;
    fonts ??= await loadFonts();

    if (raw.type === "pin") {
      const spec = livePin(raw, crew);
      // Keep the linked pin's copy of its sheet current, so it still looks
      // right if the sheet is deleted later.
      if (JSON.stringify(spec) !== JSON.stringify(raw)) edit(base.id, (d) => (d.metadata[MAP_SPEC_KEY] = spec));
      const { spot, slot } = pins.get(base.id) ?? { spot: base.position, slot: LONE_SLOT };
      // Moving the pin carries its initials along.
      if (spot.x !== base.position.x || spot.y !== base.position.y) edit(base.id, (d) => (d.position = spot));
      const layout = pinLayout(fonts, spec, pu, slot);
      const initials = partOf(base.id, "initials");
      if (base.metadata[MAP_HASH_KEY] !== layout.hash || !initials) {
        edit(base.id, (d) => {
          applyShape(d as Path, layout.pin);
          d.name = spec.name || "Pin";
          d.metadata[MAP_HASH_KEY] = layout.hash;
        });
        setPart(base, "initials", layout.initials, base.zIndex + 1);
      }
      if (initials) follow(initials, base.visible);
      continue;
    }
    const spec = livePlace(raw, crew);

    // Icon and label are hidden or shown together: whichever just changed sets both.
    const label = (labels.get(base.id) ?? [])[0];
    let visible = base.visible;
    if (label && label.visible !== base.visible && lastVisible.get(base.id) === base.visible) visible = label.visible;
    if (visible !== base.visible) edit(base.id, (d) => (d.visible = visible));
    nextVisible.set(base.id, visible);
    if (label) nextVisible.set(label.id, visible);

    const symbol = symbolLayout(spec, u);
    const partsOk = SYMBOL_PARTS.every((n) => !!partOf(base.id, n) === !!symbol[n]);
    if (base.metadata[MAP_HASH_KEY] !== symbol.hash || !partsOk) {
      edit(base.id, (d) => {
        applyShape(d as Path, symbol.base);
        d.metadata[MAP_HASH_KEY] = symbol.hash;
      });
      SYMBOL_PARTS.forEach((n, i) => {
        const shape = symbol[n];
        if (shape) setPart(base, n, shape, base.zIndex + 1 + i);
        else if (partOf(base.id, n)) remove.push(partOf(base.id, n)!.id);
      });
    }
    for (const n of SYMBOL_PARTS) {
      const part = partOf(base.id, n);
      if (part) follow(part, visible);
    }
    const gap = LABEL_GAP * lu;
    const name = spec.name.split("\n")[0] || "Ort";
    if (base.name !== name) edit(base.id, (d) => (d.name = name));

    const [plate, ...extra] = labels.get(base.id) ?? [];
    for (const e of extra) remove.push(e.id, ...(parts.get(e.id) ?? []).map((p) => p.id));
    const layout = labelLayout(fonts, spec, lu);
    if (!layout) {
      if (plate) remove.push(plate.id, ...(parts.get(plate.id) ?? []).map((p) => p.id));
      continue;
    }
    // A label's offset from its icon scales with the label size.
    const meta: LabelMeta = { unit: lu, align: spec.align, width: layout.width, hash: layout.hash };
    if (!plate) {
      add.push(...buildLabel(base, layout, snapAnchor(base.position, labelSide(spec), layout.height, symbol.half, gap), meta));
      continue;
    }
    const was = plate.metadata[LABEL_KEY] as LabelMeta | undefined;
    // The editor asks for a snap when an alignment button is clicked: the label
    // then moves next to its icon on that side instead of keeping its spot.
    const snap = !!plate.metadata[LABEL_SNAP_KEY];
    if (was?.hash !== layout.hash || snap || !partOf(plate.id, "bar") || !partOf(plate.id, "text")) {
      const anchor: Vector2 = snap
        ? snapAnchor(base.position, labelSide(spec), layout.height, symbol.half, gap)
        : was ? moveAnchor(plate.position, base.position, was, meta) : plate.position;
      edit(plate.id, (d) => {
        applyShape(d as Path, layout.plate);
        d.position = anchor;
        d.metadata[LABEL_KEY] = meta;
        delete d.metadata[LABEL_SNAP_KEY];
      });
      setPart(plate, "bar", layout.bar, plate.zIndex + 1);
      setPart(plate, "text", layout.text, plate.zIndex + 2);
    }
    // Icon and label lock together: whichever was just (un)locked sets the other.
    if (plate.locked !== base.locked) {
      const iconChanged = lastLocked.get(base.id) !== base.locked;
      const target = iconChanged ? plate : base;
      const locked = iconChanged ? base.locked : plate.locked;
      edit(target.id, (d) => (d.locked = locked));
      nextLocked.set(base.id, locked).set(plate.id, locked);
    } else nextLocked.set(base.id, base.locked).set(plate.id, plate.locked);
    follow(plate, visible);
    for (const p of parts.get(plate.id) ?? []) follow(p, visible);
  }

  // Leftovers whose owner is gone.
  for (const item of items) {
    const role = mapRole(item);
    if ((role === "map-label" || role === "map-part") && (!item.attachedTo || !byId.has(item.attachedTo))) remove.push(item.id);
  }

  lastTips = new Map([...pins].map(([id, p]) => [id, p.spot]));
  lastLocked = nextLocked;
  lastVisible = nextVisible;

  // One update for everything; a plate's new position carries its parts along.
  if (edits.size) {
    await OBR.scene.items.updateItems([...edits.keys()], (drafts) => {
      for (const d of drafts) for (const fn of edits.get(d.id) ?? []) fn(d);
    });
  }
  if (add.length) await OBR.scene.items.addItems(add);
  if (remove.length) await OBR.scene.items.deleteItems([...new Set(remove)]);
  return edits.size + add.length + remove.length > 0;
}

// ---------------------------------------------------------------------------
// Creating markers, built complete

async function placeLocation(position: Vector2): Promise<Item[]> {
  return buildLocation(await loadFonts(), newPlace(), position, { icon: unit(), label: labelUnit() }, new Map());
}

/** Pins for the given specs on one spot, drawn as one group. */
async function placePins(specs: PinSpec[], at: Vector2): Promise<Item[]> {
  const fonts = await loadFonts();
  const u = pinUnit();
  const spot = { x: at.x, y: at.y };
  const slots = groupSlots(specs.length);
  return specs.flatMap((spec, i) => buildPin(spec, spot, pinLayout(fonts, spec, u, slots[i])));
}

async function crewPinSpecs(): Promise<PinSpec[]> {
  const items = await OBR.scene.items.getItems();
  const pinned = new Set(
    items.filter(isMapBase).map((i) => readMapSpec(i)).flatMap((s) => (s?.type === "pin" && s.sheet ? [s.sheet] : [])),
  );
  return toEntries(items)
    // The shared crew sheet ("Gemeinsam") is nobody on the map.
    .filter((e) => !e.error && !e.sheet.shared && !pinned.has(e.itemId))
    .sort((a, b) => a.sheet.order - b.sheet.order)
    .map((e) => ({
      type: "pin", name: e.sheet.handle, short: e.sheet.initials, color: e.sheet.color, sheet: e.itemId, order: e.sheet.order,
    }));
}

function createTool() {
  OBR.tool.create({
    id: TOOL_ID,
    icons: [{ icon: ICON("pin"), label: "Map markers", filter: { roles: ["GM"] } }],
    defaultMode: `${TOOL_ID}/place`,
  });
  const modes: [string, string, string, (at: Vector2) => Promise<Item[]>][] = [
    ["place", "Place location", "pin", placeLocation],
    ["crew", "Place crew pins (all not yet on the map)", "crew", async (at) => placePins(await crewPinSpecs(), at)],
    ["runner", "Place a single pin", "runner", (at) => placePins([newPin()], at)],
  ];
  for (const [id, label, icon, make] of modes) {
    OBR.tool.createMode({
      id: `${TOOL_ID}/${id}`,
      icons: [{ icon: ICON(icon), label, filter: { activeTools: [TOOL_ID] } }],
      cursors: [{ cursor: "crosshair" }],
      async onToolClick(_, event) {
        const items = await make(event.pointerPosition);
        if (!items.length) {
          void OBR.notification.show("Every crew sheet already has a pin on the map.");
          return;
        }
        await OBR.scene.items.addItems(items);
        void OBR.player.select(items.filter(isMapBase).map((i) => i.id));
        await OBR.tool.activateTool("rodeo.owlbear.tool/move").catch(() => undefined);
      },
    });
  }
}

function createContextMenu() {
  OBR.contextMenu.create({
    id: `${ID}/map-edit`,
    icons: [
      {
        icon: ICON("edit"),
        label: "Edit map marker",
        filter: {
          max: 1,
          roles: ["GM"],
          every: [
            { key: ["metadata", MAP_ROLE_KEY], value: "map-base", coordinator: "||" },
            { key: ["metadata", MAP_ROLE_KEY], value: "map-label" },
          ],
        },
      },
    ],
    embed: { url: "/map-editor.html", height: 236 },
  });
}

OBR.onReady(async () => {
  isGm = (await OBR.player.getRole()) === "GM";
  OBR.player.onChange((p) => {
    isGm = p.role === "GM";
  });
  createTool();
  createContextMenu();

  let unsubscribe: (() => void) | null = null;
  const watch = async (ready: boolean) => {
    unsubscribe?.();
    unsubscribe = null;
    if (!ready) return;
    const metadata = await OBR.scene.getMetadata();
    mapScale = readMapScale(metadata);
    labelScale = readLabelScale(metadata);
    gridDpi = await OBR.scene.grid.getDpi();
    schedule(await OBR.scene.items.getItems());
    unsubscribe = OBR.scene.items.onChange(schedule);
  };
  OBR.scene.onReadyChange(watch);
  await watch(await OBR.scene.isReady());
  OBR.scene.onMetadataChange(async (metadata) => {
    const next = readMapScale(metadata);
    const nextLabel = readLabelScale(metadata);
    if (next === mapScale && nextLabel === labelScale) return;
    mapScale = next;
    labelScale = nextLabel;
    schedule(await OBR.scene.items.getItems());
  });
  OBR.scene.grid.onChange(async (grid) => {
    if (grid.dpi === gridDpi) return;
    gridDpi = grid.dpi;
    schedule(await OBR.scene.items.getItems());
  });
});

