/**
 * Small popups before a roll, styled like the roll result (designs/17): the runner
 * edge, initials and what is rolled in the header, choices in the body.
 *   askBonus: right click on a roll row; pick bonus dice (and VR if the sheet asks), Roll / Cancel.
 *   askVr:    left click when the sheet has vr_ask; "In VR?" Nein / Ja (+Dn).
 * They live on <body>, outside the re-rendered sheet, and stay inside the popover.
 */
import { esc } from "./markdownHtml";

export interface ExtraDie {
  size: number;
  name: string;
}

export interface AskContext {
  /** Runner colour, initials, and what is rolled ("AGILITÄT + Schleichen"). */
  color: string;
  initials: string;
  what: string;
  /** The row that was clicked; the popup opens next to it. */
  anchor: HTMLElement;
  /** Die size for the VR question, if the sheet asks. */
  vr?: number;
}

const BONUS_SIZES = [4, 6, 8, 10, 12];
const MAX_BONUS = 9;
export const VR_NAME = "VR Bonus";
const BONUS_NAME = "Bonus";

/** Outline per die size in a 60×60 box (as in the roll popup). */
const SHAPE: Record<number, string> = {
  4: "30,5 56,52 4,52",
  6: "8,8 52,8 52,52 8,52",
  8: "30,2 57,30 30,58 3,30",
  10: "30,2 57,33 30,58 3,33",
  12: "30,2 58,23 47,57 13,57 2,23",
};
const face = (size: number) =>
  `<svg viewBox="0 0 60 60"><polygon points="${SHAPE[size]}"/><text x="30" y="34" text-anchor="middle" dominant-baseline="central">${size}</text></svg>`;

let current: { close: (value: ExtraDie[] | null) => void } | null = null;

/** Opens a popup; resolves with the extra dice to roll, or null if cancelled. */
function popup(ctx: AskContext, body: string, wire: (el: HTMLElement, done: (v: ExtraDie[] | null) => void) => void): Promise<ExtraDie[] | null> {
  current?.close(null);
  return new Promise((resolve) => {
    const el = document.createElement("section");
    el.className = "rollask";
    el.style.setProperty("--pc", ctx.color);
    el.innerHTML = `<div class="ra-inner">
      <div class="ra-rh"><span class="ra-ini">${esc(ctx.initials)}</span><span class="ra-what">${esc(ctx.what)}</span></div>
      ${body}
    </div>`;
    document.body.appendChild(el);
    place(el, ctx.anchor);

    const close = (value: ExtraDie[] | null) => {
      if (!el.isConnected) return;
      el.remove();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onOutside, true);
      if (current?.close === close) current = null;
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
    };
    // A press outside the popup cancels it (and does nothing else).
    const onOutside = (e: PointerEvent) => {
      if (el.contains(e.target as Node)) return;
      e.stopPropagation();
      e.preventDefault();
      close(null);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onOutside, true);
    current = { close };
    wire(el, close);
  });
}

/** Next to the clicked row, kept inside the popover's page. */
function place(el: HTMLElement, anchor: HTMLElement) {
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const margin = 6;
  const left = Math.min(Math.max(margin, a.left + 24), window.innerWidth - r.width - margin);
  const below = a.bottom + 4;
  const top = below + r.height <= window.innerHeight - margin ? below : Math.max(margin, a.top - r.height - 4);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/** Right click: choose bonus dice (and VR), then Roll or Cancel. */
export function askBonus(ctx: AskContext): Promise<ExtraDie[] | null> {
  const chosen: number[] = [];
  let vr = false;
  const body = `
    <div class="ra-ab">
      <div class="ra-lbl">BONUS DICE</div>
      <div class="ra-chosen"></div>
      <div class="ra-add">${BONUS_SIZES.map((s) => `<button type="button" class="ra-die" data-add="${s}" title="Add a D${s}">${face(s)}<span>+D${s}</span></button>`).join("")}</div>
      ${ctx.vr ? `<button type="button" class="ra-vr" data-vr aria-pressed="false">In VR (+D${ctx.vr})</button>` : ""}
    </div>
    <div class="ra-af"><button type="button" class="ra-cancel" data-cancel>Cancel</button><button type="button" class="ra-go" data-go>Roll</button></div>`;
  return popup(ctx, body, (el, done) => {
    const list = el.querySelector<HTMLElement>(".ra-chosen")!;
    const show = () => {
      list.innerHTML = chosen.length
        ? chosen.map((s, i) => `<button type="button" class="ra-die ra-picked" data-del="${i}" title="Remove">${face(s)}</button>`).join("")
        : `<span class="ra-none">none</span>`;
      for (const b of el.querySelectorAll<HTMLButtonElement>("[data-add]")) b.disabled = chosen.length >= MAX_BONUS;
    };
    show();
    el.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!t) return;
      const d = t.dataset;
      if (d.add) chosen.push(Number(d.add));
      else if (d.del !== undefined) chosen.splice(Number(d.del), 1);
      else if (d.vr !== undefined) {
        vr = !vr;
        t.setAttribute("aria-pressed", String(vr));
      } else if (d.cancel !== undefined) return done(null);
      else if (d.go !== undefined) {
        const extras = chosen.map((size) => ({ size, name: BONUS_NAME }));
        if (vr && ctx.vr) extras.push({ size: ctx.vr, name: VR_NAME });
        return done(extras);
      }
      show();
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.querySelector<HTMLButtonElement>("[data-go]")!.focus();
  });
}

/** Left click on a sheet with vr_ask: "In VR?" Nein / Ja (+Dn). */
export function askVr(ctx: AskContext & { vr: number }): Promise<ExtraDie[] | null> {
  const body = `
    <div class="ra-ab ra-q">In VR?</div>
    <div class="ra-af"><button type="button" class="ra-cancel" data-no>Nein</button><button type="button" class="ra-go" data-yes>Ja (+D${ctx.vr})</button></div>`;
  return popup(ctx, body, (el, done) => {
    el.querySelector("[data-no]")!.addEventListener("click", () => done([]));
    el.querySelector("[data-yes]")!.addEventListener("click", () => done([{ size: ctx.vr, name: VR_NAME }]));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.querySelector<HTMLButtonElement>("[data-yes]")!.focus();
  });
}
