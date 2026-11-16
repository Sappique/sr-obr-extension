/**
 * The sheet schema and its JSON text form. Every sheet is stored as JSON in a text item in the
 * scene (see backend.ts), readable and editable with OBR's own text tool, so this module parses
 * hand-edited text with clear errors, upgrades older versions and formats readable JSON.
 * No runtime imports except doc.ts, so node's test runner can load it directly.
 */
import { docFromSections } from "./doc.ts";

export type State = "ok" | "warn" | "crit" | "down";
export type Track = "k" | "p";
export const STATES: State[] = ["ok", "warn", "crit", "down"];
export const DIE_SIZES = [4, 6, 8, 10, 12];

export interface Specialization {
  die: number;
  name: string;
}
export interface Skill {
  die: number;
  name: string;
  specializations: Specialization[];
}
export interface Attribute {
  die: number;
  name: string;
  skills: Skill[];
}
export interface Condition {
  text: string;
  state: State;
}
export interface Sheet {
  v: 2;
  id: string;
  handle: string;
  initials: string;
  color: string;
  order: number;
  shared?: boolean;
  nuyen: number;
  cond: Record<Track, Condition>;
  /** Name block: ordered label/value pairs. */
  meta: [string, string][];
  attributes: Attribute[];
  /** The sheet body as one Markdown document with layout comments (see doc.ts). */
  doc: string;
  /** If set, a roll first asks "In VR?"; yes adds a die of this size as "VR Bonus". */
  vr_ask?: number;
}

/** The parts the GM edits as raw JSON in the sheet (they rarely change). */
export const STRUCTURE_KEYS = ["handle", "initials", "color", "meta", "attributes", "vr_ask"] as const;
export type Structure = Pick<Sheet, (typeof STRUCTURE_KEYS)[number]>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** Attribute names are stored in normal case ("Physisch"); the sheet and the dice show them in capitals. */
export const normalCase = (name: string) => (name && name === name.toUpperCase() ? name[0] + name.slice(1).toLowerCase() : name);

/** v1 wrote dice as "D8" (specialisations "+D4"), called specialisations "specs" and stored
 *  attribute names in capitals. */
function v1Die(d: unknown) {
  return typeof d === "string" && /^\+?D\d+$/.test(d) ? parseInt(d.replace(/\D/g, ""), 10) : d;
}
function upgradeV1(s: Obj): Obj {
  const attributes = Array.isArray(s.attributes)
    ? s.attributes.map((a: Obj) => ({
        die: v1Die(a?.die),
        name: typeof a?.name === "string" ? normalCase(a.name) : a?.name,
        skills: Array.isArray(a?.skills)
          ? a.skills.map((k: Obj) => ({
              die: v1Die(k?.die),
              name: k?.name,
              specializations: Array.isArray(k?.specs) ? k.specs.map((p: Obj) => ({ die: v1Die(p?.die), name: p?.name })) : k?.specs,
            }))
          : a?.skills,
      }))
    : s.attributes;
  const doc = typeof s.doc === "string" ? s.doc : docFromSections(Array.isArray(s.sections) ? (s.sections as string[]) : [], !!s.shared);
  const out: Obj = { ...s, v: 2, attributes, doc };
  delete out.sections;
  return out;
}

