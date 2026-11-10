/**
 * Dice roll popups, shown for everyone in a popover at the bottom right.
 * Design and behaviour: designs/17-dice-roller.html (logic copied from there).
 * Every client receives the same RollMessage (final values + seed) and plays:
 *   tumble + numbers: each face turns counter-clockwise around its centroid while its number
 *     changes, the dice stop one by one and land upright
 *   each other die on its max face turns into "+1", flies into the base die, which pulses and
 *     counts up; the total appears in the yellow result plaque
 *   8 s after arrival the popup collapses to one line, 10 s later that line slides out
 *     (both fixed on arrival, never earlier than an older roll, so older rolls always go first)
 * Newest roll on top; the stack is bottom-anchored, so older rolls keep their place.
 *
 * Popover size: OBR applies a new popover width/height one frame BEFORE it moves the popover to keep
 * its bottom-right corner on the anchor, so every resize while something is visible makes the content
 * jump for a frame. The popover therefore only changes size while nothing is visible: it gets one
 * fixed "reserved" size when the first roll arrives and goes back to 0×0 once the last line has left.
 * Content always fits that box: wide rolls truncate names, and when a new roll does not fit, the
 * oldest roll collapses (or the oldest line leaves) early. See resize evidence in the commit message.
 */
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/900.css";
import "@fontsource/share-tech-mono/400.css";
import "./dice.css";
import OBR from "@owlbear-rodeo/sdk";
import { DICE_POPOVER, ROLL_CHANNEL } from "../sheets/model";
import { evaluate, isRollMessage, makeRoll, RollMessage } from "./roll";

const stack = document.getElementById("stack")!;
if (!OBR.isAvailable) document.documentElement.classList.add("standalone");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- shapes ----------
// Outline per die size (60×60 box). D10 and D12 get a facet line in their lower part, clear of the
// number, so the D10 kite never reads as the D8 diamond. Filled (base) dice hide the facets.
const SHAPES: Record<number, { p: string; f: string; c: [number, number] }> = {} as never;
for (const [size, p, f] of [
  [4, "30,5 56,52 4,52", ""],
  [6, "8,8 52,8 52,52 8,52", ""],
  [8, "30,2 57,30 30,58 3,30", ""],
  [10, "30,2 57,33 30,58 3,33", "13,42 30,50 47,42"],
  [12, "30,2 58,23 47,57 13,57 2,23", "13,57 30,48 47,57"],
] as const) SHAPES[size] = { p, f, c: centroid(p) };

/** Area centroid of a polygon (shoelace), in the 60×60 box. The face rotates around it and the number sits on it. */
function centroid(points: string): [number, number] {
  const v = points.split(" ").map((q) => q.split(",").map(Number));
  let A = 0, cx = 0, cy = 0;
  v.forEach(([x0, y0], i) => {
    const [x1, y1] = v[(i + 1) % v.length];
    const c = x0 * y1 - x1 * y0;
    A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  });
  return [cx / (3 * A), cy / (3 * A)];
}

const FACE_PX = 42;
const NUM_UNITS = (16 * 60) / FACE_PX; // 16 px number in the 60-unit face box
const STAGGER_MS = 260; // dice stop one by one
const GAP = 14; // #stack gap
const PAD = 5; // #stack padding: keeps popup corners clear of OBR's rounded popover clip
const DICE_BOTTOM = 16; // popover bottom gap (src/sheets/background.ts DICE_BOTTOM_GAP)
const COL_MAX = 112; // widest a name may make a die column; longer names truncate
const LABEL_GAP = 8; // minimum space between two neighbouring names
const DICE_GAP = 10; // .dice gap
// End of life, measured from the moment a roll arrives (independent of the roll animation).
const COLLAPSE_MS = 8000; // full popup → one line
const LINE_MS = 10000; // one line → slides out
const ORDER_MS = 180; // minimum spacing that keeps older rolls collapsing / leaving first
let lastCollapse = 0, lastExit = 0;
// Tumble + numbers: lively, every die counter-clockwise.
const TUMBLE = { ms: 600, turns: reduced ? 0 : 1.5 };
const SETTLE_MS = 260; // last part of the turn after the final number shows
const NUM_SWAP_MS = 70; // how often the number changes while rolling
const easeOut = (x: number) => 1 - (1 - x) * (1 - x); // quadratic: gentle start speed, no strobing
const KINDS = ["attr", "skill", "spec"];

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Names per die and initials; older messages only carry the title "Who · A + B + C". */
function describe(msg: RollMessage) {
  const [who, rest = ""] = msg.title.split(" · ");
  const names = msg.names ?? rest.split(" + ");
  return {
    initials: msg.initials ?? who.slice(0, 2).toUpperCase(),
    names: msg.dice.map((_, i) => names[i] ?? ""),
  };
}

