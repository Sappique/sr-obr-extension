import { Fonts, FontKey } from "../core/fonts";
import { Cmd, polygon, Pt, rect } from "../core/geometry";
import { COLOR } from "../core/style";
import { baselineOffset, drawText, measureText } from "../core/vectorText";
import { hashString } from "../windows/layout";
import { boxLeft, PIN, PinSlot } from "./fan";
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
const LAYOUT_VERSION = 4;

export const KIND_COLOR: Record<PlaceKind, string> = {
  place: COLOR.white,
  contact: COLOR.cyan,
  corp: COLOR.yellow,
  danger: "#ff2848",
  home: COLOR.yellow,
};

const scaled = (cmds: Cmd[], k: number): Cmd[] =>
  cmds.map((c) => [c[0], ...c.slice(1).map((v) => Math.round(v * k * 10) / 10)]);

/**
 * A location icon: an outlined body (dark fill, stroke in the icon colour)
 * plus filled details in the icon colour. Design units, centred on the spot.
 */
interface Icon {
  outer: Pt[][];
  detail: Cmd[];
  /** Half the icon width, for the default label gap. */
  half: number;
}

const ICONS: Partial<Record<PlaceKind, Icon>> = {
  // Mock 14's safehouse: house outline with a filled door.
  home: { outer: [[[0, -12], [12, -2], [12, 12], [-12, 12], [-12, -2]]], detail: rect(-4, 1, 8, 11), half: 12 },
};

/** The older solid glyphs, for kinds without an icon yet. */
function glyph(kind: PlaceKind): Pt[][] {
  const r = 7;
  switch (kind) {
    case "corp":
      return [[[-r, -r], [r - 3, -r], [r, -r + 3], [r, r], [-r, r]]];
    case "contact":
      return [[[0, -r - 1.5], [r + 1.5, 0], [0, r + 1.5], [-r - 1.5, 0]]];
    case "danger":
      return [[[0, -r - 2], [r + 2, r], [-r - 2, r]]];
    case "home":
      // Diamond ring: the inner contour runs the other way, so it stays open.
      return [
        [[0, -r - 2], [r + 2, 0], [0, r + 2], [-r - 2, 0]],
        [[0, -r + 2], [-r + 2, 0], [0, r - 2], [r - 2, 0]],
      ];
    default:
      return [Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2) * 5.5, Math.sin((i / 12) * Math.PI * 2) * 5.5] as Pt)];
  }
}

export interface SymbolLayout {
  base: Shape;
  detail: Shape | null;
  /** The strike line of a broken location. */
  slash: Shape | null;
  /** Half the icon width in scene units. */
  half: number;
  hash: string;
}

const DIMMED = 0.4;

export const placeColor = (spec: PlaceSpec) => spec.color || KIND_COLOR[spec.kind] || COLOR.white;

export function symbolLayout(spec: PlaceSpec, unit: number): SymbolLayout {
  const color = placeColor(spec);
  const dim = spec.broken ? DIMMED : 1;
  const icon = ICONS[spec.kind];
  const base: Shape = icon
    ? {
        commands: scaled(icon.outer.flatMap((p) => polygon(p)), unit),
        color: COLOR.panel,
        opacity: dim,
        stroke: { color, width: 2.5 * unit, opacity: dim },
      }
    : {
        commands: scaled(glyph(spec.kind).flatMap((p) => polygon(p)), unit),
        color,
        opacity: dim,
        stroke: { color: COLOR.panel, width: 1.6 * unit, opacity: dim },
      };
  const half = icon?.half ?? 8;
  // Bottom left to top right, a little past the icon.
  const e = half + 3;
  const t = 1.6;
  const slash: Pt[] = [[-e - t, e - t], [e - t, -e - t], [e + t, -e + t], [-e + t, e + t]];
  return {
    base,
    detail: icon ? { commands: scaled(icon.detail, unit), color, opacity: dim } : null,
    slash: spec.broken ? { commands: scaled(polygon(slash), unit), color, opacity: 1, stroke: { color: COLOR.black, width: 1.2 * unit } } : null,
    half: half * unit,
    hash: hashString(JSON.stringify([LAYOUT_VERSION, "symbol", spec.kind, color, !!spec.broken, unit])),
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
  const size = 15;
  const short = spec.short || spec.name.slice(0, 2).toUpperCase();
  const w = measureText(fonts, "display", short, size);
  const text: Cmd[] = [];
  drawText(text, fonts, "display", short, slot.hx - w / 2, slot.top + baselineOffset(fonts, "display", size, PIN.size), size);
  return {
    pin: { commands: scaled(polygon(slot.outline), unit), color: spec.color, opacity: 1, stroke: { color: COLOR.panel, width: 2 * unit } },
    initials: { commands: scaled(text, unit), color: COLOR.black, opacity: 1 },
    hash: hashString(JSON.stringify([LAYOUT_VERSION, "pin", spec.short, spec.name, spec.color, unit, slot])),
  };
}
