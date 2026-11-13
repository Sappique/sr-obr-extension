/**
 * Dice manager (runs in the background page). Every visible roll gets its own popover window
 * (dice.html?slot=N); this module keeps the stack: newest on top, bottom-right corner fixed.
 *
 * Why one window per roll: OBR applies a popover's new size one frame before its new position, so
 * any resize that moves the popover's top-left corner flickers. Measured in OBR (test page, normal
 * Chrome): a pure height change at a fixed top-left and a pure move (also every frame, as a glide)
 * draw cleanly; size + position together flicker. So a window is only sized while it is invisible
 * (before its roll shows, after it has left) and otherwise only moved:
 *   new roll    a spare window gets the roll, reports its size, is sized + placed on top of the
 *               stack while still invisible, then shows the roll; no other window changes
 *   collapse    the window keeps its size (its line sits at its bottom), the windows above glide down
 *   line leaves the window is emptied and shrunk to 0×0, the windows above glide down
 * Windows are reused; SPARES empty, already loaded windows wait so a roll never waits for a page load.
 * A collapsed roll's window keeps blocking clicks in its full-size box until the line has left.
 */
import OBR from "@owlbear-rodeo/sdk";
import { DICE_BOTTOM_GAP, DICE_POPOVER, DICE_RIGHT_GAP, ROLL_CHANNEL } from "../sheets/model";
import { BusMessage, DICE_BUS, GAP, PAD, ToWindow, windowId, windowUrl } from "./bus";
import { isRollMessage, RollMessage } from "./roll";

const SPARES = 2; // empty, loaded windows kept ready
const MAX_WINDOWS = 10;
const OPEN_SPACING_MS = 700; // OBR leaves a popover blank when two open in the same moment
const OPEN_RETRY_MS = 3000; // OBR sometimes drops a popover.open: re-open until the page reports ready
const SIZE_TIMEOUT_MS = 2500;
// End of life, measured from the moment a roll arrives (independent of the roll animation).
const COLLAPSE_MS = 8000; // full popup → one line
const LINE_MS = 10000; // one line → slides out
const ORDER_MS = 180; // minimum spacing that keeps older rolls collapsing / leaving first
// Glides of the windows above, matching the popup's own animations (view.ts COLLAPSE_ANIM, CLOSE_ANIM).
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const GLIDE_COLLAPSE = { ms: reduced ? 0 : 220, ease: (x: number) => 1 - (1 - x) ** 2 };
const GLIDE_CLOSE = { ms: reduced ? 0 : 220, ease: (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2) };

type Win = {
  slot: number;
  ready: boolean; // page loaded and listening
  rollId: string | null; // the roll it shows (or prepares)
  w: number;
  h: number; // window size
  slotH: number; // height it takes in the stack: h, or line + padding once collapsed
  top: number; // current screen top (moves during a glide)
  glide: { from: number; to: number; t0: number; ms: number; ease: (x: number) => number } | null;
  openedAt: number;
};

