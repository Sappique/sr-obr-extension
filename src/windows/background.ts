import OBR, { Curve, Item, Path, Vector2 } from "@owlbear-rodeo/sdk";
import { Fonts, loadFonts } from "../core/fonts";
import { Box, legacyHubIsA, outlineMatches, routeLinks, windowOutline } from "../core/geometry";
import { UI_SCALE, windowTokens } from "../core/style";
import {
  buildFlowEffect,
  buildFrame,
  buildNetwork,
  buildPart,
  ANIMATED_KEY,
  DEFAULT_SPEC,
  EMPTY_PATH,
  FLOW_KEY,
  FLOW_ROLE,
  FlowData,
  HASH_KEY,
  ID,
  isFrame,
  Link,
  LINKS_KEY,
  netInfo,
  networkCommands,
  PORT_LAYER,
  outlinePoints,
  readSpec,
  readAnimated,
  readUiScale,
  RENDER_KEY,
  RenderState,
  roleOf,
  ROLE_KEY,
  ROUTE_KEY,
  toObr,
} from "./items";
import { applyWrites, frameBounds, stableTop, TopMemory } from "./frameState";
import { hashString, layoutWindow, STYLE_VERSION } from "./layout";

const ICON = (name: string) => `/icons/${name}.svg`;
const TOOL_ID = `${ID}/window-tool`;
const MODE_ID = `${ID}/window-place`;
const EDITOR_HEIGHT = 560;

const MAX_PASSES = 5;

let isGm = false;
let uiScale: number = UI_SCALE.default;
let animated = readAnimated();
/** Last known top and height per frame, to undo the jump from a top handle. */
const tops = new Map<string, TopMemory>();

// ---------------------------------------------------------------------------
// Sync: only the GM client writes. Runs are serialized; a change arriving
// mid-run triggers one more run with the latest items.

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
    // After our own writes, re-read the scene: a snapshot queued mid-run may
    // predate them and would otherwise recreate parts that already exist.
    let passes = 0;
    while (queued) {
      const items = queued;
      queued = null;
      const wrote = await sync(items);
      if (wrote && ++passes < MAX_PASSES) queued = await OBR.scene.items.getItems();
      else if (!wrote) passes = 0;
    }
  } catch (error) {
    console.error(`[${ID}] window sync failed`, error);
  } finally {
    running = false;
  }
}

function toScene(origin: Vector2, rotation: number, offsetY: number): Vector2 {
  const rad = (rotation * Math.PI) / 180;
  return { x: origin.x - offsetY * Math.sin(rad), y: origin.y + offsetY * Math.cos(rad) };
}

