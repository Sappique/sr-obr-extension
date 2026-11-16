/**
 * One dice roll popup: markup, die spacing and the in-popup animations. Used by the per-roll
 * windows (dice.ts in OBR) and by the standalone preview stack.
 * Design and behaviour: designs/17-dice-roller.html (logic copied from there).
 *   tumble + numbers: each face turns counter-clockwise around its centroid while its number
 *     changes, the dice stop one by one and land upright
 *   each other die on its max face turns into "+1", flies into the base die, which pulses and
 *     counts up; the total appears in the yellow result plaque
 */
import { evaluate, RollMessage } from "./roll";

export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const waitUntil = (t: number) => wait(Math.max(0, t - performance.now()));
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

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
const COL_MAX = 112; // widest a name may make a die column; longer names truncate
const LABEL_GAP = 8; // minimum space between two neighbouring names
const DICE_GAP = 10; // .dice gap
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
          const kind = i >= msg.dice.length - (msg.bonus ?? 0) ? "bonus" : KINDS[i] ?? "spec";
          return `<div class="dv k-${kind} rolling"><span class="nm" title="${esc(names[i])}">${esc(names[i])}</span><div class="face" style="--ox:${(cx / 60) * 100}%;--oy:${(cy / 60) * 100}%"><svg viewBox="0 0 60 60"><g class="spin" data-cx="${cx.toFixed(2)}" data-cy="${cy.toFixed(2)}"><polygon points="${s.p}"/>${s.f ? `<polyline points="${s.f}"/>` : ""}<text class="num" x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="${NUM_UNITS}">?</text></g></svg></div><span class="lab">D${d.size}</span></div>`;
        })
        .join("")}</div>
    </div>
    <div class="one"><span class="ini">${ini}</span><span class="what">${what}</span><b class="tot1">…</b></div>
  </div>`;
}

/** Equal die spacing, as tight as the names allow: the centre distance is the largest that any two
 *  NEIGHBOURING names need, never less than the face plus the normal gap. Names may overhang their
 *  own column; the outer names get padding so they never stick out of the popup. */
export function sizeColumns(el: HTMLElement) {
  const dice = el.querySelector<HTMLElement>(".dice")!;
  // the real (fractional) text width; scrollWidth rounds down and would trigger the ellipsis
  const textWidth = (n: Element) => {
    const rg = document.createRange();
    rg.selectNodeContents(n);
    return Math.ceil(rg.getBoundingClientRect().width) + 1;
  };
  const w = [...dice.querySelectorAll(".nm")].map((n) => Math.min(textWidth(n), COL_MAX));
  let centre = FACE_PX + DICE_GAP;
  for (let i = 0; i + 1 < w.length; i++) centre = Math.max(centre, (w[i] + w[i + 1]) / 2 + LABEL_GAP);
  const col = centre - DICE_GAP;
  dice.style.setProperty("--col", `${col}px`);
  dice.style.setProperty("--nmax", `${COL_MAX}px`);
  dice.style.paddingLeft = `${Math.max(0, (w[0] - col) / 2)}px`;
  dice.style.paddingRight = `${Math.max(0, (w[w.length - 1] - col) / 2)}px`;
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

/** A new popup element (not yet in the document). */
export function rollElement(msg: RollMessage) {
  const el = document.createElement("section");
  el.className = "roll";
  el.dataset.id = msg.id;
  el.style.setProperty("--pc", msg.color);
  el.innerHTML = rollHTML(msg);
  return el;
}

/** Tumble, +1s, result. Resolves when the result shows; stops early if the popup is removed. */
export async function playRoll(el: HTMLElement, msg: RollMessage) {
  const out = evaluate(msg.dice);
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
    if (!reduced) {
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

export const COLLAPSE_ANIM = { duration: 220, easing: "ease-out" } as const;
export const CLOSE_ANIM = { duration: 220, easing: "ease-in-out" } as const;

/** Collapse to one line, animating the height (the popup's bottom stays). The line is never wider
 *  than the full popup (its window keeps that width): long names truncate. `onStart` gets the new
 *  height before the animation runs, so neighbours can glide in step. */
export async function collapse(el: HTMLElement, onStart?: (h1: number) => void) {
  el.classList.remove("enter");
  el.style.maxWidth = `${el.getBoundingClientRect().width}px`;
  const h0 = el.offsetHeight;
  el.classList.add("collapsed");
  const h1 = el.offsetHeight;
  onStart?.(h1);
  if (h0 === h1 || reduced) return;
  el.style.overflow = "hidden";
  await el.animate([{ height: `${h0}px` }, { height: `${h1}px` }], COLLAPSE_ANIM).finished;
  el.style.overflow = "";
}

/** The collapsed line slides out to the right (it stays in the document, invisible). */
export async function slideOut(el: HTMLElement) {
  if (reduced) return;
  await el.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(80px)", opacity: 0 }], { duration: 300, easing: "ease-in", fill: "forwards" }).finished;
}