const wins: Win[] = [];
let stack: Win[] = []; // visible rolls, bottom (oldest) first
const queue: { msg: RollMessage; collapseAt: number; exitAt: number }[] = [];
let screen = { w: 0, h: 0 };
let lastCollapse = 0, lastExit = 0, lastOpen = -1e9;
const seen = new Set<string>();
const send = (m: ToWindow) => void OBR.broadcast.sendMessage(DICE_BUS, m, { destination: "LOCAL" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sizes and places a window by its top-left corner (pure size changes only while it is invisible). */
function put(win: Win, w: number, h: number, top: number) {
  win.w = w;
  win.h = h;
  win.top = top;
  void OBR.popover
    .open({
      id: windowId(win.slot),
      url: windowUrl(win.slot),
      width: w,
      height: h,
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(screen.w - DICE_RIGHT_GAP - w), top: Math.round(top) },
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
      disableClickAway: true,
      hidePaper: true,
      marginThreshold: 0,
    })
    .catch(() => {});
}

// ---------- window pool ----------
function openWindow(win: Win) {
  win.openedAt = lastOpen = performance.now();
  // A position-anchored popover opened at 0×0 never loads its page; 1×1 does. Once the page
  // reports ready it goes to 0×0 (see onReadyMsg).
  put(win, 1, 1, screen.h - DICE_BOTTOM_GAP - 1);
}

/** Keeps SPARES empty windows: opens one more when needed, one at a time, spaced out; re-opens
 *  windows whose page never reported ready. */
async function tendPool() {
  const now = performance.now();
  for (const win of wins) if (!win.ready && now - win.openedAt > OPEN_RETRY_MS && now - lastOpen > OPEN_SPACING_MS) openWindow(win);
  const spare = wins.filter((w) => !w.rollId).length; // loading ones count: they will be ready soon
  if (spare < SPARES && wins.length < MAX_WINDOWS && performance.now() - lastOpen > OPEN_SPACING_MS && screen.w) {
    const slot = wins.reduce((a, w) => Math.max(a, w.slot + 1), 0);
    const win: Win = { slot, ready: false, rollId: null, w: 0, h: 0, slotH: 0, top: 0, glide: null, openedAt: 0 };
    wins.push(win);
    openWindow(win);
  }
}

function onReadyMsg(slot: number) {
  let win = wins.find((w) => w.slot === slot);
  if (!win) {
    // a window left open by an earlier run of this page (dev reload): adopt it
    win = { slot, ready: false, rollId: null, w: 0, h: 0, slotH: 0, top: 0, glide: null, openedAt: performance.now() };
    wins.push(win);
    wins.sort((a, b) => a.slot - b.slot);
  }
  const wasShowing = stack.includes(win);
  win.ready = true;
  win.rollId = null; // a (re)loaded page shows nothing
  stack = stack.filter((w) => w !== win);
  put(win, 0, 0, screen.h - DICE_BOTTOM_GAP);
  if (wasShowing) relayout(GLIDE_CLOSE);
  void pump();
}

// ---------- stack layout ----------
const BOTTOM = () => screen.h - DICE_BOTTOM_GAP;

/** Target top of every window in the stack. A popup sits PAD inside its window; GAP between popups. */
function targets() {
  const out = new Map<Win, number>();
  let bottom = BOTTOM();
  for (const win of stack) {
    out.set(win, bottom - win.h);
    bottom = bottom - win.slotH + 2 * PAD - GAP;
  }
  return out;
}
/** Window bottom for a new roll on top of the stack. */
function nextBottom() {
  let bottom = BOTTOM();
  for (const win of stack) bottom = bottom - win.slotH + 2 * PAD - GAP;
  return bottom;
}

let ticking = false;
/** Moves the windows to their targets: instantly, or as a glide (pure moves, every ~16 ms). */
function relayout(glide: { ms: number; ease: (x: number) => number } | null) {
  const now = performance.now();
  for (const [win, to] of targets()) {
    const cur = win.glide ? glideTop(win, now) : win.top;
    if (Math.abs(cur - to) < 0.5 && !win.glide) continue;
    if (!glide || !glide.ms) {
      win.glide = null;
      put(win, win.w, win.h, to);
    } else win.glide = { from: cur, to, t0: now, ms: glide.ms, ease: glide.ease };
  }
  if (!ticking && stack.some((w) => w.glide)) {
    ticking = true;
    void tick();
  }
}
function glideTop(win: Win, now: number) {
  const g = win.glide!;
  const k = Math.min(1, (now - g.t0) / g.ms);
  return g.from + (g.to - g.from) * g.ease(k);
}
async function tick() {
  // timers, not rAF: the background iframe is 1×1 and may get no animation frames
  while (stack.some((w) => w.glide)) {
    const now = performance.now();
    for (const win of stack) {
      if (!win.glide) continue;
      const top = glideTop(win, now);
      const done = now - win.glide.t0 >= win.glide.ms;
      if (Math.round(top) !== Math.round(win.top) || done) put(win, win.w, win.h, done ? win.glide.to : top);
      if (done) win.glide = null;
    }
    await sleep(16);
  }
  ticking = false;
}

// ---------- rolls ----------
let pumping = false;
/** Hands queued rolls to spare windows, one at a time (keeps the stack order). */
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const win = wins.find((w) => w.ready && !w.rollId);
      if (!win) break; // tendPool opens one; its ready message pumps again
      const job = queue.shift()!;
      const now = performance.now();
      win.rollId = job.msg.id;
      const size = waitFor((m) => m.t === "size" && m.slot === win.slot && m.id === job.msg.id, SIZE_TIMEOUT_MS);
      send({ t: "prepare", slot: win.slot, msg: job.msg, collapseIn: job.collapseAt - now, exitIn: job.exitAt - now });
      const m = await size;
      if (!m || m.t !== "size" || win.rollId !== job.msg.id) {
        // the window did not answer: treat it as not loaded, give the roll to another one
        win.ready = false;
        win.rollId = null;
        win.openedAt = 0;
        queue.unshift(job);
        continue;
      }
      // invisible until its page sees this size: size + place in one go, on top of the stack
      win.slotH = m.h;
      win.glide = null;
      put(win, m.w, m.h, nextBottom() - m.h);
      stack.push(win);
    }
  } finally {
    pumping = false;
    void tendPool();
  }
}

