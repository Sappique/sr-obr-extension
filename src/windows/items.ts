import {
  buildCurve,
  buildEffect,
  buildPath,

  Curve,
  Item,
  Layer,
  Path,
  PathCommand,
  Vector2,
} from "@owlbear-rodeo/sdk";
import { Cmd, diamondPoints, FlowSegment, flowSegments, polygon, Pt, RoutedLink, routePorts } from "../core/geometry";
import { COLOR, UI_SCALE, WindowTokens } from "../core/style";
import { Part, PartLayer, WindowSpec } from "./layout";

export const ID = "sappique.sr-obr";
export const ROLE_KEY = `${ID}/role`;
export const SPEC_KEY = `${ID}/window`;
export const RENDER_KEY = `${ID}/rendered`;
export const HASH_KEY = `${ID}/hash`;
export const LINK_KEY = `${ID}/link`;
export const NET_KEY = `${ID}/network`;
export const LINKS_KEY = `${ID}/links`;
export const ROUTE_KEY = `${ID}/route`;
/** Scene metadata: the global window scale. */
export const UI_SCALE_KEY = `${ID}/uiScale`;
/** Per-browser: animated connector dashes (default on). Also the live broadcast channel. */
export const ANIMATED_KEY = `${ID}/animatedLinks`;
/** On connector line items: what each client needs to draw the animation. */
export const FLOW_KEY = `${ID}/flow`;
export const FLOW_ROLE = "flow-effect";

export type Role = "frame" | "part" | "network" | "connector" | "port" | typeof FLOW_ROLE;

export interface RenderState {
  key: string;
  parts: number;
  height: number;
}
export interface Link {
  from: string;
  to: string;
}

