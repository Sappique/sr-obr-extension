/**
 * Character sheet data model. One scene item per sheet carries a `Sheet` in its
 * metadata under SHEET_KEY; the sidebar renders everything from that.
 */
import seed from "./seed-data.json";

export const ID = "sappique.sr-obr";
export const SHEET_KEY = `${ID}/sheet`;
export const SIDEBAR_POPOVER = `${ID}/sidebar`;
export const DICE_POPOVER = `${ID}/dice`;
export const ROLL_CHANNEL = `${ID}/roll`;

export type State = "ok" | "warn" | "crit" | "down";
export type Track = "k" | "p";
export const STATES: State[] = ["ok", "warn", "crit", "down"];
export const STATE_COL: Record<State, string> = { ok: "#5fcfdc", warn: "#f5e10a", crit: "#ff2848", down: "#8a96a0" };
export const STATE_NAME: Record<State, string> = { ok: "OK", warn: "WARNING", crit: "CRITICAL", down: "DOWN" };
export const STATE_SHORT: Record<State, string> = { ok: "OK", warn: "WRN", crit: "CRT", down: "DWN" };
export const TRACKS: [Track, string, "ecg" | "eeg"][] = [
  ["k", "KÖRPERLICH", "ecg"],
  ["p", "PSYCHISCH", "eeg"],
];

export interface Spec {
  die: string; // e.g. "+D4"
  name: string;
}
export interface Skill {
  die: string;
  name: string;
  specs: Spec[];
}
export interface Attribute {
  die: string;
  name: string;
  skills: Skill[];
}
export interface Condition {
  text: string;
  state: State;
}
export interface Sheet {
  v: 1;
  id: string;
  handle: string;
  initials: string;
  color: string;
  order: number;
  shared?: boolean;
  /** Name block: ordered label/value pairs. */
  meta: [string, string][];
  attributes: Attribute[];
  cond: Record<Track, Condition>;
  nuyen: number;
  /** Markdown sections; the one starting with "## Ausrüstung" also shows nuyen. */
  sections: string[];
}

/** The parts the GM edits as raw JSON (they rarely change). */
export const STRUCTURE_KEYS = ["handle", "initials", "color", "meta", "attributes"] as const;
export type Structure = Pick<Sheet, (typeof STRUCTURE_KEYS)[number]>;

export const dieSize = (die: string) => parseInt(die.replace(/\D/g, ""), 10);

/** Validates a JSON structure edit; returns an error message or null. */
export function validateStructure(value: unknown, shared: boolean): string | null {
  if (!value || typeof value !== "object") return "Not an object.";
  const v = value as Record<string, unknown>;
  for (const k of ["handle", "initials", "color"]) if (typeof v[k] !== "string" || !(v[k] as string).trim()) return `"${k}" must be a non-empty string.`;
  if (!/^#[0-9a-fA-F]{6}$/.test(v.color as string)) return '"color" must look like "#3fd87f".';
  if (!Array.isArray(v.meta) || v.meta.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((x) => typeof x !== "string")))
    return '"meta" must be a list of ["Label", "Value"] pairs.';
  if (!Array.isArray(v.attributes)) return '"attributes" must be a list.';
  if (shared && v.attributes.length) return "The shared sheet has no attributes.";
  const okDie = (d: unknown, plus = false) => typeof d === "string" && (plus ? /^\+D(4|6|8|10|12)$/ : /^D(4|6|8|10|12)$/).test(d);
  for (const a of v.attributes as Attribute[]) {
    if (!a || !okDie(a.die) || typeof a.name !== "string" || !Array.isArray(a.skills)) return `Attribute ${JSON.stringify(a?.name)}: needs "die" (D4…D12), "name", "skills".`;
    for (const s of a.skills) {
      if (!s || !okDie(s.die) || typeof s.name !== "string" || !Array.isArray(s.specs)) return `Skill ${JSON.stringify(s?.name)}: needs "die" (D4…D12), "name", "specs".`;
      for (const p of s.specs) if (!p || !okDie(p.die, true) || typeof p.name !== "string") return `Specialisation ${JSON.stringify(p?.name)}: needs "die" (+D4…+D12) and "name".`;
    }
  }
  return null;
}