function rollHTML(msg: RollMessage) {
  const { initials, names } = describe(msg);
  const what = esc(names.join(" + "));
  const ini = esc(initials);
  return `<div class="inner">
    <div class="rh"><span class="ini">${ini}</span><span class="what">${what}</span></div>
    <div class="rb">
      <div class="res"><span>RESULT</span><b class="tot">–</b></div>
      <div class="dice">${msg.dice
        .map((d, i) => {
          const s = SHAPES[d.size] ?? SHAPES[6];
          const [cx, cy] = s.c;
          return `<div class="dv k-${KINDS[i] ?? "spec"} rolling"><span class="nm" title="${esc(names[i])}">${esc(names[i])}</span><div class="face" style="--ox:${(cx / 60) * 100}%;--oy:${(cy / 60) * 100}%"><svg viewBox="0 0 60 60"><g class="spin" data-cx="${cx.toFixed(2)}" data-cy="${cy.toFixed(2)}"><polygon points="${s.p}"/>${s.f ? `<polyline points="${s.f}"/>` : ""}<text class="num" x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="${NUM_UNITS}">?</text></g></svg></div><span class="lab">D${d.size}</span></div>`;
        })
        .join("")}</div>
    </div>
    <div class="one"><span class="ini">${ini}</span><span class="what">${what}</span><b class="tot1">…</b></div>
  </div>`;
}

/** Equal die spacing, as tight as the names allow: the centre distance is the largest that any two
 *  NEIGHBOURING names need, never less than the face plus the normal gap. Names may overhang their
 *  own column; the outer names get padding so they never stick out of the popup. */
function sizeColumns(el: HTMLElement, maxWidth = Infinity) {
  const dice = el.querySelector<HTMLElement>(".dice")!;
  // the real (fractional) text width; scrollWidth rounds down and would trigger the ellipsis
  const textWidth = (n: Element) => {
    const rg = document.createRange();
    rg.selectNodeContents(n);
    return Math.ceil(rg.getBoundingClientRect().width) + 1;
  };
  const full = [...dice.querySelectorAll(".nm")].map(textWidth);
  // the popup must fit the reserved popover width: lower the name cap until it does
  for (let cap = COL_MAX; ; cap -= 4) {
    const w = full.map((x) => Math.min(x, cap));
    let centre = FACE_PX + DICE_GAP;
    for (let i = 0; i + 1 < w.length; i++) centre = Math.max(centre, (w[i] + w[i + 1]) / 2 + LABEL_GAP);
    const col = centre - DICE_GAP;
    dice.style.setProperty("--col", `${col}px`);
    dice.style.setProperty("--nmax", `${cap}px`);
    dice.style.paddingLeft = `${Math.max(0, (w[0] - col) / 2)}px`;
    dice.style.paddingRight = `${Math.max(0, (w[w.length - 1] - col) / 2)}px`;
    if (el.getBoundingClientRect().width <= maxWidth || cap <= FACE_PX) return;
  }
}

/** Tumble + numbers: each face turns continuously (eased) around its centroid while the number changes,
 *  and lands exactly upright when that die stops. One rAF loop; seeded, so every client looks the same. */