async function sync(items: Item[]): Promise<boolean> {
  const t = windowTokens(uiScale);
  const partsOf = new Map<string, Path[]>();
  for (const item of items) {
    if (roleOf(item) === "part" && item.attachedTo) {
      const list = partsOf.get(item.attachedTo) ?? [];
      list.push(item as Path);
      partsOf.set(item.attachedTo, list);
    }
  }

  const add: Item[] = [];
  const remove: string[] = [];
  const place = new Map<string, Vector2>();
  const show = new Map<string, boolean>();
  type FrameFix = { position: Vector2; w: number; h: number; state: RenderState; title: string };
  const fixes = new Map<string, FrameFix>();
  const boxes = new Map<string, Box & { visible: boolean }>();
  let fonts: Fonts | null = null;

  for (const frame of items.filter(isFrame)) {
    const bounds = frameBounds(frame);
    const scaled = frame.scale.x !== 1 || frame.scale.y !== 1;
    const width = Math.max(t.minWidth, Math.round(bounds.w));
    // Only the height snaps back: x and width keep what the handle did.
    const origin = {
      x: bounds.x,
      y: frame.rotation === 0 ? stableTop(bounds.y, bounds.h, tops.get(frame.id)) : bounds.y,
    };
    const spec = readSpec(frame);
    const key = hashString(JSON.stringify([spec, width, uiScale, STYLE_VERSION]));
    const state = frame.metadata[RENDER_KEY] as RenderState | undefined;
    const parts = partsOf.get(frame.id) ?? [];
    let height = bounds.h;

    for (const part of parts) if (part.visible !== frame.visible) show.set(part.id, frame.visible);

    // Compare the real outline too: a vertical-only drag leaves the width,
    // and so the key, unchanged.
    const expected = state && windowOutline(width, state.height, t.cut);
    const shapeOk = !!expected && outlineMatches(frame.points, expected);

    if (scaled || !shapeOk || state?.key !== key || state.parts !== parts.length) {
      fonts ??= await loadFonts();
      const layout = layoutWindow(fonts, spec, width, uiScale);
      height = layout.height;

      // Reuse identical outlines, so an edit only sends what really changed.
      const pool = new Map<string, Path[]>();
      for (const part of parts) {
        const hash = part.metadata[HASH_KEY] as string;
        pool.set(hash, [...(pool.get(hash) ?? []), part]);
      }
      for (const part of layout.parts) {
        const position = toScene(origin, frame.rotation, part.offsetY);
        const existing = pool.get(part.hash)?.shift();
        if (!existing) add.push(buildPart(frame, part, position));
        else place.set(existing.id, position);
      }
      for (const leftovers of pool.values()) remove.push(...leftovers.map((p) => p.id));

      fixes.set(frame.id, {
        position: origin,
        w: width,
        h: height,
        state: { key, parts: layout.parts.length, height },
        title: spec.title,
      });
    }
    tops.set(frame.id, { y: origin.y, h: height });
    boxes.set(frame.id, { x: origin.x, y: origin.y, w: width, h: height, visible: frame.visible });
  }

  await applyWrites({
    frames: async () => {
      if (!fixes.size) return;
      await OBR.scene.items.updateItems<Curve>([...fixes.keys()], (drafts) => {
        for (const draft of drafts) {
          const fix = fixes.get(draft.id)!;
          draft.position = fix.position;
          draft.scale = { x: 1, y: 1 };
          draft.points = outlinePoints(windowOutline(fix.w, fix.h, t.cut));
          draft.style.strokeWidth = t.border;
          draft.name = fix.title;
          draft.metadata[RENDER_KEY] = fix.state;
        }
      });
    },
    place: async () => {
      if (!place.size && !show.size) return;
      await OBR.scene.items.updateItems([...new Set([...place.keys(), ...show.keys()])], (drafts) => {
        for (const draft of drafts) {
          const position = place.get(draft.id);
          if (position) draft.position = position;
          const visible = show.get(draft.id);
          if (visible !== undefined) draft.visible = visible;
        }
      });
    },
    add: async () => {
      if (add.length) await OBR.scene.items.addItems(add);
    },
    remove: async () => {
      if (remove.length) await OBR.scene.items.deleteItems(remove);
    },
  });
  const linked = await syncConnectors(items, boxes);
  return linked || add.length + place.size + show.size + remove.length + fixes.size > 0;
}

/** Links stored before directions existed keep the way they were flowing. */
function migrateLinks(
  stored: (Partial<Link> & { a?: string; b?: string })[],
  boxes: Map<string, Box>,
): Link[] {
  const old = stored.filter((l) => !l.from && l.a && l.b && boxes.has(l.a) && boxes.has(l.b));
  const hubIsA = legacyHubIsA(old.map((l) => ({ a: boxes.get(l.a!)!, b: boxes.get(l.b!)! })));
  const converted = new Map(old.map((l, i) => [l, hubIsA[i]]));
  return stored.flatMap((l): Link[] => {
    if (l.from && l.to) return [{ from: l.from, to: l.to }];
    if (!converted.has(l)) return [];
    return [converted.get(l) ? { from: l.a!, to: l.b! } : { from: l.b!, to: l.a! }];
  });
}

let lastRouteInput = "";
let lastDrawn: Record<"true" | "false", ReturnType<typeof networkCommands>> | null = null;

function routeOptions() {
  const t = windowTokens(uiScale);
  const c = t.connector;
  return {
    trunkOffset: c.trunkOffset,
    sideOffset: c.sideOffset,
    clearance: c.clearance,
    shadow: t.shadow.offset,
    bendCost: c.bendCost,
    portGap: c.portGap,
  };
}

