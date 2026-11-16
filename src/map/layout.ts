import { Fonts, FontKey } from "../core/fonts";
import { Cmd, polygon, Pt, rect } from "../core/geometry";
import { COLOR } from "../core/style";
import { baselineOffset, drawText, measureText } from "../core/vectorText";
import { hashString } from "../windows/layout";
import { boxLeft, PinSlot } from "./fan";
import { bandInside, body, cutBand, ICON_HALF, IconId, ICONS, Poly, slash } from "./icons";
import type { PinSpec, PlaceKind, PlaceSpec } from "./model";

/**
 * Geometry of map markers, already in scene units. Every shape is relative to
 * the item that carries it: the symbol, the label anchor or the pin tip.
 */
export interface Shape {
  commands: Cmd[];
  color: string;
  opacity: number;
  stroke?: { color: string; width: number; opacity?: number };
}

/** Bump when the drawing changes, so existing markers redraw. */
const LAYOUT_VERSION = 5;

/** Default colour per kind (a custom or sheet colour overrides it). */
export const KIND_COLOR: Record<PlaceKind, string> = {
  person: COLOR.cyan,
  group: COLOR.cyan,
  corp: COLOR.yellow,
  place: COLOR.white,
  club: "#ff5fa2",
  danger: "#ff2848",
  home: "#a46cff",
  airport: "#6fb4ff",
  harbor: "#6fb4ff",
  magic: "#e07bff",
  other: "#9aa6ad",
};

const KIND_ICON: Record<PlaceKind, IconId> = {
  person: "person",
  group: "group",
  corp: "corp",
  place: "poi",
  club: "bar",
  danger: "danger",
  home: "home",
  airport: "plane",
  harbor: "docks",
  magic: "ley",
  other: "info",
};

const scaled = (cmds: Cmd[], k: number): Cmd[] =>
  cmds.map((c) => [c[0], ...c.slice(1).map((v) => Math.round(v * k * 10) / 10)]);
const toCmds = (polys: Poly[], k: number) => scaled(polys.flatMap((s) => polygon(s.p)), k);

/**
 * A location icon in four items: the dark inside (the item you drag), the
 * outline ring and the details in the icon colour, and for a broken location
 * the strike line. A broken icon has a gap cut around the line.
 */
export interface SymbolLayout {
  base: Shape;
  ring: Shape;
  detail: Shape | null;
  /** TEMP: the cut area filled black (broken style "black"). */
  slashGap: Shape | null;
  slash: Shape | null;
  /** Half the icon width in scene units. */
  half: number;
  hash: string;
}

// ---------------------------------------------------------------------------
// TEMP settings while choosing (scene metadata, set in the options popover).

/** How a broken location's strike line meets the icon. */
export type BrokenStyle = "gap" | "black" | "none";
export const BROKEN_STYLES: { id: BrokenStyle; label: string }[] = [
  { id: "gap", label: "Gap (cut out)" },
  { id: "black", label: "Black (cut area filled black)" },
  { id: "none", label: "No cut (line on top)" },
];
/** Corporation colour candidates, away from the other kinds' and the runners' colours. */
export const CORP_COLORS: { id: string; label: string }[] = [
  { id: "#f5e10a", label: "Yellow (UI accent, current)" },
  { id: "#ffb000", label: "Gold" },
  { id: "#d98c5f", label: "Copper" },
  { id: "#c9d4dc", label: "Chrome" },
  { id: "#16d3b0", label: "Teal" },
  { id: "#b5f000", label: "Chartreuse" },
  { id: "#6f7cff", label: "Indigo" },
  // Reds: darker or cooler than the danger red (#ff2848).
  { id: "#d6203f", label: "Crimson" },
  { id: "#b3122e", label: "Blood red" },
  { id: "#c2345a", label: "Raspberry" },
  { id: "#ff4a2e", label: "Signal red" },
  // Darker blues than the airport's light blue (#6fb4ff).
  { id: "#2f6bff", label: "Royal blue" },
  { id: "#3355d6", label: "Cobalt" },
  { id: "#4f78b5", label: "Steel blue" },
  { id: "#2a4aa8", label: "Navy" },
];
export const TEMP = { broken: "gap" as BrokenStyle, corp: "#f5e10a" };
export const BROKEN_STYLE_KEY = "sappique.sr-obr/tempBrokenStyle";
export const CORP_COLOR_KEY = "sappique.sr-obr/tempCorpColor";
/** Reads the temp settings from scene metadata; returns true if anything changed. */
export function applyTempSettings(metadata: Record<string, unknown>): boolean {
  const broken = BROKEN_STYLES.some((b) => b.id === metadata[BROKEN_STYLE_KEY]) ? (metadata[BROKEN_STYLE_KEY] as BrokenStyle) : "gap";
  const corp = typeof metadata[CORP_COLOR_KEY] === "string" ? (metadata[CORP_COLOR_KEY] as string) : "#f5e10a";
  const changed = broken !== TEMP.broken || corp !== TEMP.corp;
  TEMP.broken = broken;
  TEMP.corp = corp;
  return changed;
}

const kindColor = (kind: PlaceKind) => (kind === "corp" ? TEMP.corp : KIND_COLOR[kind]);
export const placeColor = (spec: PlaceSpec) => spec.color || kindColor(spec.kind) || COLOR.white;

