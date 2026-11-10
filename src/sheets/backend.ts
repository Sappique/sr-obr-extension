/**
 * Where the sidebar gets its data from: the OBR scene (one hidden item per sheet)
 * or, in the standalone preview, an in-memory mock. The UI only talks to `Backend`.
 */
import OBR, { buildShape, Item } from "@owlbear-rodeo/sdk";
import { RollMessage } from "../dice/roll";
import { ROLL_CHANNEL, seedCrew, Sheet, SHEET_KEY, SIDEBAR_POPOVER } from "./model";

export interface Entry {
  itemId: string;
  sheet: Sheet;
}

export interface Backend {
  /** Calls back with the sheets (null = no scene open) now and on every change. */
  onSheets(cb: (entries: Entry[] | null) => void): void;
  onRole(cb: (isGM: boolean) => void): void;
  /** Applies `fn` to the latest version of the sheet (one undoable scene change). */
  update(itemId: string, fn: (sheet: Sheet) => void): Promise<void>;
  createCrew(): Promise<void>;
  resize(width: number, height: number): void;
  screenSize(): Promise<{ width: number; height: number }>;
  roll(message: RollMessage): void;
}

export function readSheet(item: Item): Sheet | null {
  const v = item.metadata[SHEET_KEY];
  return v && typeof v === "object" ? (v as Sheet) : null;
}

export function toEntries(items: Item[]): Entry[] {
  const out: Entry[] = [];
  for (const item of items) {
    const sheet = readSheet(item);
    if (sheet) out.push({ itemId: item.id, sheet });
  }
  return out.sort((a, b) => a.sheet.order - b.sheet.order || a.sheet.handle.localeCompare(b.sheet.handle));
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A sheet carrier: an invisible, locked, unclickable 1×1 shape off to the side. */
function carrier(sheet: Sheet, i: number) {
  return buildShape()
    .name(`Sheet: ${sheet.handle}`)
    .shapeType("RECTANGLE")
    .width(1)
    .height(1)
    .position({ x: -1000 - i * 4, y: -1000 })
    .fillOpacity(0)
    .strokeOpacity(0)
    .strokeWidth(0)
    .layer("NOTE")
    .locked(true)
    .disableHit(true)
    .visible(false)
    .metadata({ [SHEET_KEY]: sheet })
    .build();
}

export function obrBackend(): Backend {
  return {
    onSheets(cb) {
      let unsubscribe: (() => void) | null = null;
      let generation = 0;
      const handleReady = async (ready: boolean) => {
        const gen = ++generation;
        unsubscribe?.();
        unsubscribe = null;
        if (!ready) return cb(null);
        const items = await OBR.scene.items.getItems((item) => SHEET_KEY in item.metadata);
        if (gen !== generation) return;
        cb(toEntries(items));
        unsubscribe = OBR.scene.items.onChange((all) => cb(toEntries(all)));
      };
      OBR.scene.onReadyChange(handleReady);
      void OBR.scene.isReady().then(handleReady);
    },
    onRole(cb) {
      void OBR.player.getRole().then((role) => cb(role === "GM"));
      OBR.player.onChange((p) => cb(p.role === "GM"));
    },
    async update(itemId, fn) {
      await OBR.scene.items.updateItems([itemId], (items) => {
        for (const item of items) {
          const sheet = readSheet(item);
          if (!sheet) continue;
          const next = clone(sheet);
          fn(next);
          item.metadata[SHEET_KEY] = next;
        }
      });
    },
    async createCrew() {
      await OBR.scene.items.addItems(seedCrew().map(carrier));
    },
    resize(width, height) {
      void OBR.popover.setWidth(SIDEBAR_POPOVER, width);
      void OBR.popover.setHeight(SIDEBAR_POPOVER, height);
    },
    async screenSize() {
      const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
      return { width, height };
    },
    roll(message) {
      void OBR.broadcast.sendMessage(ROLL_CHANNEL, message, { destination: "ALL" });
    },
  };
}

/** Standalone preview: in-memory sheets, rolls go to other tabs via BroadcastChannel. */
export function mockBackend(): Backend {
  let entries: Entry[] = seedCrew().map((sheet, i) => ({ itemId: `mock-${i}`, sheet }));
  const listeners: ((e: Entry[] | null) => void)[] = [];
  const roleListeners: ((gm: boolean) => void)[] = [];
  const params = new URLSearchParams(location.search);
  const emit = () => listeners.forEach((cb) => cb(clone(entries)));
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("vtt-roll") : null;
  return {
    onSheets(cb) {
      listeners.push(cb);
      cb(params.has("empty") ? [] : clone(entries));
    },
    onRole(cb) {
      roleListeners.push(cb);
      cb(params.get("role") !== "player");
    },
    async update(itemId, fn) {
      entries = entries.map((e) => {
        if (e.itemId !== itemId) return e;
        const next = clone(e.sheet);
        fn(next);
        return { itemId, sheet: next };
      });
      emit();
    },
    async createCrew() {
      emit();
    },
    resize(width, height) {
      document.documentElement.dataset.size = `${width}×${height}`;
    },
    async screenSize() {
      return { width: window.innerWidth, height: window.innerHeight };
    },
    roll(message) {
      channel?.postMessage(message);
      window.dispatchEvent(new CustomEvent("vtt-roll", { detail: message }));
    },
  };
}
