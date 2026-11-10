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
import { Backend, Entry, mockBackend, obrBackend } from "./backend";
import { esc, markdownToHtml } from "./markdownHtml";
import {
  dieSize,
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

const app = document.getElementById("app")!;
const fmtY = (n: number) => n.toLocaleString("de-DE") + " ¥";
const MARKS = "<b></b>".repeat(5);
const winHTML = (body: string, plate = true) =>
  `${plate ? '<div class="plate"></div>' : ""}<div class="frame"><div class="inner">${body}</div></div>`;
const entryOf = (id: string) => entries?.find((e) => e.sheet.id === id);

// ---------- pieces ----------
function die(d: string, kind: "a" | "s" | "p") {
  const filled = (dieSize(d) - 2) / 2;
  const pips = Array.from({ length: 5 }, (_, i) => `<i class="${i < filled ? "" : "off"}"></i>`).join("");
  return `<span class="die ${kind}"><em><b>${esc(d)}</b><span class="pp">${pips}</span></em></span>`;
}
const RL = '<span class="rl">ROLL</span>';
function skillsBlock(s: Sheet) {
  let h = "";
  s.attributes.forEach((a, ai) => {
    let g = `<div class="att" data-roll="${ai}" title="Roll ${esc(a.name)}">${die(a.die, "a")}<b>${esc(a.name)}</b>${RL}</div>`;
    a.skills.forEach((sk, si) => {
      const cont = si < a.skills.length - 1 ? " cont" : ""; // more skills follow: the attribute trunk passes this row
      g += `<div class="sub${cont}" data-roll="${ai}.${si}" title="Roll ${esc(a.name)} + ${esc(sk.name)}">${die(sk.die, "s")}<span class="nm">${esc(sk.name)}</span>${RL}</div>`;
      g += sk.specs
        .map(
          (p, pi) =>
            `<div class="specrow${cont}" data-roll="${ai}.${si}.${pi}" title="Roll ${esc(a.name)} + ${esc(sk.name)} + ${esc(p.name)}"><i class="elb"></i>${die(p.die, "p")}${esc(p.name)}${RL}</div>`,
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
  return `<div class="ny"><label>${s.shared ? "NUYEN · CREW" : "NUYEN"}</label><span class="nv ${gm ? "edit" : ""}" data-ny>${fmtY(s.nuyen)}</span>
    <div class="q gmonly">${[-500, -100, 100, 500].map((d) => `<button data-nyd="${d}">${d > 0 ? "+" : "−"}${Math.abs(d)}</button>`).join("")}</div></div>`;
}
/** Sections fill n columns greedily (shortest column first, by estimated height), keeping source order per column. */
function sectionsBlock(s: Sheet, n: number) {
  const cols = Array.from({ length: n }, () => ({ h: 0, html: "" }));
  s.sections.forEach((src, i) => {
    const c = cols.reduce((a, b) => (b.h < a.h ? b : a));
    const foot = /^## Ausrüstung\b/m.test(src) ? `<div class="ny-foot">${nuyenBlock(s)}</div>` : "";
    c.html += `<section class="sbox" data-sec="${i}"><div class="md">${markdownToHtml(src)}</div>${foot}<button class="ed gmonly" data-ed>EDIT</button></section>`;
    c.h += src.split("\n").reduce((a, l) => a + Math.ceil(Math.max(1, l.length) / 40), 0) * 24 + 40;
  });
  // Nuyen must always be reachable, even without an Ausrüstung section.
  const orphan = s.sections.some((src) => /^## Ausrüstung\b/m.test(src)) ? "" : `<div class="ny-foot">${nuyenBlock(s)}</div>`;
  return (
    `<div class="secs" style="grid-template-columns:repeat(${n},1fr)">${cols.map((c) => `<div>${c.html}</div>`).join("")}</div>${orphan}` +
    `<div class="tools gmonly"><button class="add" data-add>+ ADD SECTION</button><button class="add" data-json>EDIT SHEET DATA</button></div>`
  );
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
  if (s.shared) {
    return `<section id="sheet" class="w" style="--pc:${s.color}">${winHTML(`<div class="shh"><div class="hn"><h1>${esc(s.handle)}</h1></div></div>
      <div class="sb">${sectionsBlock(s, Math.max(1, Math.min(3, s.sections.length)))}</div>`)}</section>`;
  }
  return `<section id="sheet" class="w" style="--pc:${s.color}">${winHTML(`<div class="shh"><div class="hn"><h1>${esc(s.handle)}</h1></div>${vitals(s)}</div>
    <div class="sb"><div class="cols"><div>${nameBlock(s)}${skillsBlock(s)}</div><div>${sectionsBlock(s, 2)}</div></div></div>`)}</section>`;
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
  return !!(a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA")) || !!app.querySelector(".sbox textarea");
}
function render(force = false) {
  if (!force && editing()) {
    pending = true;
    return;
  }
  pending = false;
  document.body.classList.toggle("player", !gm);
  if (open && !entryOf(open)) open = "";
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
function boot() {
  backend.onRole((isGM) => {
    if (isGM === gm && lastData) return;
    gm = isGM;
    render(true);
  });
  backend.onSheets((next) => {
    const data = JSON.stringify(next);
    if (data === lastData) return; // unrelated scene change (e.g. a window moved)
    lastData = data;
    entries = next;
    render();
  });
  void updateScreen();
  setInterval(() => void updateScreen(), 2000);
}
if (OBR.isAvailable) OBR.onReady(boot);
else boot();
let lastSize = "";
new ResizeObserver(() => {
  const r = app.getBoundingClientRect();
  const w = Math.ceil(r.width);
  const h = Math.ceil(r.height);
  const key = `${w}x${h}`;
  if (key === lastSize) return;
  lastSize = key;
  backend.resize(POPOVER, w, h);
}).observe(app);
document.fonts?.ready.then(hatchStart);

// ---------- interaction ----------
function currentEntry() {
  return open ? entryOf(open) : undefined;
}
function update(fn: (s: Sheet) => void) {
  const e = currentEntry();
  if (e) void backend.update(e.itemId, fn);
}
function roll(path: string) {
  const s = currentEntry()?.sheet;
  if (!s) return;
  const [ai, si, pi] = path.split(".").map(Number);
  const a = s.attributes[ai];
  if (!a) return;
  const parts = [a.name];
  const sizes = [dieSize(a.die)];
  const sk = si !== undefined ? a.skills[si] : undefined;
  if (sk) {
    parts.push(sk.name);
    sizes.push(dieSize(sk.die));
    const p = pi !== undefined ? sk.specs[pi] : undefined;
    if (p) {
      parts.push(p.name);
      sizes.push(dieSize(p.die));
    }
  }
  backend.roll(makeRoll(`${s.handle} · ${parts.join(" + ")}`, s.color, sizes));
}

app.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>(
    "[data-open],[data-create],[data-roll],[data-nyd],[data-ny],[data-st],[data-ed],[data-add],[data-save],[data-cancel],[data-del],[data-json],[data-jsonsave],[data-jsoncancel]",
  );
  if (!t) return;
  const d = t.dataset;
  if (d.open !== undefined) {
    open = open === d.open ? "" : d.open;
    jsonOpen = "";
    store.set("open", open); // the sheet popover follows via the storage event
    return render(true);
  }
  if (d.roll !== undefined) return roll(d.roll);
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
  const box = t.closest<HTMLElement>(".sbox");
  if (d.ed !== undefined && box) {
    const s = currentEntry()?.sheet;
    if (!s) return;
    box.innerHTML = `<textarea spellcheck="false">${esc(s.sections[Number(box.dataset.sec)])}</textarea><div class="ea"><button data-save>SAVE</button><button data-cancel>CANCEL</button><button data-del>DELETE</button></div>`;
    box.querySelector("textarea")!.focus();
    return;
  }
  if (d.save !== undefined && box) {
    const i = Number(box.dataset.sec);
    const value = box.querySelector("textarea")!.value;
    box.innerHTML = "";
    update((s) => void (s.sections[i] = value));
    return render(true);
  }
  if (d.cancel !== undefined) {
    if (box) box.innerHTML = "";
    return render(true);
  }
  if (d.del !== undefined && box) {
    const i = Number(box.dataset.sec);
    box.innerHTML = "";
    update((s) => void s.sections.splice(i, 1));
    return render(true);
  }
  if (d.add !== undefined) return update((s) => void s.sections.push("## Neuer Abschnitt\n- Eintrag"));
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
  render(true);
});
