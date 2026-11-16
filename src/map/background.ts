import OBR, { Item, Path, Vector2 } from "@owlbear-rodeo/sdk";
import { Fonts, loadFonts } from "../core/fonts";
import { toEntries } from "../sheets/backend";
import { defaultAnchor, fanSlots, LONE_SLOT, moveAnchor, PinTip } from "./fan";
import { applyShape, buildLabel, buildPart, buildPin, buildSymbol } from "./items";
import { labelLayout, pinLayout, symbolShape } from "./layout";
import {
  ID, isMapBase, LABEL_KEY, LabelMeta, MAP_HASH_KEY, MAP_ROLE_KEY, mapRole, markerUnit, newPin, newPlace,
  PART_KEY, PartName, PinSpec, readMapScale, readMapSpec,
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
let gridDpi = 150;
const unit = () => markerUnit(gridDpi, mapScale);

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

const pinTips = (items: Item[]): PinTip[] =>
  items
    .filter((i) => isMapBase(i) && readMapSpec(i)?.type === "pin")
    .map((i) => ({ id: i.id, x: i.position.x, y: i.position.y }));

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
  const slots = fanSlots(pinTips(items), u);
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
    const spec = readMapSpec(base);
    if (!spec) continue;
    fonts ??= await loadFonts();

    if (spec.type === "pin") {
      const layout = pinLayout(fonts, spec, u, slots.get(base.id) ?? LONE_SLOT);
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

    const symbol = symbolShape(spec, u);
    if (base.metadata[MAP_HASH_KEY] !== symbol.hash) {
      edit(base.id, (d) => {
        applyShape(d as Path, symbol);
        d.metadata[MAP_HASH_KEY] = symbol.hash;
      });
    }
    const name = spec.name.split("\n")[0] || "Ort";
    if (base.name !== name) edit(base.id, (d) => (d.name = name));

    const [plate, ...extra] = labels.get(base.id) ?? [];
    for (const e of extra) remove.push(e.id, ...(parts.get(e.id) ?? []).map((p) => p.id));
    const layout = labelLayout(fonts, spec, u);
    if (!layout) {
      if (plate) remove.push(plate.id, ...(parts.get(plate.id) ?? []).map((p) => p.id));
      continue;
    }
    const meta: LabelMeta = { unit: u, align: spec.align, width: layout.width, hash: layout.hash };
    if (!plate) {
      add.push(...buildLabel(base, layout, defaultAnchor(base.position, spec.align, layout.width, u), meta));
      continue;
    }
    const was = plate.metadata[LABEL_KEY] as LabelMeta | undefined;
    if (was?.hash !== layout.hash || !partOf(plate.id, "bar") || !partOf(plate.id, "text")) {
      const anchor: Vector2 = was ? moveAnchor(plate.position, base.position, was, meta) : plate.position;
      edit(plate.id, (d) => {
        applyShape(d as Path, layout.plate);
        d.position = anchor;
        d.metadata[LABEL_KEY] = meta;
      });
      setPart(plate, "bar", layout.bar, plate.zIndex + 1);
      setPart(plate, "text", layout.text, plate.zIndex + 2);
    }
    follow(plate, base.visible);
    for (const p of parts.get(plate.id) ?? []) follow(p, base.visible);
  }

  // Leftovers whose owner is gone.
  for (const item of items) {
    const role = mapRole(item);
    if ((role === "map-label" || role === "map-part") && (!item.attachedTo || !byId.has(item.attachedTo))) remove.push(item.id);
  }

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
  const fonts = await loadFonts();
  const spec = newPlace();
  const u = unit();
  const symbol = buildSymbol(spec, position, symbolShape(spec, u));
  const layout = labelLayout(fonts, spec, u)!;
  const label = buildLabel(symbol, layout, defaultAnchor(position, spec.align, layout.width, u), {
    unit: u, align: spec.align, width: layout.width, hash: layout.hash,
  });
  return [symbol, ...label];
}

/** Pins for the given specs around one point, already fanned out together. */
async function placePins(specs: PinSpec[], at: Vector2): Promise<Item[]> {
  const fonts = await loadFonts();
  const u = unit();
  // Tiny offsets keep the left-to-right order of the specs in the fan.
  const tips = specs.map((_, i) => ({ id: String(i), x: at.x + i * 0.01, y: at.y }));
  const slots = fanSlots(tips, u);
  return specs.flatMap((spec, i) => buildPin(spec, tips[i], pinLayout(fonts, spec, u, slots.get(String(i))!)));
}

async function crewPinSpecs(): Promise<PinSpec[]> {
  const items = await OBR.scene.items.getItems();
  const pinned = new Set(
    items.filter(isMapBase).map((i) => readMapSpec(i)).flatMap((s) => (s?.type === "pin" && s.sheet ? [s.sheet] : [])),
  );
  return toEntries(items)
    .filter((e) => !e.error && !pinned.has(e.itemId))
    .sort((a, b) => a.sheet.order - b.sheet.order)
    .map((e) => ({ type: "pin", name: e.sheet.handle, short: e.sheet.initials, color: e.sheet.color, sheet: e.itemId }));
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
    embed: { url: "/map-editor.html", height: 186 },
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
    mapScale = readMapScale(await OBR.scene.getMetadata());
    gridDpi = await OBR.scene.grid.getDpi();
    schedule(await OBR.scene.items.getItems());
    unsubscribe = OBR.scene.items.onChange(schedule);
  };
  OBR.scene.onReadyChange(watch);
  await watch(await OBR.scene.isReady());
  OBR.scene.onMetadataChange(async (metadata) => {
    const next = readMapScale(metadata);
    if (next === mapScale) return;
    mapScale = next;
    schedule(await OBR.scene.items.getItems());
  });
  OBR.scene.grid.onChange(async (grid) => {
    if (grid.dpi === gridDpi) return;
    gridDpi = grid.dpi;
    schedule(await OBR.scene.items.getItems());
  });
});