const waiters: { match: (m: BusMessage) => boolean; done: (m: BusMessage | null) => void }[] = [];
function waitFor(match: (m: BusMessage) => boolean, ms: number) {
  return new Promise<BusMessage | null>((resolve) => {
    const w = { match, done: resolve };
    waiters.push(w);
    setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      resolve(null);
    }, ms);
  });
}

function onBus(m: BusMessage) {
  for (const w of [...waiters]) if (w.match(m)) {
    waiters.splice(waiters.indexOf(w), 1);
    w.done(m);
  }
  if (m.t === "ready") onReadyMsg(m.slot);
  else if (m.t === "collapse") {
    const win = stack.find((w) => w.slot === m.slot && w.rollId === m.id);
    if (!win) return;
    win.slotH = m.slotH;
    relayout(GLIDE_COLLAPSE);
  } else if (m.t === "gone") {
    const win = wins.find((w) => w.slot === m.slot && w.rollId === m.id);
    if (!win) return;
    win.rollId = null;
    win.glide = null;
    stack = stack.filter((w) => w !== win);
    put(win, 0, 0, BOTTOM()); // empty: the resize can't be seen
    relayout(GLIDE_CLOSE);
    void pump();
  }
}

function receive(msg: RollMessage) {
  if (seen.has(msg.id)) return;
  seen.add(msg.id);
  // end of life is fixed on arrival: fixed delays, never earlier than an older roll
  const collapseAt = Math.max(performance.now() + COLLAPSE_MS, lastCollapse + ORDER_MS);
  const exitAt = Math.max(collapseAt + LINE_MS, lastExit + ORDER_MS);
  lastCollapse = collapseAt;
  lastExit = exitAt;
  queue.push({ msg, collapseAt, exitAt });
  void pump();
}

async function readScreen() {
  try {
    const next = { w: await OBR.viewport.getWidth(), h: await OBR.viewport.getHeight() };
    if (next.w === screen.w && next.h === screen.h) return;
    screen = next;
    relayout(null);
  } catch {
    /* not ready / transient: next poll */
  }
}

/** Call from the background page once OBR is ready. */
export async function startDiceManager() {
  OBR.broadcast.onMessage(DICE_BUS, (e) => onBus(e.data as BusMessage));
  OBR.broadcast.onMessage(ROLL_CHANNEL, (e) => {
    if (isRollMessage(e.data)) receive(e.data);
  });
  void OBR.popover.close(DICE_POPOVER).catch(() => {}); // the single dice popover of earlier versions
  await readScreen();
  send({ t: "hello" }); // windows left open by an earlier run report back
  setInterval(() => {
    void readScreen();
    void tendPool();
  }, 500);
  void tendPool();
}
