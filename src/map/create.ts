import OBR, { Item, Vector2 } from "@owlbear-rodeo/sdk";
import type { Fonts } from "../core/fonts";
import { defaultAnchor } from "./fan";
import { buildLabel, buildSymbol } from "./items";
import { labelLayout, symbolLayout } from "./layout";
import { CrewInfo, livePlace, markerUnit, PlaceSpec, readLabelScale, readMapScale } from "./model";

/** Scene units per design unit, for icons and for labels. */
export interface MarkerUnits {
  icon: number;
  label: number;
}

export async function readUnits(): Promise<MarkerUnits> {
  const [metadata, dpi] = await Promise.all([OBR.scene.getMetadata(), OBR.scene.grid.getDpi()]);
  return { icon: markerUnit(dpi, readMapScale(metadata)), label: markerUnit(dpi, readLabelScale(metadata)) };
}

/** Gap between an icon's edge and its label plate, in design units of the label. */
export const LABEL_GAP = 7;

/** A location built complete (icon, parts and label), so adding it is one write. */
export function buildLocation(fonts: Fonts, spec: PlaceSpec, position: Vector2, units: MarkerUnits, crew: Map<string, CrewInfo>): Item[] {
  const shown = livePlace(spec, crew);
  const icon = symbolLayout(shown, units.icon);
  const symbol = buildSymbol(spec, position, icon);
  const layout = labelLayout(fonts, shown, units.label);
  if (!layout) return symbol;
  const anchor = defaultAnchor(position, spec.align, layout.width, 1, icon.half + LABEL_GAP * units.label);
  const meta = { unit: units.label, align: spec.align, width: layout.width, hash: layout.hash };
  return [...symbol, ...buildLabel(symbol[0], layout, anchor, meta)];
}