async function spinNumbers(msg: RollMessage, dv: HTMLElement[], num: SVGTextElement[]) {
  const r = rng(msg.seed);
  const stopAt = msg.dice.map((_, i) => TUMBLE.ms + i * STAGGER_MS);
  const endAt = stopAt.map((t) => t + SETTLE_MS);
  const faces = dv.map((d) => d.querySelector<SVGGElement>(".spin")!);
  const plan = dv.map(() => {
    const a0 = r() * 360;
    const total = Math.round((a0 + TUMBLE.turns * 360) / 360) * 360 - a0; // ends upright
    return { a0, total, wob: 2 + r() * 2, lastSwap: -1e9, done: false };
  });
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const t = now - t0;
      let live = 0;
      msg.dice.forEach((d, i) => {
        const k = plan[i];
        if (k.done) return;
        if (t >= endAt[i]) {
          faces[i].removeAttribute("transform");
          // frames can be sparse (busy or throttled tab): always land on the real value
          num[i].textContent = String(d.value);
          dv[i].classList.remove("rolling");
          k.done = true;
          return;
        }
        live++;
        const x = Math.min(1, t / endAt[i]);
        if (TUMBLE.turns) {
          const ang = -(k.a0 + k.total * easeOut(x)); // counter-clockwise
          const scale = 1 - 0.07 * Math.sin(x * Math.PI * k.wob) * (1 - x);
          const { cx, cy } = faces[i].dataset;
          faces[i].setAttribute("transform", `translate(${cx} ${cy}) rotate(${ang.toFixed(2)}) scale(${scale.toFixed(3)}) translate(${-Number(cx)} ${-Number(cy)})`);
        }
        if (t < stopAt[i]) {
          if (t - k.lastSwap >= NUM_SWAP_MS) {
            num[i].textContent = String(1 + Math.floor(r() * d.size));
            k.lastSwap = t;
          }
        } else if (dv[i].classList.contains("rolling")) {
          num[i].textContent = String(d.value);
          dv[i].classList.remove("rolling");
        }
      });
      if (live) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  await wait(120); // a beat before the +1s fly
}

/** Animate a height change (collapse to one line) so neighbours glide. */
async function morph(el: HTMLElement, change: () => void) {
  const h0 = el.offsetHeight;
  change();
  const h1 = el.offsetHeight;
  if (h0 === h1 || reduced) return;
  el.style.overflow = "hidden";
  await el.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 220, easing: "ease-out" }).finished;
  el.style.overflow = "";
}

/** A collapsed line slides out to the right, then its slot closes smoothly. */
async function removeLine(el: HTMLElement) {
  if (!reduced) {
    await el.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(80px)", opacity: 0 }], { duration: 300, easing: "ease-in", fill: "forwards" }).finished;
    if (!el.isConnected) return;
    el.style.overflow = "hidden";
    // the gap belongs to the side that has a neighbour; closing the slot absorbs it too
    const side = el.nextElementSibling ? "marginBottom" : "marginTop";
    const lonely = stack.children.length === 1;
    await el.animate([{ height: `${el.offsetHeight}px`, [side]: "0px" }, { height: "0px", [side]: lonely ? "0px" : `-${GAP}px` }], { duration: 220, easing: "ease-in-out", fill: "forwards" }).finished;
  }
  el.remove();
}

const seen = new Set<string>();