export function readAnimated(): boolean {
  try {
    return localStorage.getItem(ANIMATED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeAnimated(on: boolean) {
  try {
    localStorage.setItem(ANIMATED_KEY, String(on));
  } catch {
    // Blocked storage: the setting lasts for this session only.
  }
}

export function readUiScale(metadata: Record<string, unknown>): number {
  const value = metadata[UI_SCALE_KEY];
  return typeof value === "number" ? value : UI_SCALE.default;
}

export const roleOf = (item: Item) => item.metadata[ROLE_KEY] as Role | undefined;
export const isFrame = (item: Item): item is Curve => roleOf(item) === "frame";

export const DEFAULT_SPEC: WindowSpec = {
  title: "Neues Fenster",
  tag: "",
  variant: "standard",
  markdown: "## Allgemein\n\nText",
};

export function readSpec(frame: Item): WindowSpec {
  return { ...DEFAULT_SPEC, ...(frame.metadata[SPEC_KEY] as Partial<WindowSpec> | undefined) };
}

const LAYERS: Record<PartLayer, Layer> = { shadow: "DRAWING", base: "ATTACHMENT", fill: "ATTACHMENT", text: "NOTE" };
/** Frames sit on one layer so players can be denied it in the room permissions. */
export const FRAME_LAYER: Layer = "PROP";

export function outlinePoints(points: Pt[]): Vector2[] {
  return points.map(([x, y]) => ({ x, y }));
}

export function buildFrame(position: Vector2, points: Pt[], spec: WindowSpec, t: WindowTokens): Curve {
  return buildCurve()
    .name(spec.title)
    .position(position)
    .points(outlinePoints(points))
    .tension(0)
    .closed(true)
    .fillColor(COLOR.panel)
    .fillOpacity(1)
    .strokeColor(COLOR.yellow)
    .strokeOpacity(1)
    .strokeWidth(t.border)
    .layer(FRAME_LAYER)
    .metadata({ [ROLE_KEY]: "frame", [SPEC_KEY]: spec })
    .build();
}

export const toObr = (commands: Cmd[]) => commands as unknown as PathCommand[];

export function buildPart(frame: Curve, part: Part, position: Vector2): Path {
  const builder = buildPath();
  // Items in one layer sort by zIndex, which defaults to creation time. A
  // regenerated band must not end up above a reused tag fill.
  if (part.layer === "base") builder.zIndex(0).disableAutoZIndex(true);
  return builder
    .name("Window part")
    .position(position)
    .rotation(frame.rotation)
    .commands(toObr(part.commands))
    .fillRule("nonzero")
    .fillColor(part.color)
    .fillOpacity(part.opacity)
    .strokeWidth(0)
    .strokeOpacity(0)
    .layer(LAYERS[part.layer])
    .attachedTo(frame.id)
    .locked(true)
    .disableHit(true)
    .disableAttachmentBehavior(["SCALE", "LOCKED"])
    .visible(frame.visible)
    .metadata({ [ROLE_KEY]: "part", [HASH_KEY]: part.hash })
    .build();
}

// ---------------------------------------------------------------------------
// Connectors: all links are drawn together, so shared stretches appear once.
// Four items: line and ports, for links players see and links only the GM sees.
// The visible line item holds the list of links.

export interface NetworkInfo {
  kind: "line" | "ports";
  shown: boolean;
}

export const EMPTY_PATH: Cmd[] = [[0, 0, 0]];
export const netInfo = (item: Item) => item.metadata[NET_KEY] as NetworkInfo;
const EMPTY = EMPTY_PATH;

export function networkCommands(routes: RoutedLink[], t: WindowTokens) {
  const ports = routePorts(routes);
  const r = t.connector.portRadius;
  return {
    flow: flowSegments(routes),
    ports: ports.length ? ports.flatMap(([x, y]) => polygon(diamondPoints(x, y, r))) : EMPTY,
  };
}

/** Ports sit above the windows' header fills. */
export const PORT_LAYER: Layer = "NOTE";

export function buildNetwork(links: Link[], t: WindowTokens): Item[] {
  const c = t.connector;
  return [true, false].flatMap((shown) => {
    const lineItem = buildPath()
      .name("Connectors")
      .position({ x: 0, y: 0 })
      .commands(toObr(EMPTY))
      .fillOpacity(0)
      .strokeOpacity(0)
      .strokeWidth(0)
      .layer("DRAWING")
      .locked(true)
      .disableHit(true)
      .visible(shown)
      .metadata({
        [ROLE_KEY]: "network",
        [NET_KEY]: { kind: "line", shown } satisfies NetworkInfo,
        ...(shown ? { [LINKS_KEY]: links, [ROUTE_KEY]: "" } : {}),
      })
      .build();
    const portItem = buildPath()
      .name("Connector ports")
      .position({ x: 0, y: 0 })
      .commands(toObr(EMPTY))
      .fillColor(COLOR.sceneBg)
      .fillOpacity(1)
      .strokeColor(COLOR.yellow)
      .strokeOpacity(1)
      .strokeWidth(c.width)
      .layer(PORT_LAYER)
      .locked(true)
      .disableHit(true)
      .visible(shown)
      .metadata({ [ROLE_KEY]: "network", [NET_KEY]: { kind: "ports", shown } satisfies NetworkInfo })
      .build();
    return [lineItem, portItem];
  });
}

// ---------------------------------------------------------------------------
// Animated dashes. Effects are local-only in OBR, so every client builds its
// own from the data the GM stores on the connector line items.

export interface FlowData {
  width: number;
  dash: number;
  gap: number;
  opacity: number;
  segments: FlowSegment[];
}

/**
 * One straight piece of a link. The rectangle is padded well beyond the line
 * so it always covers whole screen pixels; the line inside is drawn by
 * coverage. Each piece covers its flow range (w/2, L + w/2]: the end overlaps
 * the next corner and the start leaves it out, so every point is drawn once.
 */
const FLOW_SKSL = `
uniform vec2 size;
uniform float time;
uniform mat3 modelView;
uniform float segLength;
uniform float thickness;
uniform float pad;
uniform float horizontal;
uniform float reversed;
uniform float startPhase;
uniform float dashLength;
uniform float gapLength;
uniform float lineOpacity;
uniform float flowSpeed;
uniform vec3 lineColor;

half4 main(float2 coord) {
  // Screen pixels per scene unit. Taking only the linear part of the matrix
  // gives the same length whichever way round it is stored.
  float px = max(length((vec3(1.0, 0.0, 0.0) * modelView).xy), 0.0001);

  float raw = (horizontal > 0.5 ? coord.x : coord.y) - pad;
  float across = (horizontal > 0.5 ? coord.y : coord.x) - pad;
  float f = reversed > 0.5 ? segLength - raw : raw;

  // Never thinner than one screen pixel; fade instead so it doesn't look heavier.
  float w = max(thickness, 1.0 / px);
  float thin = thickness / w;
  float hw = w * 0.5;
  float coverAcross = clamp((hw - abs(across)) * px + 0.5, 0.0, 1.0);
  float coverAlong = clamp((f - hw) * px + 0.5, 0.0, 1.0)
                   * clamp((segLength + hw - f) * px + 0.5, 0.0, 1.0);

  float cycle = dashLength + gapLength;
  // Two dash cycles per 1.4 s, as in design 14. fract() keeps the value small.
  float shift = fract(time / 1.4) * 2.0 * cycle * flowSpeed;
  float u = mod(startPhase + f - shift, cycle);
  float dash = u < dashLength
    ? clamp(min(u, dashLength - u) * px + 0.5, 0.0, 1.0)
    : clamp(0.5 - min(u - dashLength, cycle - u) * px, 0.0, 1.0);
  // Dashes a few pixels long would shimmer: blend into an even, fainter line.
  dash = mix(dashLength / cycle, dash, smoothstep(4.0, 8.0, cycle * px));

  float a = coverAcross * coverAlong * dash * thin * lineOpacity;
  return half4(lineColor * a, a);
}
`;

/** Scene units of padding around each piece; keeps it several pixels wide when zoomed out. */
const FLOW_PAD = 24;

const YELLOW = { x: 245 / 255, y: 225 / 255, z: 10 / 255 };

export function buildFlowEffect(segment: FlowSegment, data: FlowData, opacity: number, speed: number, key: string) {
  const { x0, y0, x1, y1, phase } = segment;
  const horizontal = y0 === y1;
  const length = Math.abs(horizontal ? x1 - x0 : y1 - y0);
  const reversed = horizontal ? x1 < x0 : y1 < y0;
  const pad = Math.max(FLOW_PAD, data.width * 2);
  return buildEffect()
    .name("Connector flow")
    .effectType("STANDALONE")
    .position({ x: Math.min(x0, x1) - pad, y: Math.min(y0, y1) - pad })
    .width(horizontal ? length + 2 * pad : 2 * pad)
    .height(horizontal ? 2 * pad : length + 2 * pad)
    .sksl(FLOW_SKSL)
    .uniforms([
      { name: "segLength", value: length },
      { name: "thickness", value: data.width },
      { name: "pad", value: pad },
      { name: "horizontal", value: horizontal ? 1 : 0 },
      { name: "reversed", value: reversed ? 1 : 0 },
      { name: "startPhase", value: phase % (data.dash + data.gap) },
      { name: "dashLength", value: data.dash },
      { name: "gapLength", value: data.gap },
      { name: "lineOpacity", value: opacity },
      { name: "flowSpeed", value: speed },
      { name: "lineColor", value: YELLOW },
    ])
    .layer("DRAWING")
    .locked(true)
    .disableHit(true)
    .metadata({ [ROLE_KEY]: FLOW_ROLE, [FLOW_KEY]: key })
    .build();
}