/** Checks the structure parts (also used by the in-sheet JSON editor); returns an error or null. */
export function validateStructure(value: unknown, shared: boolean): string | null {
  if (!isObj(value)) return "Not an object.";
  for (const k of ["handle", "initials", "color"]) if (!nonEmpty(value[k])) return `"${k}" must be a non-empty string.`;
  if (!/^#[0-9a-fA-F]{6}$/.test(value.color as string)) return '"color" must look like "#3fd87f".';
  if (!Array.isArray(value.meta) || value.meta.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((x) => typeof x !== "string")))
    return '"meta" must be a list of ["Label", "Value"] pairs.';
  if (!Array.isArray(value.attributes)) return '"attributes" must be a list.';
  if (shared && value.attributes.length) return "The shared sheet has no attributes.";
  const okDie = (d: unknown) => typeof d === "number" && DIE_SIZES.includes(d);
  if (value.vr_ask !== undefined && !okDie(value.vr_ask)) return `"vr_ask" must be a die size (one of ${DIE_SIZES.join(", ")}) or left out.`;
  const dieHint = `"die" (one of ${DIE_SIZES.join(", ")})`;
  for (const a of value.attributes as Obj[]) {
    if (!isObj(a) || !okDie(a.die) || typeof a.name !== "string" || !Array.isArray(a.skills)) return `Attribute ${JSON.stringify(a?.name)}: needs ${dieHint}, "name", "skills".`;
    for (const s of a.skills as Obj[]) {
      if (!isObj(s) || !okDie(s.die) || typeof s.name !== "string" || !Array.isArray(s.specializations))
        return `Skill ${JSON.stringify(s?.name)}: needs ${dieHint}, "name", "specializations".`;
      for (const p of s.specializations as Obj[])
        if (!isObj(p) || !okDie(p.die) || typeof p.name !== "string") return `Specialization ${JSON.stringify(p?.name)}: needs ${dieHint} and "name".`;
    }
  }
  return null;
}

/** Checks a whole sheet (any version); returns the current-version sheet or an error. */
export function toSheet(value: unknown): { sheet: Sheet } | { error: string } {
  if (!isObj(value)) return { error: "The text must be one JSON object." };
  const s = value.v === 1 ? upgradeV1(value) : value;
  if (s.v !== 2) return { error: '"v" must be 2.' };
  if (!nonEmpty(s.id)) return { error: '"id" must be a non-empty string.' };
  if (typeof s.order !== "number") return { error: '"order" must be a number.' };
  if (s.shared !== undefined && typeof s.shared !== "boolean") return { error: '"shared" must be true or false.' };
  if (typeof s.nuyen !== "number" || !Number.isFinite(s.nuyen)) return { error: '"nuyen" must be a number.' };
  if (!isObj(s.cond)) return { error: '"cond" must be an object with "k" and "p".' };
  for (const tr of ["k", "p"]) {
    const c = s.cond[tr];
    if (!isObj(c) || typeof c.text !== "string" || !STATES.includes(c.state as State))
      return { error: `"cond.${tr}" needs "text" and "state" (one of ${STATES.join(", ")}).` };
  }
  if (typeof s.doc !== "string") return { error: '"doc" must be a string (the sheet text in Markdown).' };
  const problem = validateStructure(s, !!s.shared);
  if (problem) return { error: problem };
  return { sheet: s as unknown as Sheet };
}

/** Parses the text of a sheet text item. */
export function parseSheetText(text: string): { sheet: Sheet } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { error: `Invalid JSON: ${(e as Error).message}` };
  }
  return toSheet(value);
}

/** Field order of the stored JSON: small, often changed fields first, the long body last. */
const ORDER = ["v", "id", "handle", "initials", "color", "order", "shared", "nuyen", "cond", "meta", "attributes", "doc"];

/** Readable JSON: two-space indentation, but anything that fits on one line (≤ 100 chars) stays on it. */
export function formatSheet(sheet: Sheet): string {
  const ordered: Obj = {};
  for (const k of ORDER) if ((sheet as unknown as Obj)[k] !== undefined) ordered[k] = (sheet as unknown as Obj)[k];
  for (const [k, v] of Object.entries(sheet)) if (!(k in ordered) && v !== undefined) ordered[k] = v;
  return format(ordered, "", 0) + "\n";
}
function format(v: unknown, indent: string, keyLen: number): string {
  const flat = JSON.stringify(v);
  if (!v || typeof v !== "object" || indent.length + keyLen + flat.length <= 100) return flat;
  const inner = indent + "  ";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return `[\n${v.map((x) => inner + format(x, inner, 0)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(v as Obj);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${format(x, inner, k.length + 4)}`).join(",\n")}\n${indent}}`;
}
