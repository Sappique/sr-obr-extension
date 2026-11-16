import { loadFonts } from "../core/fonts";
import { Cmd, windowOutline } from "../core/geometry";
import { COLOR, SCALE, windowTokens } from "../core/style";
import { SAMPLES } from "../windows/samples";
import { RUNNER_COLORS } from "../core/style";
import { layoutWindow, Part, WindowKind } from "../windows/layout";

/** Dev-only: renders one window per kind (or ?kind=…&w=…) exactly as it goes into the scene. */
const params = new URLSearchParams(location.search);
const uiScale = Number(params.get("scale") ?? 1);
const W = windowTokens(uiScale);

const toD = (commands: Cmd[]) =>
  commands.map((c) => `${{ 0: "M", 1: "L", 2: "Q", 4: "C", 5: "Z" }[c[0]]}${c.slice(1).join(" ")}`).join("");
const ORDER: Part["layer"][] = ["shadow", "base", "fill", "text"];

async function main() {
  const fonts = await loadFonts();
  const only = params.get("kind") as WindowKind | null;
  const kinds = (only ? [only] : (Object.keys(SAMPLES) as WindowKind[]));
  let html = "";
  const stats: unknown[] = [];
  for (const kind of kinds) {
    const sample = SAMPLES[kind];
    const width = Number(params.get("w") ?? sample.width) * SCALE * uiScale;
    // No crew sheets here: the HANDOFF runner colours stand in for them.
    const crewColors = { Phlox: RUNNER_COLORS.phlox, Hawk: RUNNER_COLORS.hawk, Peppermint: RUNNER_COLORS.peppermint };
    const layout = layoutWindow(fonts, { ...sample.spec, crewColors }, width, uiScale);
    const pad = 40;
    const points = windowOutline(width, layout.height, W.cut).map((p) => p.join(",")).join(" ");
    let svg = `<g transform="translate(${pad} ${pad})">`;
    const path = (p: Part) => `<path transform="translate(0 ${p.offsetY})" d="${toD(p.commands)}" fill="${p.color}" fill-opacity="${p.opacity}"/>`;
    svg += layout.parts.filter((p) => p.layer === "shadow").map(path).join("");
    svg += `<polygon points="${points}" fill="${COLOR.panel}" stroke="${COLOR.yellow}" stroke-width="${W.border}"/>`;
    for (const layer of ORDER.slice(1)) svg += layout.parts.filter((p) => p.layer === layer).map(path).join("");
    svg += "</g>";
    html += `<svg id="k-${kind}" xmlns="http://www.w3.org/2000/svg" width="${width + 2 * pad}" height="${layout.height + 2 * pad}">${svg}</svg>`;
    const bytes = layout.parts.map((p) => JSON.stringify(p.commands).length);
    stats.push({ kind, parts: layout.parts.length, kB: Math.round(bytes.reduce((a, b) => a + b, 0) / 1000), largest: Math.max(...bytes), height: Math.round(layout.height) });
  }
  document.getElementById("stage")!.innerHTML = html;
  document.getElementById("out")!.textContent = stats.map((s) => JSON.stringify(s)).join("\n");
  (window as unknown as { __stats: unknown }).__stats = stats;
}
void main();
