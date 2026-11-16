import type { Item } from "@owlbear-rodeo/sdk";
import { Align, LabelState } from "./fan";

/**
 * Map markers. A location marker is its symbol (the item you drag) with a
 * label plate attached to it, which can be dragged on its own; the plate's
 * edge bar and text are locked parts attached to the plate. A runner pin is
 * one item drawn at its tip, with its initials as a locked part.
 */
export const ID = "sappique.sr-obr";
export const MAP_ROLE_KEY = `${ID}/mapRole`;
export const MAP_SPEC_KEY = `${ID}/map`;
export const MAP_HASH_KEY = `${ID}/mapHash`;
export const MAP_SCALE_KEY = `${ID}/mapScale`;
/** On a label plate: what it was last drawn with (LabelState + hash). */
export const LABEL_KEY = `${ID}/mapLabel`;
/** On a part: which part it is. */
export const PART_KEY = `${ID}/mapPart`;

export type PlaceKind = "place" | "contact" | "corp" | "danger" | "home";
export const PLACE_KINDS: PlaceKind[] = ["place", "contact", "corp", "danger", "home"];

export interface PlaceSpec {
  type: "place";
  /** Line breaks make a multi-line label. */
  name: string;
  kind: PlaceKind;
  align: Align;
  /** Overrides the kind's colour (e.g. a runner's safehouse). */
  color?: string;
  /** Destroyed, burned or no longer in use: icon dimmed and struck through. */
  broken?: boolean;
}
export interface PinSpec {
  type: "pin";
  name: string;
  short: string;
  color: string;
  /**
   * Linked pin: the crew sheet item it shows. Name, initials, colour and order
   * then come from the sheet live; the fields here are only the last known
   * copy, used if the sheet is gone. Without it the pin is custom.
   */
  sheet?: string;
  /** Crew order, for the order inside a group. */
  order?: number;
}

export interface CrewInfo {
  handle: string;
  initials: string;
  color: string;
  order: number;
}

/** What a pin shows: its sheet's current values when linked, else its own. */
export function livePin(spec: PinSpec, crew: Map<string, CrewInfo>): PinSpec {
  const c = spec.sheet ? crew.get(spec.sheet) : undefined;
  return c ? { ...spec, name: c.handle, short: c.initials, color: c.color, order: c.order } : spec;
}
export type MapSpec = PlaceSpec | PinSpec;

/** "map-base": symbol or pin; "map-label": a draggable label plate; "map-part": locked drawing. */
export type MapRole = "map-base" | "map-label" | "map-part";
export type PartName = "bar" | "text" | "initials" | "detail" | "slash";

export const mapRole = (item: Item) => item.metadata[MAP_ROLE_KEY] as MapRole | undefined;
export const isMapBase = (item: Item) => mapRole(item) === "map-base";

export function readMapSpec(item: Item): MapSpec | undefined {
  const spec = item.metadata[MAP_SPEC_KEY] as Partial<MapSpec> | undefined;
  if (spec?.type === "place") return { name: "", kind: "place", align: "left", ...spec } as PlaceSpec;
  if (spec?.type === "pin") return { name: "", short: "", color: "#f5e10a", ...spec } as PinSpec;
  return undefined;
}

export type LabelMeta = LabelState & { hash: string };

export const MAP_SCALE = { default: 1, min: 0.4, max: 3, step: 0.05 };
export function readMapScale(metadata: Record<string, unknown>): number {
  const v = metadata[MAP_SCALE_KEY];
  return typeof v === "number" ? v : MAP_SCALE.default;
}

/** Scene units per design unit: 100 design units are one grid cell at size 1. */
export const markerUnit = (dpi: number, scale: number) => (dpi / 100) * scale;

export const newPlace = (): PlaceSpec => ({ type: "place", name: "Neuer Ort", kind: "place", align: "left" });
export const newPin = (): PinSpec => ({ type: "pin", name: "Runner", short: "RU", color: "#f5e10a" });
