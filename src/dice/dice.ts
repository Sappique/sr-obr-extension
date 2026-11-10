/**
 * Dice roll popups, shown for everyone in a popover at the bottom right.
 * Every client receives the same RollMessage (final values + seed) and plays:
 *   0–1 s   numbers flicker, then stop on the final values
 *   +0.5 s  each other die on its max face turns into "+1", flies into the base die,
 *           which pulses and counts up
 *   +5 s    after the final result the popup fades out
 * Concurrent rolls stack upwards; the popover is sized to its content (0×0 when empty).
 */
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
const FLICKER_MS = reduced ? 250 : 1000;
const BONUS_DELAY_MS = 500;
const BONUS_STEP_MS = reduced ? 150 : 420;
const FLIGHT_MS = reduced ? 0 : 380;
const HOLD_MS = 5000;

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Outline per die size, in a 60×60 box, plus where the number sits. */
const SHAPES: Record<number, { points: string; dy: number }> = {
  4: { points: "30,4 57,53 3,53", dy: 8 },
  6: { points: "7,7 53,7 53,53 7,53", dy: 0 },
  8: { points: "30,2 58,30 30,58 2,30", dy: 0 },
  10: { points: "30,2 56,25 30,58 4,25", dy: -2 },
  12: { points: "30,2 58,23 47,56 13,56 2,23", dy: 3 },
};

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function titleHTML(title: string) {
  const [who, ...rest] = title.split(" · ");
  return rest.length ? `<b>${esc(who)}</b> · ${esc(rest.join(" · "))}` : esc(title);
}

const seen = new Set<string>();

async function play(msg: RollMessage) {
  if (seen.has(msg.id)) return;
  seen.add(msg.id);
  const out = evaluate(msg.dice);
  const el = document.createElement("section");
  el.className = "roll w";
  el.dataset.id = msg.id;
  el.style.setProperty("--pc", msg.color);
  el.innerHTML = `<div class="plate"></div><div class="frame"><div class="inner">
    <div class="rh">${titleHTML(msg.title)}</div>
    <div class="dice">${msg.dice
      .map((d, i) => {
        const s = SHAPES[d.size] ?? SHAPES[6];
        return `<div class="dv rolling" data-i="${i}"><div class="face"><svg viewBox="0 0 60 60"><polygon points="${s.points}"/></svg><span class="num" style="--ny:${s.dy}px">?</span></div><span class="lab">D${d.size}</span></div>`;
      })
      .join("")}<div class="res">RESULT<b>${out.total}</b></div></div></div></div>`;
  stack.appendChild(el);
  const dv = [...el.querySelectorAll<HTMLElement>(".dv")];
  const num = dv.map((d) => d.querySelector<HTMLElement>(".num")!);

  // 1. flicker (seeded, so every client shows the same sequence)
  const r = rng(msg.seed);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (performance.now() - t0 >= FLICKER_MS) return resolve();
      msg.dice.forEach((d, i) => (num[i].textContent = String(1 + Math.floor(r() * d.size))));
      setTimeout(tick, 55);
    };
    tick();
  });
  msg.dice.forEach((d, i) => {
    num[i].textContent = String(d.value);
    dv[i].classList.remove("rolling");
    if (d.value === d.size) dv[i].classList.add("max");
  });
  dv[out.base].classList.add("base");

  // 2. bonus dice turn into +1 and fly into the base die
  let shown = msg.dice[out.base].value;
  if (out.bonus.length) await wait(BONUS_DELAY_MS);
  for (const i of out.bonus) {
    num[i].textContent = "+1";
    const from = num[i].getBoundingClientRect();
    const to = num[out.base].getBoundingClientRect();
    dv[i].classList.add("spent");
    if (FLIGHT_MS) {
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
        { duration: FLIGHT_MS, easing: "cubic-bezier(.5,0,.8,.4)" },
      ).finished;
      chip.remove();
    }
    shown += 1;
    num[out.base].textContent = String(shown);
    dv[out.base].classList.remove("pulse");
    void dv[out.base].offsetWidth; // restart the animation
    dv[out.base].classList.add("pulse");
    await wait(Math.max(0, BONUS_STEP_MS - FLIGHT_MS));
  }
  el.classList.add("done");

  // 3. hold, fade, remove
  await wait(HOLD_MS);
  el.classList.add("gone");
  await wait(550);
  el.remove();
}

// ---------- popover size follows the content ----------
let lastSize = "";
function setSize(w: number, h: number) {
  const key = `${w}x${h}`;
  if (key === lastSize) return;
  lastSize = key;
  if (OBR.isAvailable) {
    void OBR.popover.setWidth(DICE_POPOVER, w);
    void OBR.popover.setHeight(DICE_POPOVER, h);
  } else document.documentElement.dataset.size = key;
}
new ResizeObserver(() => {
  if (!stack.children.length) return setSize(0, 0);
  const r = stack.getBoundingClientRect();
  setSize(Math.ceil(r.width), Math.ceil(r.height));
}).observe(stack);

// ---------- incoming rolls ----------
const receive = (data: unknown) => {
  if (isRollMessage(data)) void play(data);
};
if (OBR.isAvailable) {
  OBR.onReady(() => {
    OBR.broadcast.onMessage(ROLL_CHANNEL, (e) => receive(e.data));
  });
} else {
  // Standalone preview: rolls from the sidebar preview arrive via BroadcastChannel; ?demo plays examples.
  if ("BroadcastChannel" in window) new BroadcastChannel("vtt-roll").onmessage = (e) => receive(e.data);
  if (new URLSearchParams(location.search).has("demo")) {
    const fixed = (title: string, color: string, dice: [number, number][]) => ({ ...makeRoll(title, color, dice.map(([s]) => s)), dice: dice.map(([size, value]) => ({ size, value })) });
    receive(fixed("Hawk · GESCHICK + Flugdrohnen + Spionage", "#ff8a1f", [[6, 6], [8, 5], [4, 4]]));
    setTimeout(() => receive(fixed("Phlox · MAGIE + Spruchzauber", "#3fd87f", [[6, 3], [8, 7]])), 1500);
    setTimeout(() => receive(fixed("Peppermint · PHYSISCH", "#a46cff", [[12, 9]])), 2600);
  }
}
