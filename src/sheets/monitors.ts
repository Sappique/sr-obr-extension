/**
 * ECG (körperlich) and EEG (psychisch) sweep monitors, ported from mock 16.
 * Each runner + track has a stable seeded character (rate, amplitude, wave shape,
 * phase, jitter) so no two look alike or run in step. State lives per key, not per
 * canvas, so re-rendering the sheet keeps the trace going.
 */
import { State, STATE_COL } from "./model";

function hashStr(s: string) {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (x: number, m: number, s: number) => Math.exp(-((x - m) ** 2) / (2 * s * s));

interface Mon {
  acc: number;
  x: number;
  r: () => number;
  phase0: number;
  rate: number;
  amp: number;
  pA: number;
  tA: number;
  qw: number;
  sA: number;
  tPos: number;
  f: number[];
  fa: number[];
  ph: number[];
  toff: number;
  spikeBias: number;
  alpha: number;
  beta: number;
  buf?: Float32Array;
  ls?: State;
  bl: number;
  bs: number;
  beatAmp: number;
  wide: boolean;
  ro: string;
  ns: number;
  sp: number;
  sa: number;
  width?: number;
}

function makeMon(key: string): Mon {
  const r = rng(hashStr(key));
  return {
    acc: 0,
    x: 0,
    r: rng(hashStr(key + "#jitter")),
    phase0: r(),
    rate: 0.86 + r() * 0.3,
    amp: 0.82 + r() * 0.3,
    pA: 0.07 + r() * 0.09,
    tA: 0.2 + r() * 0.18,
    qw: 0.008 + r() * 0.005,
    sA: 0.16 + r() * 0.18,
    tPos: 0.42 + r() * 0.08,
    f: [0.9 + r() * 0.9, 2.1 + r() * 1.3, 3.9 + r() * 1.8],
    fa: [0.28 + r() * 0.12, 0.13 + r() * 0.1, 0.07 + r() * 0.06],
    ph: [r() * 6.28, r() * 6.28, r() * 6.28],
    toff: r() * 50,
    spikeBias: 0.6 + r() * 0.8,
    alpha: Math.round(8 + r() * 4.9),
    beta: Math.round(17 + r() * 12),
    bl: 1,
    bs: 0,
    beatAmp: 1,
    wide: false,
    ro: "",
    ns: 0,
    sp: -9,
    sa: 1,
  };
}

function interval(m: Mon, s: State) {
  const j = m.r();
  return s === "ok" ? (0.96 + j * 0.1) / m.rate : s === "warn" ? (0.52 + j * 0.07) / m.rate : s === "crit" ? 0.28 + j * 0.52 : Infinity;
}

function ecg(m: Mon, t: number, s: State) {
  if (s !== m.ls) {
    m.ls = s;
    m.bl = interval(m, s);
    m.bs = t - m.phase0 * (isFinite(m.bl) ? m.bl : 1);
    m.beatAmp = 1;
    m.wide = false;
    m.ro = s === "down" ? "---" : Math.round(60 / m.bl) + " BPM";
  }
  while (t >= m.bs + m.bl) {
    m.bs += m.bl;
    m.bl = interval(m, s);
    m.beatAmp = s === "crit" ? 0.45 + m.r() * 0.65 : 0.94 + m.r() * 0.12;
    m.wide = s === "crit" && m.r() < 0.3;
    m.ro = Math.round(60 / m.bl) + " BPM";
  }
  if (s === "down") return (m.r() - 0.5) * 0.02;
  let x = (t - m.bs) / Math.min(1, m.bl / 0.75);
  if (m.wide) x *= 0.62;
  let v =
    m.pA * gauss(x, 0.1, 0.025) - 0.12 * gauss(x, 0.21, 0.008) + gauss(x, 0.235, m.wide ? 0.03 : m.qw) -
    m.sA * gauss(x, 0.262, 0.011) + m.tA * gauss(x, m.tPos, 0.045);
  v *= m.amp * m.beatAmp;
  if (s === "warn") v += (m.r() - 0.5) * 0.03;
  if (s === "crit") v += (m.r() - 0.5) * 0.1 + 0.08 * Math.sin(t * 1.7 + m.ph[0]);
  return v;
}

function eeg(m: Mon, t: number, s: State) {
  const tt = t + m.toff;
  const S = (i: number, mul = 1) => m.fa[i] * Math.sin(2 * Math.PI * m.f[i] * mul * tt + m.ph[i]);
  if (s !== m.ls) {
    m.ls = s;
    m.ro = { ok: `α ${m.alpha} Hz`, warn: `β ${m.beta} Hz`, crit: "SPIKES", down: "FLAT" }[s];
    m.ns = t;
  }
  if (s === "ok") return m.amp * (0.8 + 0.2 * Math.sin(tt * 0.5)) * (S(0) + S(1) + S(2));
  if (s === "warn") return m.amp * 1.25 * (S(0, 2.2) + S(1, 2) + S(2, 1.8)) + (m.r() - 0.5) * 0.08;
  if (s === "down") return (m.r() - 0.5) * 0.025 + 0.02 * Math.sin(tt * 1.9);
  if (t > m.ns) {
    m.sp = t;
    m.ns = t + (0.25 + m.r() * 0.9) * m.spikeBias;
    m.sa = (m.r() < 0.5 ? -1 : 1) * (0.55 + m.r() * 0.4);
  }
  const dd = t - m.sp;
  const spike = dd < 0.03 ? dd / 0.03 : dd < 0.13 ? 1 - (dd - 0.03) / 0.1 : 0;
  return 0.8 * (S(0, 3) + S(1, 3.5)) + m.sa * spike + (m.r() - 0.5) * 0.22;
}

const MONS = new Map<string, Mon>();
let last = performance.now() / 1000;

/**
 * Starts the animation loop. `stateOf(canvas)` returns the current state for a
 * canvas with data-who/data-tr/data-k attributes (or null to skip it).
 */
export function startMonitors(root: ParentNode, stateOf: (cv: HTMLCanvasElement) => State | null) {
  const frame = (now: number) => {
    const t = now / 1000;
    const dt = Math.min(0.1, t - last);
    last = t;
    root.querySelectorAll<HTMLCanvasElement>("canvas.mon-c").forEach((cv) => {
      const s = stateOf(cv);
      if (!s) return;
      const key = `${cv.dataset.who}|${cv.dataset.k}`;
      let m = MONS.get(key);
      if (!m) MONS.set(key, (m = makeMon(key)));
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w) return;
      const dpr = devicePixelRatio || 1;
      const fn = cv.dataset.k === "ecg" ? ecg : eeg;
      const speed = w / 3.2;
      if (!m.buf || m.width !== w) {
        // Pre-fill the history from the generator so the trace starts mid-cycle.
        const n = Math.ceil(w);
        m.buf = new Float32Array(n);
        m.acc = 0;
        m.width = w;
        for (let j = 0; j < n; j++) m.buf[j] = fn(m, t - (n - j) / speed, s);
        m.x = 0;
      }
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      m.acc += speed * dt;
      while (m.acc >= 1) {
        m.acc -= 1;
        m.buf[m.x] = fn(m, t - m.acc / speed, s);
        m.x = (m.x + 1) % m.buf.length;
      }
      const ro = cv.parentElement?.querySelector(".ro");
      if (ro && ro.textContent !== m.ro) ro.textContent = m.ro;
      const ctx = cv.getContext("2d")!;
      const col = STATE_COL[s];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.3;
      ctx.lineJoin = "round";
      ctx.shadowColor = col;
      ctx.shadowBlur = 3;
      const n = m.buf.length;
      const gap = Math.max(6, w * 0.05);
      const yOf = (v: number) => h / 2 - v * h * 0.42;
      ctx.beginPath();
      let pen = false;
      for (let j = 0; j < n; j++) {
        const v = m.buf[j];
        const ahead = (j - m.x + n) % n;
        if (ahead < gap || isNaN(v)) {
          pen = false;
          continue;
        }
        if (!pen) {
          ctx.moveTo(j, yOf(v));
          pen = true;
        } else ctx.lineTo(j, yOf(v));
      }
      ctx.stroke();
      const hv = m.buf[(m.x - 1 + n) % n];
      if (!isNaN(hv)) {
        ctx.fillStyle = col;
        ctx.fillRect(m.x - 2, yOf(hv) - 1, 2.5, 2.5);
      }
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