// ---------- seed (designs/assets/data.js) ----------

type RawItem = [string, string];
interface RawChar {
  id: string;
  handle: string;
  meta: Record<string, string | number>;
  condition: Record<string, string>;
  skills: [string, string, RawItem[]][];
  special?: { title: string; items: RawItem[] };
  extra?: { title: string; items: RawItem[] };
  contacts?: RawItem[];
  lifestyle?: Record<string, string>;
  gear?: [string, string[]][];
  nuyen: number;
}

/** HANDOFF runner colours (data.js has older ones). */
const RUNNER_COLOR: Record<string, string> = { phlox: "#3fd87f", hawk: "#ff8a1f", peppermint: "#a46cff" };
const INITIALS: Record<string, string> = { phlox: "PH", hawk: "HK", peppermint: "PM" };
const SEED_STATE: Record<string, [State, State]> = { phlox: ["ok", "ok"], hawk: ["warn", "ok"], peppermint: ["warn", "ok"] };

function sectionsFor(c: Partial<RawChar>): string[] {
  const out: string[] = [];
  const list = (b?: { title: string; items: RawItem[] }) => b && `## ${b.title}\n` + b.items.map(([n, d]) => `- **${n}:** ${d}`).join("\n");
  if (c.special) out.push(list(c.special)!);
  if (c.extra) out.push(list(c.extra)!);
  if (c.contacts?.length) out.push("## Kontakte\n" + c.contacts.map(([n, r]) => `- **${n}** – ${r}`).join("\n"));
  if (c.lifestyle) {
    const l = c.lifestyle;
    out.push(`## Lebensstil\n> [!Wohnort] ${l.Wohnort}\n> Ausgaben **${l.Ausgaben}** · Miete **${l.Miete}**`);
  }
  if (c.gear?.length) out.push("## Ausrüstung\n" + c.gear.map(([g, items]) => `### ${g}\n` + items.map((i) => `- ${i}`).join("\n")).join("\n"));
  return out;
}

function attributesFor(skills: RawChar["skills"]): Attribute[] {
  return skills.map(([die, name, subs]) => {
    const out: Skill[] = [];
    for (const [d, n] of subs) {
      if (d.startsWith("+") && out.length) out[out.length - 1].specs.push({ die: d, name: n });
      else out.push({ die: d, name: n, specs: [] });
    }
    return { die, name, skills: out };
  });
}

export function seedCrew(): Sheet[] {
  const chars = seed.characters as unknown as RawChar[];
  const sheets: Sheet[] = chars.map((c, i) => ({
    v: 1,
    id: c.id,
    handle: c.handle,
    initials: INITIALS[c.id] ?? c.handle.slice(0, 2).toUpperCase(),
    color: RUNNER_COLOR[c.id] ?? "#f5e10a",
    order: i,
    meta: Object.entries(c.meta).map(([k, v]) => [k, String(v)] as [string, string]),
    attributes: attributesFor(c.skills),
    cond: {
      k: { text: c.condition["körperlich"], state: SEED_STATE[c.id]?.[0] ?? "ok" },
      p: { text: c.condition["psychisch"], state: SEED_STATE[c.id]?.[1] ?? "ok" },
    },
    nuyen: c.nuyen,
    sections: sectionsFor(c),
  }));
  const s = seed.shared as unknown as Partial<RawChar> & { nuyen: number };
  sheets.push({
    v: 1,
    id: "shared",
    handle: "Gemeinsam",
    initials: "G",
    color: "#f5e10a",
    order: 99,
    shared: true,
    meta: [],
    attributes: [],
    cond: { k: { text: "", state: "ok" }, p: { text: "", state: "ok" } },
    nuyen: s.nuyen,
    sections: sectionsFor(s),
  });
  return sheets;
}