export function symbolLayout(spec: PlaceSpec, unit: number): SymbolLayout {
  const color = placeColor(spec);
  const icon = ICONS[KIND_ICON[spec.kind] ?? "poi"]();
  const parts = body(icon);
  const style = spec.broken ? TEMP.broken : null;
  const cut = (polys: Poly[]) => (style === "gap" ? cutBand(polys) : polys);
  const detail = cut(icon.detail);
  return {
    base: { commands: toCmds(cut(parts.inside), unit), color: COLOR.panel, opacity: 1 },
    ring: { commands: toCmds(cut(parts.ring), unit), color, opacity: 1 },
    detail: detail.length ? { commands: toCmds(detail, unit), color, opacity: 1 } : null,
    slashGap: style === "black" ? { commands: toCmds(bandInside(icon), unit), color: COLOR.black, opacity: 1 } : null,
    slash: spec.broken ? { commands: toCmds([slash()], unit), color, opacity: 1 } : null,
    half: ICON_HALF * unit,
    hash: hashString(JSON.stringify([LAYOUT_VERSION, "symbol", spec.kind, color, style, unit])),
  };
}

const LABEL = { size: 15, lineHeight: 19, padBar: 7, padFar: 8, padY: 1, bar: 1.5, cut: 4, plateOpacity: 0.78 };

export const labelLines = (name: string) => name.replace(/\s+$/, "").split("\n").map((l) => l.trimEnd());

export interface LabelLayout {
  plate: Shape;
  bar: Shape;
  text: Shape;
  /** Plate width in scene units. */
  width: number;
  /** Plate height in scene units. */
  height: number;
  hash: string;
}

/** The label plate around the anchor (see boxLeft), or null for an empty name. */
export function labelLayout(fonts: Fonts, spec: PlaceSpec, unit: number): LabelLayout | null {
  const lines = labelLines(spec.name);
  if (!lines.some((l) => l.trim())) return null;
  const L = LABEL;
  const font: FontKey = "bold";
  const widths = lines.map((l) => measureText(fonts, font, l, L.size, { spacing: 0.02 }));
  const inner = Math.max(...widths);
  const w = inner + L.padBar + L.padFar;
  const h = lines.length * L.lineHeight + 2 * L.padY;
  const barRight = spec.align === "right";
  const left = boxLeft(spec.align, w);
  const top = -h / 2;
  const right = left + w;
  const bottom = top + h;
  const c = L.cut;
  // The cut corner sits away from the edge bar.
  const plate: Pt[] = barRight
    ? [[left, top], [right, top], [right, bottom], [left + c, bottom], [left, bottom - c]]
    : [[left, top], [right, top], [right, bottom - c], [right - c, bottom], [left, bottom]];
  const textLeft = left + (barRight ? L.padFar : L.padBar);
  const text: Cmd[] = [];
  const baseline = baselineOffset(fonts, font, L.size, L.lineHeight);
  lines.forEach((line, i) => {
    const x =
      spec.align === "left" ? textLeft : spec.align === "center" ? textLeft + (inner - widths[i]) / 2 : textLeft + inner - widths[i];
    drawText(text, fonts, font, line, x, top + L.padY + i * L.lineHeight + baseline, L.size, { spacing: 0.02 });
  });
  const color = placeColor(spec);
  return {
    plate: { commands: scaled(polygon(plate), unit), color: COLOR.panel, opacity: L.plateOpacity },
    bar: { commands: scaled(rect(barRight ? right - L.bar : left, top, L.bar, h), unit), color, opacity: 1 },
    text: { commands: scaled(text, unit), color: spec.kind === "danger" ? "#ff8a9a" : COLOR.white, opacity: 1 },
    width: Math.round(w * unit * 10) / 10,
    height: Math.round(h * unit * 10) / 10,
    hash: hashString(JSON.stringify([LAYOUT_VERSION, "label", spec.name, spec.kind, color, spec.align, unit])),
  };
}

export interface PinLayout {
  pin: Shape;
  initials: Shape;
  hash: string;
}

/** A pin drawn at its slot (head and pointer relative to the tip at (0, 0)). */
export function pinLayout(fonts: Fonts, spec: PinSpec, unit: number, slot: PinSlot): PinLayout {
  const { size, stack } = slot.text;
  const short = spec.short || spec.name.slice(0, 2).toUpperCase();
  const text: Cmd[] = [];
  // Side by side, or one letter per line through the head's height.
  const lines = stack ? Array.from(short) : [short];
  const lineHeight = stack ? Math.min(size * 1.15, (slot.h - 2) / lines.length) : slot.h;
  const first = slot.top + (slot.h - lineHeight * lines.length) / 2;
  lines.forEach((line, i) => {
    const w = measureText(fonts, "display", line, size);
    drawText(text, fonts, "display", line, slot.hx - w / 2, first + i * lineHeight + baselineOffset(fonts, "display", size, lineHeight), size);
  });
  return {
    pin: { commands: scaled(polygon(slot.outline), unit), color: spec.color, opacity: 1, stroke: { color: COLOR.panel, width: 2 * unit } },
    initials: { commands: scaled(text, unit), color: COLOR.black, opacity: 1 },
    hash: hashString(JSON.stringify([LAYOUT_VERSION, "pin", spec.short, spec.name, spec.color, unit, slot])),
  };
}
