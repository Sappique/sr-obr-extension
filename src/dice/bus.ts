/**
 * Messages between the dice manager (src/dice/manager.ts, in the background page) and the roll
 * windows (dice.html?slot=N, one popover per visible roll). Sent with OBR.broadcast, LOCAL only.
 */
import { DICE_POPOVER } from "../sheets/model";
import { RollMessage } from "./roll";
import { extUrl } from "../core/url";

export const DICE_BUS = `${DICE_POPOVER}/bus`;

/** Transparent padding around a popup inside its window: keeps the square popup corners clear of
 *  OBR's 16 px rounded popover clip (16 × (1 − 1/√2) ≈ 4.7 px). */
export const PAD = 5;
/** Visible gap between two stacked popups. */
export const GAP = 14;

export const windowId = (slot: number) => `${DICE_POPOVER}/${slot}`;
/** Must stay identical for a slot: re-opening a popover with another url reloads its page. */
export const windowUrl = (slot: number) => extUrl(`dice.html?slot=${slot}`);

export type ToWindow =
  /** Manager (re)started: forget any roll and report ready. */
  | { t: "hello" }
  /** Lay out this roll hidden and report its size; show it once the window has that size.
   *  Delays are relative to receipt: collapse to one line, then slide out. */
  | { t: "prepare"; slot: number; msg: RollMessage; collapseIn: number; exitIn: number };

export type ToManager =
  | { t: "ready"; slot: number }
  /** Window size the popup needs (popup + padding). */
  | { t: "size"; slot: number; id: string; w: number; h: number }
  /** The popup starts collapsing; `slotH` is its new height (line + padding). The window keeps its size. */
  | { t: "collapse"; slot: number; id: string; slotH: number }
  /** The line has slid out; the window is empty again. */
  | { t: "gone"; slot: number; id: string };

export type BusMessage = ToWindow | ToManager;
