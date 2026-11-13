/**
 * Character sheet constants and the seed crew. The sheet schema and its JSON text form live in
 * schema.ts; every sheet is stored as JSON in a text item in the scene (backend.ts).
 */
import seed from "./seed-data.json";
import { docFromSections } from "./doc";
import { normalCase, type Attribute, type Sheet, type Skill, type State, type Track } from "./schema";

export const ID = "sappique.sr-obr";
export const SHEET_KEY = `${ID}/sheet`;
export const SIDEBAR_POPOVER = `${ID}/sidebar`;
/**
 * The open sheet lives in its own popover, anchored at a fixed top-left screen position.
 * OBR applies a new popover height a few frames before it re-centres the popover, so a
 * centred popover that changes height visibly jumps. Keeping the strip in a popover of
 * constant size and growing the sheet popover only to the right and down avoids that.
 */
export const SHEET_POPOVER = `${ID}/sheet`;
/** Screen position of the sheet popover: left edge = sheet shadow plate, top above any sheet. */
export const SHEET_POPOVER_POS = { left: 98, top: 60 };
export const DICE_POPOVER = `${ID}/dice`;
/** Space kept free right of the dice popups: OBR's right toolbar and its "5ft" grid-scale button. */
export const DICE_RIGHT_GAP = 80;
export const DICE_BOTTOM_GAP = 16;
export const ROLL_CHANNEL = `${ID}/roll`;

export { DIE_SIZES, STATES, STRUCTURE_KEYS, validateStructure } from "./schema";
export type { Attribute, Condition, Sheet, Skill, Specialization, State, Structure, Track } from "./schema";
export const STATE_COL: Record<State, string> = { ok: "#5fcfdc", warn: "#f5e10a", crit: "#ff2848", down: "#8a96a0" };
export const STATE_NAME: Record<State, string> = { ok: "OK", warn: "WARNING", crit: "CRITICAL", down: "DOWN" };
export const STATE_SHORT: Record<State, string> = { ok: "OK", warn: "WRN", crit: "CRT", down: "DWN" };
export const TRACKS: [Track, string, "ecg" | "eeg"][] = [
  ["k", "KÖRPERLICH", "ecg"],
  ["p", "PSYCHISCH", "eeg"],
];

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
    // Old section form; docFromSections lays it out as before and turns it into a plain list.
    const l = c.lifestyle;
    out.push(`## Lebensstil\n> [!Wohnort] ${l.Wohnort}\n> Ausgaben **${l.Ausgaben}** · Miete **${l.Miete}**`);
  }
  if (c.gear?.length) out.push("## Ausrüstung\n" + c.gear.map(([g, items]) => `### ${g}\n` + items.map((i) => `- ${i}`).join("\n")).join("\n"));
  return out;
}

const dieOf = (d: string) => parseInt(d.replace(/\D/g, ""), 10); // data.js writes "D8", specialisations "+D4"
function attributesFor(skills: RawChar["skills"]): Attribute[] {
  return skills.map(([die, name, subs]) => {
    const out: Skill[] = [];
    for (const [d, n] of subs) {
      if (d.startsWith("+") && out.length) out[out.length - 1].specializations.push({ die: dieOf(d), name: n });
      else out.push({ die: dieOf(d), name: n, specializations: [] });
    }
    return { die: dieOf(die), name: normalCase(name), skills: out };
  });
}

export function seedCrew(): Sheet[] {
  const chars = seed.characters as unknown as RawChar[];
  const sheets: Sheet[] = chars.map((c, i) => ({
    v: 2,
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
    doc: docFromSections(sectionsFor(c), false),
  }));
  const s = seed.shared as unknown as Partial<RawChar> & { nuyen: number };
  sheets.push({
    v: 2,
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
    doc: docFromSections(sectionsFor(s), true),
  });
  return sheets;
}