async function syncConnectors(
  items: Item[],
  boxes: Map<string, Box & { visible: boolean }>,
): Promise<boolean> {
  // Per-link items from before the shared network; those links must be redone.
  const legacy = items.filter((i) => ["connector", "port"].includes(roleOf(i) ?? ""));
  if (legacy.length) await OBR.scene.items.deleteItems(legacy.map((i) => i.id));

  const net = items.filter((i): i is Path => roleOf(i) === "network");
  const master = net.find((i) => netInfo(i).kind === "line" && netInfo(i).shown);
  if (!master) return legacy.length > 0;

  type StoredLink = Partial<Link> & { a?: string; b?: string };
  const stored = (master.metadata[LINKS_KEY] as StoredLink[]) ?? [];
  const migrated = migrateLinks(stored, boxes);
  const links = migrated.filter((l) => boxes.has(l.from) && boxes.has(l.to));
  if (links.length === 0) {
    await OBR.scene.items.deleteItems(net.map((i) => i.id));
    return true;
  }
  const linksChanged = JSON.stringify(links) !== JSON.stringify(stored);

  const shownOf = (l: Link) => boxes.get(l.from)!.visible && boxes.get(l.to)!.visible;
  const input = JSON.stringify([uiScale, links, [...boxes]]);
  if (input !== lastRouteInput) {
    lastRouteInput = input;
    // Hidden windows never shape player-visible lines; that would reveal them.
    const obstacles = [...boxes.values()].filter((b) => b.visible);
    const pick = (shown: boolean) =>
      networkCommands(
        routeLinks(
          links
            .filter((l) => shownOf(l) === shown)
            .map((l) => ({ a: boxes.get(l.from)!, b: boxes.get(l.to)! })),
          obstacles,
          routeOptions(),
        ),
        windowTokens(uiScale),
      );
    lastDrawn = { true: pick(true), false: pick(false) };
  }
  const drawn = lastDrawn!;
  const key = hashString(JSON.stringify([drawn, uiScale]));
  if (key === master.metadata[ROUTE_KEY] && !linksChanged) {
    return legacy.length > 0;
  }

  await OBR.scene.items.updateItems<Path>(net.map((i) => i.id), (drafts) => {
    for (const draft of drafts) {
      const info = netInfo(draft);
      const set = drawn[info.shown ? "true" : "false"];
      draft.commands = toObr(info.kind === "line" ? EMPTY_PATH : set.ports);
      const c = windowTokens(uiScale).connector;
      if (info.kind === "line") {
        // A data carrier now: every client draws the line as local Effects.
        draft.style.strokeOpacity = 0;
        draft.style.strokeWidth = 0;
        draft.metadata[FLOW_KEY] = {
          width: c.width,
          dash: c.dash[0],
          gap: c.dash[1],
          opacity: c.opacity,
          segments: set.flow,
        } satisfies FlowData;
      } else {
        draft.style.strokeWidth = c.width;
        draft.layer = PORT_LAYER;
      }
      if (draft.id === master.id) {
        draft.metadata[LINKS_KEY] = links;
        draft.metadata[ROUTE_KEY] = key;
      }
    }
  });
  return true;
}

// ---------------------------------------------------------------------------
// Animated dashes: runs on every client, only ever touching local items.

let flowRunning = false;
let flowQueued: Item[] | null = null;
let lastFlow = "";

function scheduleFlow(items: Item[]) {
  flowQueued = items;
  if (!flowRunning) void drainFlow();
}

async function drainFlow() {
  flowRunning = true;
  try {
    while (flowQueued) {
      const items = flowQueued;
      flowQueued = null;
      await syncFlow(items);
    }
  } catch (error) {
    console.error(`[${ID}] flow sync failed`, error);
  } finally {
    flowRunning = false;
  }
}

