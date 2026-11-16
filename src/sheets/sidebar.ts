/**
 * Crew sidebar (screen-fixed OBR popover): a strip of initials squares; clicking
 * one opens that runner's sheet beside it. Scene items are the source of truth;
 * the GM edits through the backend, players are read-only. Anyone can roll.
 */
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/900.css";
import "@fontsource/share-tech-mono/400.css";
import "./sidebar.css";
import OBR from "@owlbear-rodeo/sdk";
import { makeRoll } from "../dice/roll";
import { askBonus, askVr, ExtraDie } from "./rollAsk";
import { Backend, Entry, mockBackend, obrBackend } from "./backend";
import { esc, markdownToHtml } from "./markdownHtml";
import { parseDoc } from "./doc";
import {
  SHEET_POPOVER,
  SHEET_POPOVER_POS,
  SIDEBAR_POPOVER,
  State,
  STATE_COL,
  STATE_NAME,
  STATE_SHORT,
  STATES,
  Sheet,
  STRUCTURE_KEYS,
  Structure,
  Track,
  TRACKS,
  validateStructure,
} from "./model";
import { startMonitors } from "./monitors";

const backend: Backend = OBR.isAvailable ? obrBackend() : mockBackend();
// Standalone preview (no OBR): neutral background, placed like the popover (left, vertically centred).
if (!OBR.isAvailable) document.documentElement.classList.add("standalone");
/**
 * In OBR the strip and the open sheet are two popovers showing this page ("strip" / "sheet",
 * see SHEET_POPOVER); the standalone preview shows both in one page ("all").
 */
const PART: "strip" | "sheet" | "all" = OBR.isAvailable
  ? new URLSearchParams(location.search).get("part") === "sheet"
    ? "sheet"
    : "strip"
  : "all";
document.documentElement.classList.add(`part-${PART}`);
const POPOVER = PART === "sheet" ? SHEET_POPOVER : SIDEBAR_POPOVER;

const store = {
  get(k: string, d: string) {
    try {
      return localStorage.getItem("vtt-sheets-" + k) ?? d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem("vtt-sheets-" + k, v);
    } catch {
      /* private mode */
    }
  },
};

let entries: Entry[] | null = null;
let screenH = 900;
let gm = false;
let open = store.get("open", "");
let lastData = "";
let pending = false;
/** Sheet id whose structure JSON editor is open. */
let jsonOpen = "";
/** Sheet id whose body document editor is open. */
let docOpen = "";

const app = document.getElementById("app")!;
const MARKS = "<b></b>".repeat(5);
const winHTML = (body: string, plate = true) =>
  `${plate ? '<div class="plate"></div>' : ""}<div class="frame"><div class="inner">${body}</div></div>`;
const entryOf = (id: string) => entries?.find((e) => e.sheet.id === id);

