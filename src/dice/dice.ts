/**
 * dice.html. In OBR: one roll window (dice.html?slot=N). The dice manager in the background page
 * (manager.ts) owns the stack and places this popover; the window renders one roll, reports its
 * size, plays it once it has been placed, collapses and slides out at the times it was given.
 * Standalone (no OBR, e.g. http://localhost:5175/dice.html?demo): a plain stack of rolls in one page,
 * fed by the sidebar preview via BroadcastChannel.
 */
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/900.css";
import "@fontsource/share-tech-mono/400.css";
import "./dice.css";
import OBR from "@owlbear-rodeo/sdk";
import { BusMessage, DICE_BUS, GAP, PAD, ToManager } from "./bus";
import { isRollMessage, makeRoll, RollMessage } from "./roll";
import { CLOSE_ANIM, collapse, playRoll, reduced, rollElement, sizeColumns, slideOut, wait, waitUntil } from "./view";

// ---------- OBR: one roll per window ----------
function rollWindow(slot: number) {
  document.documentElement.classList.add("win");
  const send = (m: ToManager) => void OBR.broadcast.sendMessage(DICE_BUS, m, { destination: "LOCAL" });
  let current: HTMLElement | null = null;
  const clear = () => {
    current?.remove();
    current = null;
  };

  async function show(msg: RollMessage, collapseIn: number, exitIn: number) {
    const received = performance.now();
    clear();
    const el = rollElement(msg);
    el.classList.add("measure"); // laid out but invisible until the window has its size and place
    document.body.appendChild(el);
    current = el;
    await document.fonts?.ready; // name widths are measured
    if (current !== el) return;
    sizeColumns(el);
    const r = el.getBoundingClientRect();
    const w = Math.ceil(r.width) + 2 * PAD, h = Math.ceil(r.height) + 2 * PAD;
    send({ t: "size", slot, id: msg.id, w, h });
    // Timers, not rAF: a 0×0 iframe gets no animation frames. OBR moves a popover a frame after it
    // resizes it, so wait a little longer once the size has arrived (nothing shows until then).
    const t0 = performance.now();
    while ((innerWidth !== w || innerHeight !== h) && performance.now() - t0 < 2000) await wait(16);
    await wait(50);
    if (current !== el) return;
    el.classList.remove("measure");
    el.classList.add("enter");
    await playRoll(el, msg);
    await waitUntil(received + collapseIn);
    if (current !== el) return;
    await collapse(el, (h1) => send({ t: "collapse", slot, id: msg.id, slotH: h1 + 2 * PAD }));
    await waitUntil(received + exitIn);
    if (current !== el) return;
    await slideOut(el);
    if (current !== el) return;
    clear();
    send({ t: "gone", slot, id: msg.id });
  }

  OBR.onReady(() => {
    OBR.broadcast.onMessage(DICE_BUS, (e) => {
      const m = e.data as BusMessage;
      if (m.t === "hello") {
        clear(); // the manager restarted and has forgotten this roll
        send({ t: "ready", slot });
      } else if (m.t === "prepare" && m.slot === slot && isRollMessage(m.msg)) {
        void show(m.msg, m.collapseIn, m.exitIn);
      }
    });
    send({ t: "ready", slot });
  });
}

// ---------- standalone preview: all rolls in one stack ----------
function previewStack() {
  document.documentElement.classList.add("standalone");
  const stack = document.getElementById("stack")!;
  const COLLAPSE_MS = 8000, LINE_MS = 10000, ORDER_MS = 180;
  let lastCollapse = 0, lastExit = 0;
  const seen = new Set<string>();

  async function play(msg: RollMessage) {
    if (seen.has(msg.id)) return;
    seen.add(msg.id);
    const collapseAt = Math.max(performance.now() + COLLAPSE_MS, lastCollapse + ORDER_MS);
    const exitAt = Math.max(collapseAt + LINE_MS, lastExit + ORDER_MS);
    lastCollapse = collapseAt;
    lastExit = exitAt;
    const el = rollElement(msg);
    await document.fonts?.ready;
    stack.prepend(el); // newest on top
    sizeColumns(el);
    el.classList.add("enter");
    await playRoll(el, msg);
    await waitUntil(collapseAt);
    await collapse(el);
    await waitUntil(exitAt);
    await slideOut(el);
    if (!reduced) {
      // close the slot: the gap belongs to the side that has a neighbour
      el.style.overflow = "hidden";
      const side = el.nextElementSibling ? "marginBottom" : "marginTop";
      const lonely = stack.children.length === 1;
      await el.animate([{ height: `${el.offsetHeight}px`, [side]: "0px" }, { height: "0px", [side]: lonely ? "0px" : `-${GAP}px` }], { ...CLOSE_ANIM, fill: "forwards" }).finished;
    }
    el.remove();
  }

  const receive = (data: unknown) => {
    if (isRollMessage(data)) void play(data);
  };
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

const slotParam = new URLSearchParams(location.search).get("slot");
if (OBR.isAvailable && slotParam !== null) rollWindow(Number(slotParam));
else previewStack();