async function play(msg: RollMessage) {
  if (seen.has(msg.id)) return;
  seen.add(msg.id);
  // end of life is fixed on arrival: fixed delays, never earlier than an older roll
  const arrived = performance.now();
  const collapseAt = Math.max(arrived + COLLAPSE_MS, lastCollapse + ORDER_MS);
  const exitAt = Math.max(collapseAt + LINE_MS, lastExit + ORDER_MS);
  lastCollapse = collapseAt;
  lastExit = exitAt;

  const out = evaluate(msg.dice);
  const el = document.createElement("section");
  el.className = "roll enter";
  el.dataset.id = msg.id;
  el.style.setProperty("--pc", msg.color);
  el.innerHTML = rollHTML(msg);
  await enter(el);
  void lifecycle(el, collapseAt, exitAt);
  const dv = [...el.querySelectorAll<HTMLElement>(".dv")];
  const num = dv.map((d) => d.querySelector<SVGTextElement>(".num")!);
  const tot = el.querySelector<HTMLElement>(".res .tot")!;
  const tot1 = el.querySelector<HTMLElement>(".tot1")!;

  // 1. roll
  await spinNumbers(msg, dv, num);
  if (!el.isConnected) return;
  dv[out.base].classList.add("base");
  let shown = msg.dice[out.base].value;

  // 2. +1s fly into the base die, which pulses and counts up
  if (out.bonus.length) await wait(500);
  for (const i of out.bonus) {
    if (!el.isConnected) return;
    num[i].textContent = "+1";
    const from = num[i].getBoundingClientRect();
    const to = num[out.base].getBoundingClientRect();
    dv[i].classList.add("spent");
    if (!reduced && !el.classList.contains("collapsed")) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = "+1";
      chip.style.left = `${from.left}px`;
      chip.style.top = `${from.top}px`;
      document.body.appendChild(chip);
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      await chip.animate(
        [{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${dx}px,${dy}px) scale(.8)`, opacity: 0.9 }],
        { duration: 380, easing: "cubic-bezier(.5,0,.8,.4)" },
      ).finished;
      chip.remove();
    }
    shown += 1;
    num[out.base].textContent = String(shown);
    const face = dv[out.base].querySelector<HTMLElement>(".face")!;
    face.classList.remove("pulse");
    void face.offsetWidth; // restart the animation
    face.classList.add("pulse");
    await wait(60);
  }
  tot.textContent = String(out.total);
  tot1.textContent = `= ${out.total}`;
  el.classList.add("done");
  tot.classList.remove("pulse");
  void tot.offsetWidth;
  tot.classList.add("pulse");
}

// ---------- end of life ----------
// Fixed on arrival (collapse after 8 s, slide out 10 s later, older rolls first). When a new roll
// needs space in the fixed-size popover, the oldest roll is hurried: it collapses / leaves now.
type Life = { hurryCollapse: () => void; hurryExit: () => void; collapsing: boolean; collapsed: Promise<void>; gone: Promise<void> };
const lives = new WeakMap<HTMLElement, Life>();
const sleepUntil = (t: number, hurry: (wake: () => void) => void) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, Math.max(0, t - performance.now()));
    hurry(() => { clearTimeout(id); resolve(); });
  });

function lifecycle(el: HTMLElement, collapseAt: number, exitAt: number) {
  let doneCollapse!: () => void, doneGone!: () => void;
  const life: Life = {
    hurryCollapse: () => {}, hurryExit: () => {}, collapsing: false,
    collapsed: new Promise((r) => (doneCollapse = r)),
    gone: new Promise((r) => (doneGone = r)),
  };
  lives.set(el, life);
  return (async () => {
    await sleepUntil(collapseAt, (wake) => (life.hurryCollapse = wake));
    life.collapsing = true;
    if (el.isConnected) {
      el.classList.remove("enter");
      await morph(el, () => el.classList.add("collapsed"));
    }
    doneCollapse();
    await sleepUntil(exitAt, (wake) => (life.hurryExit = wake));
    if (el.isConnected) await removeLine(el);
    doneGone();
    if (!stack.children.length) setSize(0, 0); // nothing visible any more: the resize can't be seen
  })();
}

/** Frees space at the bottom of the stack: the oldest full popup collapses now, else the oldest line leaves. */
async function hurryOldest() {
  const rolls = [...stack.children].filter((c) => !c.classList.contains("measure")) as HTMLElement[];
  const full = [...rolls].reverse().find((r) => !lives.get(r)?.collapsing);
  if (full) {
    const life = lives.get(full)!;
    life.hurryCollapse();
    return life.collapsed;
  }
  const oldest = rolls.at(-1);
  if (!oldest) return;
  const life = lives.get(oldest)!;
  life.hurryExit();
  return life.gone;
}

// ---------- popover size: fixed while anything is visible ----------
// Measured in OBR: after setWidth/setHeight the popover has the new size but its old top/left for a
// frame, so its bottom/right edge (the anchor) is off by the size change, and the bottom-right
// anchored content jumps by that much. Hence: one reserved size while rolls are visible, 0×0 otherwise.
const RES_W_MIN = 400; // reserved width: at least this, at most RES_W_MAX (wider rolls truncate names)
const RES_W_MAX = 510;
const FULL_H = 139; // tallest full popup (two-line title)
const LINE_H = 28; // one collapsed line
const RES_H = 2 * FULL_H + GAP + LINE_H + GAP + 2 * PAD; // two full popups and a line; more hurries the oldest
const TOP_MARGIN = 96; // keep clear of OBR's top bar on short screens
let reserved: { w: number; h: number } | null = null;
let lastSize = "";
let obrReady = false; // size requests before OBR is ready are rejected; onReady re-syncs
function setSize(w: number, h: number) {
  if (!w || !h) reserved = null;
  const key = `${w}x${h}`;
  if (key === lastSize) return;
  if (OBR.isAvailable && !obrReady) return;
  lastSize = key;
  if (OBR.isAvailable) {
    void OBR.popover.setWidth(DICE_POPOVER, w);
    void OBR.popover.setHeight(DICE_POPOVER, h);
  } else document.documentElement.dataset.size = key;
}
/** Polls with timers, not rAF: an iframe that is 0×0 or not rendering gets no animation frames. */
async function waitForSize(w: number, h: number, ms = 600) {
  const t0 = performance.now();
  while ((innerWidth !== w || innerHeight !== h) && performance.now() - t0 < ms) await wait(16);
  await wait(48); // OBR moves the popover a frame after resizing it; let that land while nothing shows
}
async function screenHeight() {
  try {
    return OBR.isAvailable ? await OBR.viewport.getHeight() : innerHeight;
  } catch {
    return innerHeight;
  }
}

let entering = Promise.resolve();

/** Puts a popup on top of the stack. The first popup of a burst reserves the popover size (nothing is
 *  visible yet, so the resize can't be seen); later ones make room by hurrying the oldest roll. */
function enter(el: HTMLElement) {
  entering = entering.then(async () => {
    await document.fonts?.ready; // name widths are measured
    el.classList.add("measure");
    stack.appendChild(el);
    const first = !reserved || stack.children.length === 1;
    if (first) {
      sizeColumns(el, RES_W_MAX - 2 * PAD);
      const e = el.getBoundingClientRect();
      const w = Math.ceil(Math.min(RES_W_MAX, Math.max(RES_W_MIN, e.width + 2 * PAD)));
      const h = Math.ceil(Math.max(e.height + 2 * PAD, Math.min(RES_H, (await screenHeight()) - DICE_BOTTOM - TOP_MARGIN)));
      reserved = { w, h };
      if (OBR.isAvailable) {
        setSize(w, h);
        await waitForSize(w, h);
      }
    } else {
      sizeColumns(el, reserved!.w - 2 * PAD);
      // hurry the oldest rolls until the new popup fits the reserved height
      for (let i = 0; i < 12; i++) {
        const rest = [...stack.children].filter((c) => c !== el) as HTMLElement[];
        const used = rest.reduce((a, c) => a + c.getBoundingClientRect().height, 0) + GAP * rest.length;
        if (used + el.getBoundingClientRect().height + 2 * PAD <= reserved!.h || !rest.length) break;
        await hurryOldest();
      }
    }
    el.classList.remove("measure");
    stack.prepend(el); // newest on top
  });
  return entering;
}

// ---------- incoming rolls ----------
const receive = (data: unknown) => {
  if (isRollMessage(data)) void play(data);
};
if (OBR.isAvailable) {
  OBR.onReady(() => {
    OBR.broadcast.onMessage(ROLL_CHANNEL, (e) => receive(e.data));
    // size requests made before OBR was ready are lost: a reloaded page could keep an old popover size
    obrReady = true;
    lastSize = "";
    if (reserved) setSize(reserved.w, reserved.h);
    else setSize(0, 0);
  });
} else {
  // Standalone preview: rolls from the sidebar preview arrive via BroadcastChannel; ?demo plays examples.
  if ("BroadcastChannel" in window) new BroadcastChannel("vtt-roll").onmessage = (e) => receive(e.data);
  if (new URLSearchParams(location.search).has("demo")) {
    const fixed = (title: string, color: string, initials: string, dice: [number, number][]) => {
      const names = title.split(" · ")[1].split(" + ");
      return { ...makeRoll(title, color, dice.map(([s]) => s), Math.random, { initials, names }), dice: dice.map(([size, value]) => ({ size, value })) };
    };
    receive(fixed("Hawk · TECHNIK + Flugdrohnen + Spionage", "#ff8a1f", "HK", [[8, 7], [6, 6], [4, 4]]));
    setTimeout(() => receive(fixed("Phlox · MAGIE + Spruchzauber", "#3fd87f", "PH", [[6, 3], [8, 7]])), 1500);
    setTimeout(() => receive(fixed("Peppermint · PHYSISCH", "#a46cff", "PM", [[12, 9]])), 2600);
  }
}