// ---------- pieces ----------
function die(d: number, kind: "a" | "s" | "p") {
  const filled = (d - 2) / 2;
  const pips = Array.from({ length: 5 }, (_, i) => `<i class="${i < filled ? "" : "off"}"></i>`).join("");
  return `<span class="die ${kind}"><em><b>D${d}</b><span class="pp">${pips}</span></em></span>`;
}
const RL = '<span class="rl">ROLL</span>';
function skillsBlock(s: Sheet) {
  let h = "";
  s.attributes.forEach((a, ai) => {
    let g = `<div class="att" data-roll="${ai}" title="Roll ${esc(a.name)} (right click: bonus dice)">${die(a.die, "a")}<b>${esc(a.name)}</b>${RL}</div>`;
    a.skills.forEach((sk, si) => {
      const cont = si < a.skills.length - 1 ? " cont" : ""; // more skills follow: the attribute trunk passes this row
      g += `<div class="sub${cont}" data-roll="${ai}.${si}" title="Roll ${esc(a.name)} + ${esc(sk.name)} (right click: bonus dice)">${die(sk.die, "s")}<span class="nm">${esc(sk.name)}</span>${RL}</div>`;
      g += sk.specializations
        .map(
          (p, pi) =>
            `<div class="specrow${cont}" data-roll="${ai}.${si}.${pi}" title="Roll ${esc(a.name)} + ${esc(sk.name)} + ${esc(p.name)} (right click: bonus dice)"><i class="elb"></i>${die(p.die, "p")}${esc(p.name)}${RL}</div>`,
        )
        .join("");
    });
    h += `<div class="ag">${g}</div>`;
  });
  return `<div class="md"><h2>Fertigkeiten</h2></div><div class="skl">${h}</div>`;
}
function nameBlock(s: Sheet) {
  return `<div class="nb-list">${s.meta.map(([k, v]) => `<div><label>${esc(k)}</label><b>${esc(v)}</b></div>`).join("")}</div>`;
}
function vitals(s: Sheet) {
  return `<div class="vit">${TRACKS.map(([tr, label, kind]) => {
    const st = s.cond[tr].state;
    return `<div class="vrow s-${st}" style="--sc:${STATE_COL[st]}"><span class="vl">${label}</span>
      <span class="mon"><canvas class="mon-c" data-k="${kind}" data-who="${esc(s.id)}" data-tr="${tr}"></canvas><span class="ro"></span></span>
      <span class="st" title="${STATE_NAME[st]}">${STATE_SHORT[st]}</span>
      <span class="ct ${gm ? "edit" : ""}" ${gm ? 'contenteditable="plaintext-only" spellcheck="false"' : ""} data-ct="${tr}">${esc(s.cond[tr].text)}</span>
      <div class="seg gmonly">${STATES.map((x) => `<button data-st="${tr}|${x}" class="${x === st ? "on" : ""}" style="--sc:${STATE_COL[x]}" title="${STATE_NAME[x]}">${STATE_SHORT[x]}</button>`).join("")}</div></div>`;
  }).join("")}</div>`;
}
function nuyenBlock(s: Sheet) {
  // Credstick: solid ¥ tab + plain outlined value; GM steps grouped minus | plus.
  const steps = [-1000, -500, -100, 100, 500, 1000];
  const label = (d: number) => `${d > 0 ? "+" : "−"}${Math.abs(d) >= 1000 ? Math.abs(d) / 1000 + "k" : Math.abs(d)}`;
  return `<div class="ny"><span class="ny-sym">¥</span><div class="ny-body"><label>${s.shared ? "NUYEN · CREW" : "NUYEN"}</label><span class="nv ${gm ? "edit" : ""}" data-ny>${s.nuyen.toLocaleString("de-DE")}</span></div>
    <div class="q gmonly">${steps.map((d) => `<button data-nyd="${d}"${d === 100 ? ' class="pl"' : ""}>${label(d)}</button>`).join("")}</div></div>`;
}
/** The sheet body: its Markdown document laid out in columns, with the structured parts at their placeholders. */
function bodyBlock(s: Sheet) {
  const cols = parseDoc(s.doc, { name: !s.shared && s.meta.length > 0, skills: s.attributes.length > 0, nuyen: true });
  const html = cols
    .map(
      (col) =>
        `<div class="col">${col
          .map((b) =>
            b.kind === "md"
              ? `<div class="md">${markdownToHtml(b.src)}</div>`
              : b.kind === "name"
                ? nameBlock(s)
                : b.kind === "skills"
                  ? skillsBlock(s)
                  : `<div class="ny-foot">${nuyenBlock(s)}</div>`,
          )
          .join("")}</div>`,
    )
    .join("");
  return (
    `<div class="body" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr))">${html}</div>` +
    `<div class="tools gmonly"><button class="add" data-doc>EDIT TEXT &amp; LAYOUT</button><button class="add" data-json>EDIT SHEET DATA</button></div>`
  );
}
function docEditor(s: Sheet) {
  return `<div class="docbox"><div class="md"><h2>Text &amp; layout (Markdown)</h2></div>
    <p class="hint"><code>&lt;!-- column --&gt;</code> starts a new column · <code>&lt;!-- name --&gt;</code> <code>&lt;!-- skills --&gt;</code> <code>&lt;!-- nuyen --&gt;</code> place the name block, skills and nuyen (left out: name and skills open the first column, nuyen closes the last)</p>
    <textarea spellcheck="false" data-doctext>${esc(s.doc)}</textarea>
    <div class="ea"><button data-docsave>SAVE</button><button data-doccancel>CANCEL</button></div></div>`;
}
function structureOf(s: Sheet): Structure {
  const out: Record<string, unknown> = {};
  for (const k of STRUCTURE_KEYS) out[k] = s[k];
  return out as Structure;
}
function jsonEditor(s: Sheet) {
  return `<div class="jsonbox"><div class="md"><h2>Sheet data (JSON)</h2></div>
    <textarea spellcheck="false" data-jsontext>${esc(JSON.stringify(structureOf(s), null, 2))}</textarea>
    <div class="err" data-jsonerr></div>
    <div class="ea"><button data-jsonsave>SAVE</button><button data-jsoncancel>CANCEL</button></div></div>`;
}

