/**
 * Where the sidebar gets its data from: the OBR scene or, in the standalone preview, an
 * in-memory mock. The UI only talks to `Backend`.
 *
 * In OBR every sheet is a text item in the scene whose text IS the sheet, as JSON (schema.ts):
 * hidden from players, left of the map, and readable and editable with OBR's own text tool.
 * The extension reads the text on every change and writes it back formatted. Text that does not
 * parse keeps the last valid version on screen (the GM sees the error) and is never overwritten.
 * Earlier versions kept the JSON in the metadata of invisible shape items; the GM client
 * converts those (migrateLegacy).
 */
import OBR, { buildText, Item, isText, Text } from "@owlbear-rodeo/sdk";
import { RollMessage } from "../dice/roll";
import { ID, ROLL_CHANNEL, seedCrew, Sheet, SHEET_KEY } from "./model";
import { formatSheet, parseSheetText, toSheet } from "./schema";

export interface Entry {
  itemId: string;
  sheet: Sheet;
  /** The item's text is not a valid sheet: `sheet` is the last valid version (or a stub). */
  error?: string;
}

export interface Backend {
  /** Calls back with the sheets (null = no scene open) now and on every change. */
  onSheets(cb: (entries: Entry[] | null) => void): void;
  onRole(cb: (isGM: boolean) => void): void;
  /** Applies `fn` to the latest version of the sheet (one undoable scene change). Does nothing
   *  while the stored text is invalid. */
  update(itemId: string, fn: (sheet: Sheet) => void): Promise<void>;
  createCrew(): Promise<void>;
  /** GM: converts sheets stored by earlier versions into text items. */
  migrateLegacy(): Promise<void>;
  /** Sizes the popover this page lives in (`popoverId`) to its content. */
  resize(popoverId: string, width: number, height: number): void;
  screenSize(): Promise<{ width: number; height: number }>;
  roll(message: RollMessage): void;
}

/** Marks a text item as a sheet (the sheet itself is the item's text). */
export const SHEET_TEXT_KEY = `${ID}/sheet-text`;
const SHEET_W = 760; // text item width; long lines wrap
const SHEET_X = (i: number) => -1000 - (i + 1) * (SHEET_W + 80);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function textOf(item: Text) {
  if (item.text.type === "PLAIN") return item.text.plainText;
  // someone switched it to rich text: read the paragraphs' plain text
  const flat = (n: unknown): string => {
    const o = n as { text?: string; children?: unknown[] };
    return typeof o.text === "string" ? o.text : (o.children ?? []).map(flat).join("");
  };
  return item.text.richText.map(flat).join("\n");
}

const isSheetText = (item: Item): item is Text => isText(item) && SHEET_TEXT_KEY in item.metadata;
const isLegacy = (item: Item) => !isText(item) && !!item.metadata[SHEET_KEY] && typeof item.metadata[SHEET_KEY] === "object";

/** A sheet text item for the scene. */
function sheetText(sheet: Sheet, i: number) {
  return buildText()
    .name(`Sheet: ${sheet.handle}`)
    .textType("PLAIN")
    .plainText(formatSheet(sheet))
    .width(SHEET_W)
    .height("AUTO")
    .fontFamily("monospace")
    .fontSize(14)
    .fillColor("#ffffff")
    .textAlign("LEFT")
    .textAlignVertical("TOP")
    .padding(12)
    .position({ x: SHEET_X(i), y: -1000 })
    .layer("TEXT")
    .visible(false)
    .metadata({ [SHEET_TEXT_KEY]: true })
    .build();
}

/** Last valid sheet per item, shown while its text is invalid. */
const lastValid = new Map<string, Sheet>();
function readEntry(item: Item): Entry | null {
  if (isLegacy(item)) {
    const r = toSheet(item.metadata[SHEET_KEY]);
    return "sheet" in r ? { itemId: item.id, sheet: r.sheet } : null;
  }
  if (!isSheetText(item)) return null;
  const r = parseSheetText(textOf(item));
  if ("sheet" in r) {
    lastValid.set(item.id, r.sheet);
    return { itemId: item.id, sheet: r.sheet };
  }
  const handle = item.name.replace(/^Sheet:\s*/, "") || "?";
  const stub: Sheet = {
    v: 2, id: item.id, handle, initials: "!", color: "#ff2848", order: 1000, nuyen: 0,
    cond: { k: { text: "", state: "ok" }, p: { text: "", state: "ok" } }, meta: [], attributes: [], doc: "",
  };
  return { itemId: item.id, sheet: lastValid.get(item.id) ?? stub, error: r.error };
}

export function toEntries(items: Item[]): Entry[] {
  const out: Entry[] = [];
  for (const item of items) {
    const e = readEntry(item);
    if (e) out.push(e);
  }
  return out.sort((a, b) => a.sheet.order - b.sheet.order || a.sheet.handle.localeCompare(b.sheet.handle));
}

export function obrBackend(): Backend {
  let migrating = false;
  return {
    onSheets(cb) {
      let unsubscribe: (() => void) | null = null;
      let generation = 0;
      const handleReady = async (ready: boolean) => {
        const gen = ++generation;
        unsubscribe?.();
        unsubscribe = null;
        if (!ready) return cb(null);
        const items = await OBR.scene.items.getItems((item) => SHEET_TEXT_KEY in item.metadata || SHEET_KEY in item.metadata);
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
          if (isSheetText(item)) {
            const r = parseSheetText(textOf(item));
            if (!("sheet" in r)) continue; // never overwrite text the GM is fixing
            const next = clone(r.sheet);
            fn(next);
            item.text.type = "PLAIN";
            item.text.plainText = formatSheet(next);
            item.name = `Sheet: ${next.handle}`;
          } else if (isLegacy(item)) {
            const r = toSheet(item.metadata[SHEET_KEY]);
            if (!("sheet" in r)) continue;
            const next = clone(r.sheet);
            fn(next);
            item.metadata[SHEET_KEY] = next;
          }
        }
      });
    },
    async createCrew() {
      await OBR.scene.items.addItems(seedCrew().map(sheetText));
    },
    async migrateLegacy() {
      if (migrating) return;
      migrating = true;
      try {
        const old = await OBR.scene.items.getItems(isLegacy);
        if (!old.length) return;
        const sheets = toEntries(old).map((e) => e.sheet);
        const existing = (await OBR.scene.items.getItems(isSheetText)).length;
        await OBR.scene.items.addItems(sheets.map((s, i) => sheetText(s, existing + i)));
        await OBR.scene.items.deleteItems(old.map((i) => i.id));
      } finally {
        migrating = false;
      }
    },
    resize(popoverId, width, height) {
      void OBR.popover.setWidth(popoverId, width);
      void OBR.popover.setHeight(popoverId, height);
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
    async migrateLegacy() {},
    resize(_popoverId, width, height) {
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
