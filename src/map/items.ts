import { buildPath, Item, Layer, Path, PathCommand, Vector2 } from "@owlbear-rodeo/sdk";
import type { Cmd } from "../core/geometry";
import type { LabelLayout, PinLayout, Shape, SymbolLayout } from "./layout";
import {
  LABEL_KEY, LabelMeta, MAP_HASH_KEY, MAP_ROLE_KEY, MAP_SPEC_KEY, MapRole, MapSpec, PART_KEY, PartName, PinSpec, PlaceSpec,
} from "./model";

/** Pins sit with the characters (players may move them), locations on Prop. */
export const LAYER_OF: Record<MapSpec["type"], Layer> = { place: "PROP", pin: "CHARACTER" };

export const toObr = (c: Cmd[]) => c as unknown as PathCommand[];

/** Writes a shape onto a Path draft or a freshly built Path. */
export function applyShape(path: Path, shape: Shape) {
  path.commands = toObr(shape.commands);
  path.style.fillColor = shape.color;
  path.style.fillOpacity = shape.opacity;
  path.style.strokeColor = shape.stroke?.color ?? "#000000";
  path.style.strokeOpacity = shape.stroke ? (shape.stroke.opacity ?? 1) : 0;
  path.style.strokeWidth = shape.stroke?.width ?? 0;
}

function shapePath(name: string, position: Vector2, shape: Shape, layer: Layer, role: MapRole): Path {
  const path = buildPath().name(name).position(position).fillRule("nonzero").layer(layer).build();
  applyShape(path, shape);
  path.metadata[MAP_ROLE_KEY] = role;
  return path;
}

/** A locked, click-through drawing that follows `owner`. */
export function buildPart(owner: Item, name: PartName, shape: Shape, zIndex: number): Path {
  const path = shapePath("Map marker part", owner.position, shape, owner.layer, "map-part");
  path.attachedTo = owner.id;
  path.locked = true;
  path.disableHit = true;
  path.disableAttachmentBehavior = ["SCALE", "ROTATION", "LOCKED"];
  path.visible = owner.visible;
  path.zIndex = zIndex;
  path.metadata[PART_KEY] = name;
  return path;
}

/** The icon body (the item you drag) plus its locked detail and strike line. */
export function buildSymbol(spec: PlaceSpec, position: Vector2, layout: SymbolLayout): Path[] {
  const path = shapePath(spec.name.split("\n")[0] || "Ort", position, layout.base, LAYER_OF.place, "map-base");
  path.metadata[MAP_SPEC_KEY] = spec;
  path.metadata[MAP_HASH_KEY] = layout.hash;
  const out = [path];
  if (layout.detail) out.push(buildPart(path, "detail", layout.detail, path.zIndex + 1));
  if (layout.slash) out.push(buildPart(path, "slash", layout.slash, path.zIndex + 2));
  return out;
}

/** The label plate (draggable, follows the symbol) plus its bar and text. */
export function buildLabel(symbol: Item, layout: LabelLayout, anchor: Vector2, meta: LabelMeta): Path[] {
  const z = Date.now();
  const plate = shapePath("Map label", anchor, layout.plate, symbol.layer, "map-label");
  plate.attachedTo = symbol.id;
  plate.disableAttachmentBehavior = ["SCALE", "ROTATION", "LOCKED"];
  plate.visible = symbol.visible;
  plate.zIndex = z;
  plate.metadata[LABEL_KEY] = meta;
  return [plate, buildPart(plate, "bar", layout.bar, z + 1), buildPart(plate, "text", layout.text, z + 2)];
}

export function buildPin(spec: PinSpec, tip: Vector2, layout: PinLayout): Path[] {
  const pin = shapePath(spec.name || "Pin", tip, layout.pin, LAYER_OF.pin, "map-base");
  pin.metadata[MAP_SPEC_KEY] = spec;
  pin.metadata[MAP_HASH_KEY] = layout.hash;
  return [pin, buildPart(pin, "initials", layout.initials, Date.now() + 1)];
}
