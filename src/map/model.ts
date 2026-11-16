import type { Item } from "@owlbear-rodeo/sdk";
import type { Align, LabelSide, LabelState } from "./fan";

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
/** On a label plate: put it next to its icon by its alignment on the next redraw (set by the editor). */
export const LABEL_SNAP_KEY = `${ID}/mapLabelSnap`;
/** On a part: which part it is. */
export const PART_KEY = `${ID}/mapPart`;

export type PlaceKind =
  | "person" | "group" | "corp" | "place" | "club" | "danger" | "home" | "airport" | "harbor" | "magic" | "other";
export const PLACE_KINDS: { id: PlaceKind; label: string }[] = [
  { id: "place", label: "Location" },
  { id: "person", label: "Person" },
  { id: "group", label: "Group" },
  { id: "corp", label: "Corporation" },
  { id: "club", label: "Restaurant / club" },
  { id: "danger", label: "Danger" },
  { id: "home", label: "Home" },
  { id: "airport", label: "Airport" },
  { id: "harbor", label: "Harbor" },
  { id: "magic", label: "Magical" },
  { id: "other", label: "Other" },
];
/** Kinds from before the icon set, mapped to their new kind. */
const OLD_KINDS: Record<string, PlaceKind> = { contact: "person" };

export interface PlaceSpec {
  type: "place";
  /** Line breaks make a multi-line label. */
  name: string;
  kind: PlaceKind;
  align: Align;
  /** For centred labels: above or below the icon (default below). */
  centreSide?: "top" | "bottom";
  /** Overrides the kind's colour. */
  color?: string;
  /** Takes the colour of this crew sheet item, live (e.g. a runner's home). Wins over `color`. */
  colorSheet?: string;
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

/** A location's colour comes from its linked sheet while that sheet exists. */
export function livePlace(spec: PlaceSpec, crew: Map<string, CrewInfo>): PlaceSpec {
  const c = spec.colorSheet ? crew.get(spec.colorSheet) : undefined;
  return c ? { ...spec, color: c.color } : spec;
}

/** What a pin shows: its sheet's current values when linked, else its own. */
export function livePin(spec: PinSpec, crew: Map<string, CrewInfo>): PinSpec {
  const c = spec.sheet ? crew.get(spec.sheet) : undefined;
  return c ? { ...spec, name: c.handle, short: c.initials, color: c.color, order: c.order } : spec;
}
export type MapSpec = PlaceSpec | PinSpec;

/** "map-base": symbol or pin; "map-label": a draggable label plate; "map-part": locked drawing. */
export type MapRole = "map-base" | "map-label" | "map-part";
export type PartName = "bar" | "text" | "initials" | "ring" | "detail" | "slash";

export const mapRole = (item: Item) => item.metadata[MAP_ROLE_KEY] as MapRole | undefined;
export const isMapBase = (item: Item) => mapRole(item) === "map-base";

export function readMapSpec(item: Item): MapSpec | undefined {
  const spec = item.metadata[MAP_SPEC_KEY] as Partial<MapSpec> | undefined;
  if (spec?.type === "place") {
    const place = { name: "", kind: "place", align: "left", ...spec } as PlaceSpec;
    if (!PLACE_KINDS.some((k) => k.id === place.kind)) place.kind = OLD_KINDS[place.kind] ?? "place";
    return place;
  }
  if (spec?.type === "pin") return { name: "", short: "", color: "#f5e10a", ...spec } as PinSpec;
  return undefined;
}

export type LabelMeta = LabelState & { hash: string };

/** The side a location's label snaps to, from its alignment. */
export const labelSide = (spec: PlaceSpec): LabelSide =>
  spec.align === "center" ? (spec.centreSide ?? "bottom") : spec.align;

/** The "Add locations" modal. */
export const IMPORT_MODAL_ID = `${ID}/map-import`;

/** Scene metadata: size of location labels (plate, bar and text), apart from the icons. */
export const LABEL_SCALE_KEY = `${ID}/labelScale`;

/** Size of the icons (locations and pins). */
export const MAP_SCALE = { default: 1, min: 0.4, max: 3, step: 0.05 };
export function readMapScale(metadata: Record<string, unknown>): number {
  const v = metadata[MAP_SCALE_KEY];
  return typeof v === "number" ? v : MAP_SCALE.default;
}
export function readLabelScale(metadata: Record<string, unknown>): number {
  const v = metadata[LABEL_SCALE_KEY];
  return typeof v === "number" ? v : MAP_SCALE.default;
}

/** Scene units per design unit: 100 design units are one grid cell at size 1. */
export const markerUnit = (dpi: number, scale: number) => (dpi / 100) * scale;
/**
 * What 100 % on the sliders means: the icons at half and the labels at 65 %
 * of the drawing's design size (the first version's 50 % and 65 %).
 */
export const ICON_BASE = 0.5;
export const LABEL_BASE = 0.65;
export const iconUnit = (dpi: number, scale: number) => markerUnit(dpi, scale) * ICON_BASE;
export const labelUnitOf = (dpi: number, scale: number) => markerUnit(dpi, scale) * LABEL_BASE;

export const newPlace = (): PlaceSpec => ({ type: "place", name: "Neuer Ort", kind: "place", align: "left" });
export const newPin = (): PinSpec => ({ type: "pin", name: "Runner", short: "RU", color: "#f5e10a" });