async function syncFlow(items: Item[]) {
  // Links touching a hidden window exist for the GM only.
  const wanted = new Map<string, () => Item>();
  for (const item of items) {
    if (roleOf(item) !== "network" || netInfo(item).kind !== "line") continue;
    const { shown } = netInfo(item);
    const data = item.metadata[FLOW_KEY] as FlowData | undefined;
    if (!data?.segments || (!shown && !isGm)) continue;
    const opacity = shown ? data.opacity : data.opacity * 0.5;
    for (const segment of data.segments) {
      const speed = animated ? 1 : 0;
      const key = hashString(JSON.stringify([segment, data.width, data.dash, data.gap, opacity, speed]));
      wanted.set(key, () => buildFlowEffect(segment, data, opacity, speed, key));
    }
  }
  const signature = [...wanted.keys()].sort().join();
  if (signature === lastFlow) return;
  lastFlow = signature;

  const existing = await OBR.scene.local.getItems((i) => roleOf(i) === FLOW_ROLE);
  const stale = existing.filter((i) => !wanted.delete(i.metadata[FLOW_KEY] as string));
  if (stale.length) await OBR.scene.local.deleteItems(stale.map((i) => i.id));
  if (wanted.size) await OBR.scene.local.addItems([...wanted.values()].map((make) => make()));
}

// ---------------------------------------------------------------------------
// GM entry points

function createTool() {
  OBR.tool.create({
    id: TOOL_ID,
    icons: [{ icon: ICON("window"), label: "Window", filter: { roles: ["GM"] } }],
    defaultMode: MODE_ID,
  });
  OBR.tool.createMode({
    id: MODE_ID,
    icons: [{ icon: ICON("window"), label: "Place window", filter: { activeTools: [TOOL_ID] } }],
    cursors: [{ cursor: "crosshair" }],
    async onToolClick(_, event) {
      const t = windowTokens(uiScale);
      const points = windowOutline(t.defaultWidth, t.cut * 4, t.cut);
      const frame = buildFrame(event.pointerPosition, points, DEFAULT_SPEC, t);
      await OBR.scene.items.addItems([frame]);
      await OBR.player.select([frame.id]);
      await OBR.tool.activateTool("rodeo.owlbear.tool/move").catch(() => undefined);
    },
  });
}

const frameFilter = { key: ["metadata", ROLE_KEY], value: "frame" };

function createContextMenu() {
  // Build a run graph quickly: a new window right of the selected one, already linked.
  OBR.contextMenu.create({
    id: `${ID}/add-linked`,
    icons: [{ icon: ICON("add-linked"), label: "Add linked window", filter: { max: 1, roles: ["GM"], every: [frameFilter] } }],
    async onClick(context) {
      const source = context.items[0] as Curve;
      const box = frameBounds(source);
      const t = windowTokens(uiScale);
      const frame = buildFrame(
        { x: box.x + box.w + t.connector.sideOffset * 2, y: box.y },
        windowOutline(t.defaultWidth, t.cut * 4, t.cut),
        { ...DEFAULT_SPEC, title: "Neuer Knoten" },
        t,
      );
      frame.visible = source.visible;
      await OBR.scene.items.addItems([frame]);
      const master = await findMaster();
      if (master) await editLinks(master.id, (links) => [...links, { from: source.id, to: frame.id }]);
      else await OBR.scene.items.addItems(buildNetwork([{ from: source.id, to: frame.id }], t));
      await OBR.player.select([frame.id]);
    },
  });
  OBR.contextMenu.create({
    id: `${ID}/edit`,
    icons: [
      {
        icon: ICON("edit"),
        label: "Edit window",
        filter: { max: 1, roles: ["GM"], every: [frameFilter] },
      },
    ],
    embed: { url: "/editor.html", height: EDITOR_HEIGHT },
  });

  OBR.contextMenu.create({
    id: `${ID}/connect`,
    icons: [
      {
        icon: ICON("link"),
        label: "Connect",
        filter: { min: 2, max: 2, roles: ["GM"], every: [frameFilter] },
      },
    ],
    async onClick(context) {
      const [a, b] = context.items;
      const master = await findMaster();
      // The SDK doesn't promise a selection order, so the left window is the source.
      const [left, right] = a.position.x <= b.position.x ? [a, b] : [b, a];
      if (!master) {
        await OBR.scene.items.addItems(
          buildNetwork([{ from: left.id, to: right.id }], windowTokens(uiScale)),
        );
        return;
      }
      await editLinks(master.id, (links) => {
        const others = links.filter((l) => !samePair(l, a.id, b.id));
        // Choosing it again on a connected pair removes the connection.
        return others.length === links.length
          ? [...links, { from: left.id, to: right.id }]
          : others;
      });
    },
  });
}

