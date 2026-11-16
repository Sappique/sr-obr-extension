/**
 * Mass import of location markers: JSON or plain text in, location specs out.
 * Pure, so it can be tested without OBR.
 *
 * JSON: an array of objects (or one object with a "locations" array):
 *   { "name": "Harrow Ost", "kind": "home", "sheet": "Hawk" }
 *   fields: name (required; "\n" for line breaks), kind, align (left | center | right),
 *   color ("#rrggbb"), sheet (crew handle whose colour a home takes), broken (true/false).
 * Text: one location per line, "kind: name" or just "name"; "|" makes a line break.
 */
import type { Align } from "./fan";
import { PLACE_KINDS, type PlaceKind, type PlaceSpec } from "./model.ts";

export interface ImportEntry {
  spec: PlaceSpec;
  /** Crew handle to take the colour from, resolved against the scene's sheets. */
  sheet?: string;
}

export interface ImportResult {
  entries: ImportEntry[];
  errors: string[];
}

const KIND_IDS = new Set<string>(PLACE_KINDS.map((k) => k.id));
/** Other words people may write for a kind. */
const KIND_ALIASES: Record<string, PlaceKind> = {
  contact: "person", location: "place", poi: "place", corporation: "corp", restaurant: "club", bar: "club",
  safehouse: "home", magical: "magic", port: "harbor", harbour: "harbor",
};
const ALIGNS = new Set(["left", "center", "right"]);

function kindOf(raw: unknown): PlaceKind | null {
  if (raw === undefined || raw === null || raw === "") return "place";
  const k = String(raw).trim().toLowerCase();
  if (KIND_IDS.has(k)) return k as PlaceKind;
  return KIND_ALIASES[k] ?? null;
}

function entryFrom(o: Record<string, unknown>, where: string, errors: string[]): ImportEntry | null {
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) {
    errors.push(`${where}: "name" is missing.`);
    return null;
  }
  const kind = kindOf(o.kind);
  if (!kind) {
    errors.push(`${where} (${name}): unknown kind "${String(o.kind)}". Kinds: ${PLACE_KINDS.map((k) => k.id).join(", ")}.`);
    return null;
  }
  const align = typeof o.align === "string" && ALIGNS.has(o.align) ? (o.align as Align) : "left";
  const spec: PlaceSpec = { type: "place", name, kind, align };
  if (typeof o.color === "string") {
    if (/^#[0-9a-fA-F]{6}$/.test(o.color)) spec.color = o.color;
    else errors.push(`${where} (${name}): colour "${o.color}" should look like "#a46cff"; ignored.`);
  }
  if (o.broken === true) spec.broken = true;
  const sheet = typeof o.sheet === "string" && o.sheet.trim() ? o.sheet.trim() : undefined;
  return { spec, sheet };
}

export function parseLocations(text: string): ImportResult {
  const errors: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { entries: [], errors: ["Nothing to add."] };

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch (e) {
      return { entries: [], errors: [`Not valid JSON: ${(e as Error).message}`] };
    }
    const list = Array.isArray(data) ? data : (data as { locations?: unknown }).locations;
    if (!Array.isArray(list)) return { entries: [], errors: ['JSON must be an array, or an object with a "locations" array.'] };
    const entries = list.flatMap((o, i) =>
      o && typeof o === "object" ? [entryFrom(o as Record<string, unknown>, `Entry ${i + 1}`, errors)].filter((e): e is ImportEntry => !!e) : [],
    );
    return { entries, errors };
  }

  const entries: ImportEntry[] = [];
  trimmed.split("\n").forEach((line, i) => {
    const l = line.trim();
    if (!l || l.startsWith("#")) return;
    const m = /^([\w-]+)\s*:\s*(.+)$/.exec(l);
    const known = m && kindOf(m[1]);
    const name = (known ? m![2] : l).replace(/\s*\|\s*/g, "\n");
    const e = entryFrom({ name, kind: known ? m![1] : "place" }, `Line ${i + 1}`, errors);
    if (e) entries.push(e);
  });
  return { entries, errors };
}