/** GM: the sheet's text item does not hold a valid sheet; edits wait until it is fixed. */
function errorBanner(s: Sheet, error: string) {
  return `<div class="sheet-err"><b>SHEET TEXT INVALID</b> Showing the last valid version; changes here are blocked until the text item “Sheet: ${esc(s.handle)}” left of the map is fixed.<code>${esc(error)}</code></div>`;
}

// ---------- render ----------
function renderSide() {
  if (!entries) return "";
  const runners = entries.filter((e) => !e.sheet.shared);
  const shared = entries.filter((e) => e.sheet.shared);
  const sq = runners
    .map(({ sheet: s }) => {
      const tip = `${s.handle} · körperlich: ${STATE_NAME[s.cond.k.state]} · psychisch: ${STATE_NAME[s.cond.p.state]}`;
      return `<div class="sqw ${open === s.id ? "on" : ""}" data-open="${esc(s.id)}" title="${esc(tip)}" style="--pc:${s.color}"><i class="ring"></i><button class="sq inlines">${esc(s.initials)}<span class="ib"><i class="s-${s.cond.k.state}">${MARKS}</i><i class="s-${s.cond.p.state}">${MARKS}</i></span></button></div>`;
    })
    .join("");
  const sh = shared
    .map(({ sheet: s }) => `<div class="sqw ${open === s.id ? "on" : ""}" data-open="${esc(s.id)}" title="${esc(s.handle)}" style="--pc:${s.color}"><i class="ring"></i><button class="sq">${esc(s.initials)}</button></div>`)
    .join("");
  const create = gm && !entries.length ? `<button class="create" data-create>CREATE CREW</button>` : "";
  return `<aside id="side" class="w">${winHTML(`<div class="stripcap">CREW</div><div class="sqs">${sq}${sq && sh ? "<hr>" : ""}${sh}${create}</div>`, false)}</aside>`;
}
function renderSheet() {
  const e = open && entryOf(open);
  if (!e) return "";
  const s = e.sheet;
  if (jsonOpen === s.id) {
    return `<section id="sheet" class="w" style="--pc:${s.color}">${winHTML(`<div class="shh"><div class="hn"><h1>${esc(s.handle)}</h1></div></div><div class="sb">${jsonEditor(s)}</div>`)}</section>`;
  }
  const head = `<div class="shh"><div class="hn"><h1>${esc(s.handle)}</h1></div>${s.shared ? "" : vitals(s)}</div>`;
  const body = gm && docOpen === s.id ? docEditor(s) : bodyBlock(s);
  const err = gm && e.error ? errorBanner(s, e.error) : "";
  return `<section id="sheet" class="w" style="--pc:${s.color}">${winHTML(`${head}<div class="sb">${err}${body}</div>`)}</section>`;
}
/** Tab+Hatch: the hatch starts as far right of the name as the name is right of the tab strip. */
function hatchStart() {
  const h = app.querySelector<HTMLElement>(".shh");
  const n = h?.querySelector(".hn");
  if (!h || !n) return;
  const hr = h.getBoundingClientRect();
  const nr = n.getBoundingClientRect();
  const gap = nr.left - hr.left - 20;
  h.style.setProperty("--hx", `${Math.round(nr.right - hr.left + gap)}px`);
}
/** True while the GM is typing somewhere; re-rendering would throw the input away. */
function editing() {
  const a = document.activeElement as HTMLElement | null;
  return !!(a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA")) || !!app.querySelector("[data-doctext],[data-jsontext]");
}
function render(force = false) {
  if (!force && editing()) {
    pending = true;
    return;
  }
  pending = false;
  document.body.classList.toggle("player", !gm);
  // Forget a sheet that no longer exists, but not while the scene is still loading.
  if (open && entries && entries.length && !entryOf(open)) open = "";
  const scroll = app.querySelector("#sheet .inner")?.scrollTop ?? 0;
  const show = entries && (entries.length || gm);
  app.innerHTML = !show ? "" : PART === "strip" ? renderSide() : PART === "sheet" ? renderSheet() : renderSide() + renderSheet();
  const inner = app.querySelector("#sheet .inner");
  if (inner) inner.scrollTop = scroll;
  hatchStart();
  placeSheet();
}
/** Sheet popover: its top is fixed on screen, so centre the sheet vertically inside it. */
function placeSheet() {
  if (PART !== "sheet") return;
  const sheet = app.querySelector<HTMLElement>("#sheet");
  if (!sheet) return;
  const off = Math.max(0, Math.round((screenH - sheet.offsetHeight) / 2 - SHEET_POPOVER_POS.top));
  app.style.paddingTop = `${off}px`;
}
const afterEdit = () => {
  if (pending) render(true);
};

const stateOf = (cv: HTMLCanvasElement): State | null => {
  const s = entryOf(cv.dataset.who ?? "")?.sheet;
  return s ? s.cond[cv.dataset.tr as Track].state : null;
};
startMonitors(app, stateOf);

// ---------- popover size follows the content ----------
async function updateScreen() {
  const { width, height } = await backend.screenSize();
  const changed = height !== screenH;
  screenH = height;
  document.documentElement.style.setProperty("--screen-h", `${height}px`);
  if (changed) placeSheet();
  document.documentElement.style.setProperty("--screen-w", `${width}px`);
}
// The SDK may only be used once OBR is ready (the preview's mock backend is ready at once).
let ready = false;
let lastSize = "";
function boot() {
  ready = true;
  lastSize = "";
  sendSize();
  backend.onRole((isGM) => {
    if (isGM === gm && lastData) return;
    gm = isGM;
    migrate();
    render(true);
  });
  backend.onSheets((next) => {
    const data = JSON.stringify(next);
    if (data === lastData) return; // unrelated scene change (e.g. a window moved)
    lastData = data;
    entries = next;
    migrate();
    render();
  });
  void updateScreen();
  setInterval(() => void updateScreen(), 2000);
}
if (OBR.isAvailable) OBR.onReady(boot);
else boot();
/** Sizes the popover to the content; before OBR is ready this waits for boot(). */
function sendSize() {
  if (!ready) return;
  const r = app.getBoundingClientRect();
  const w = Math.ceil(r.width);
  const h = Math.ceil(r.height);
  const key = `${w}x${h}`;
  if (key === lastSize) return;
  lastSize = key;
  backend.resize(POPOVER, w, h);
}
new ResizeObserver(sendSize).observe(app);
document.fonts?.ready.then(hatchStart);

/** GM only (strip page): sheets stored by earlier versions become text items. */
function migrate() {
  if (!gm || PART === "sheet" || !entries) return;
  void backend.migrateLegacy();
}

// ---------- interaction ----------
function currentEntry() {
  return open ? entryOf(open) : undefined;
}
function update(fn: (s: Sheet) => void) {
  const e = currentEntry();
  if (e) void backend.update(e.itemId, fn);
}
/** Names and die sizes of a roll row ("ai", "ai.si" or "ai.si.pi"), and its VR die if any. */
function rollParts(s: Sheet, path: string) {
  const [ai, si, pi] = path.split(".").map(Number);
  const a = s.attributes[ai];
  if (!a) return null;
  const parts = [a.name.toUpperCase()]; // attributes are shown in capitals everywhere
  const sizes = [a.die];
  // vr_ask applies to everything nested below where it is set; the deepest one wins.
  let vr = a.vr_ask;
  const sk = si !== undefined ? a.skills[si] : undefined;
  if (sk) {
    parts.push(sk.name);
    sizes.push(sk.die);
    vr = sk.vr_ask ?? vr;
    const p = pi !== undefined ? sk.specializations[pi] : undefined;
    if (p) {
      parts.push(p.name);
      sizes.push(p.die);
      vr = p.vr_ask ?? vr;
    }
  }
  return { parts, sizes, vr };
}

function roll(path: string, extras: ExtraDie[] = []) {
  const s = currentEntry()?.sheet;
  const r = s && rollParts(s, path);
  if (!s || !r) return;
  const names = [...r.parts, ...extras.map((e) => e.name)];
  backend.roll(
    makeRoll(`${s.handle} · ${names.join(" + ")}`, s.color, [...r.sizes, ...extras.map((e) => e.size)], Math.random, {
      initials: s.initials,
      names,
      bonus: extras.length || undefined,
    }),
  );
}

/** Left click: roll; a row with vr_ask (own or inherited) asks "In VR?" first. Right click: choose bonus dice. */
async function rollFrom(row: HTMLElement, path: string, choose: boolean) {
  const s = currentEntry()?.sheet;
  const r = s && rollParts(s, path);
  if (!s || !r) return;
  const ctx = { color: s.color, initials: s.initials, what: r.parts.join(" + "), anchor: row, vr: r.vr };
  if (!choose && !r.vr) return roll(path);
  const extras = choose ? await askBonus(ctx) : await askVr({ ...ctx, vr: r.vr! });
  if (extras) roll(path, extras);
}

app.addEventListener("contextmenu", (ev) => {
  const row = (ev.target as HTMLElement).closest<HTMLElement>("[data-roll]");
  if (!row) return;
  ev.preventDefault();
  void rollFrom(row, row.dataset.roll!, true);
});

app.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>(
    "[data-open],[data-create],[data-roll],[data-nyd],[data-ny],[data-st],[data-doc],[data-docsave],[data-doccancel],[data-json],[data-jsonsave],[data-jsoncancel]",
  );
  if (!t) return;
  const d = t.dataset;
  if (d.open !== undefined) {
    open = open === d.open ? "" : d.open;
    jsonOpen = "";
    docOpen = "";
    store.set("open", open); // the sheet popover follows via the storage event
    return render(true);
  }
  if (d.roll !== undefined) return void rollFrom(t, d.roll, false);
  if (!gm) return;
  if (d.create !== undefined) return void backend.createCrew();
  if (d.nyd) return update((s) => void (s.nuyen += Number(d.nyd)));
  if (d.ny !== undefined && !t.querySelector("input")) {
    const s = currentEntry()?.sheet;
    if (!s) return;
    t.innerHTML = `<input value="${s.nuyen}">`;
    const inp = t.querySelector("input")!;
    inp.focus();
    inp.select();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      const v = parseInt(inp.value.replace(/[^\d-]/g, ""), 10);
      if (ok && !isNaN(v) && v !== s.nuyen) update((x) => void (x.nuyen = v));
      render(true);
    };
    inp.addEventListener("keydown", (k) => {
      if (k.key === "Enter") finish(true);
      if (k.key === "Escape") finish(false);
    });
    inp.addEventListener("blur", () => finish(true));
    return;
  }
  if (d.st) {
    const [tr, st] = d.st.split("|") as [Track, State];
    return update((s) => void (s.cond[tr].state = st));
  }
  if (d.json !== undefined) {
    jsonOpen = open;
    return render(true);
  }
  if (d.jsoncancel !== undefined) {
    jsonOpen = "";
    return render(true);
  }
  if (d.jsonsave !== undefined) {
    const s = currentEntry()?.sheet;
    const text = app.querySelector<HTMLTextAreaElement>("[data-jsontext]")!.value;
    const err = app.querySelector<HTMLElement>("[data-jsonerr]")!;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (e) {
      err.textContent = `Invalid JSON: ${(e as Error).message}`;
      return;
    }
    const problem = validateStructure(value, !!s?.shared);
    if (problem) {
      err.textContent = problem;
      return;
    }
    const v = value as Structure;
    update((x) => {
      for (const k of STRUCTURE_KEYS) (x as unknown as Record<string, unknown>)[k] = v[k];
    });
    jsonOpen = "";
    return render(true);
  }
  if (d.doc !== undefined) {
    docOpen = open;
    render(true);
    const ta = app.querySelector<HTMLTextAreaElement>("[data-doctext]");
    ta?.focus();
    ta?.setSelectionRange(0, 0);
    return;
  }
  if (d.doccancel !== undefined) {
    docOpen = "";
    return render(true);
  }
  if (d.docsave !== undefined) {
    const value = app.querySelector<HTMLTextAreaElement>("[data-doctext]")!.value;
    docOpen = "";
    update((x) => void (x.doc = value.endsWith("\n") ? value : value + "\n"));
    return render(true);
  }
});

app.addEventListener("focusout", (ev) => {
  const ct = (ev.target as HTMLElement).closest?.<HTMLElement>("[data-ct]");
  if (!ct) return;
  const tr = ct.dataset.ct as Track;
  const text = ct.textContent?.trim() || "—";
  const s = currentEntry()?.sheet;
  if (s && s.cond[tr].text !== text) update((x) => void (x.cond[tr].text = text));
  setTimeout(afterEdit, 0);
});
app.addEventListener("keydown", (ev) => {
  const el = ev.target as HTMLElement;
  if (ev.key === "Enter" && el.closest?.("[data-ct]")) {
    ev.preventDefault();
    el.blur();
  }
});

// The strip and sheet popovers are separate pages of the same origin: the strip writes the
// open sheet to localStorage, the sheet page follows it.
window.addEventListener("storage", (ev) => {
  if (ev.key !== "vtt-sheets-open") return;
  const next = ev.newValue ?? "";
  if (next === open) return;
  open = next;
  jsonOpen = "";
  docOpen = "";
  render(true);
});