const samePair = (l: Link, a: string, b: string) =>
  (l.from === a && l.to === b) || (l.from === b && l.to === a);

async function findMaster() {
  const net = await OBR.scene.items.getItems((i) => roleOf(i) === "network");
  return net.find((i) => netInfo(i).kind === "line" && netInfo(i).shown);
}

async function editLinks(masterId: string, change: (links: Link[]) => Link[]) {
  await OBR.scene.items.updateItems([masterId], (drafts) => {
    drafts[0].metadata[LINKS_KEY] = change((drafts[0].metadata[LINKS_KEY] as Link[]) ?? []);
    drafts[0].metadata[ROUTE_KEY] = "";
  });
}

// "Reverse direction" exists only while exactly a linked pair is selected;
// context menu filters can't express a relation between two items.
const REVERSE_ID = `${ID}/reverse`;
let selection: string[] = [];
let knownLinks: Link[] = [];
let reverseShown = false;

function refreshReverseMenu() {
  const [a, b] = selection;
  const show = isGm && selection.length === 2 && knownLinks.some((l) => samePair(l, a, b));
  if (show === reverseShown) return;
  reverseShown = show;
  if (!show) {
    void OBR.contextMenu.remove(REVERSE_ID);
    return;
  }
  void OBR.contextMenu.create({
    id: REVERSE_ID,
    icons: [
      {
        icon: ICON("reverse"),
        label: "Reverse direction",
        filter: { min: 2, max: 2, roles: ["GM"], every: [frameFilter] },
      },
    ],
    async onClick(context) {
      const [a, b] = context.items;
      const master = await findMaster();
      if (!master) return;
      await editLinks(master.id, (links) =>
        links.map((l) => (samePair(l, a.id, b.id) ? { from: l.to, to: l.from } : l)),
      );
    },
  });
}

OBR.onReady(async () => {
  isGm = (await OBR.player.getRole()) === "GM";
  selection = (await OBR.player.getSelection()) ?? [];
  OBR.player.onChange((player) => {
    isGm = player.role === "GM";
    selection = player.selection ?? [];
    refreshReverseMenu();
  });
  const onItems = (items: Item[]) => {
    const master = items.find(
      (i) => roleOf(i) === "network" && netInfo(i).kind === "line" && netInfo(i).shown,
    );
    knownLinks = (master?.metadata[LINKS_KEY] as Link[] | undefined) ?? [];
    refreshReverseMenu();
    schedule(items);
    scheduleFlow(items);
  };
  // This viewer's own animation setting, from the options popover.
  OBR.broadcast.onMessage(ANIMATED_KEY, async (event) => {
    animated = event.data === true;
    if (await OBR.scene.isReady()) scheduleFlow(await OBR.scene.items.getItems());
  });
  createTool();
  createContextMenu();

  // A new scale relays out every window.
  OBR.scene.onMetadataChange(async (metadata) => {
    const next = readUiScale(metadata);
    if (next === uiScale) return;
    uiScale = next;
    schedule(await OBR.scene.items.getItems());
  });

  let unsubscribe: (() => void) | null = null;
  const watch = async (ready: boolean) => {
    unsubscribe?.();
    unsubscribe = null;
    if (!ready) return;
    const metadata = await OBR.scene.getMetadata();
    uiScale = readUiScale(metadata);
    lastFlow = "";
    onItems(await OBR.scene.items.getItems());
    unsubscribe = OBR.scene.items.onChange(onItems);
  };
  OBR.scene.onReadyChange(watch);
  await watch(await OBR.scene.isReady());
});
