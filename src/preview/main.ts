import { loadFonts } from "../core/fonts";
import { Box, Cmd, diamondPoints, drawRoutes, flowSegments, Pt, routeLinks, windowOutline } from "../core/geometry";
import { COLOR, windowTokens } from "../core/style";
import { layoutWindow, Part, WindowSpec } from "../windows/layout";
import dataSource from "../../../designs/assets/data.js?raw";

/** Dev-only: draws the exact generated commands as SVG, using the mock content. */
type Section = [string, string | string[]];
interface Node {
  id: string;
  kind: string;
  title: string;
  sections: Section[];
}

const uiScale = Number(new URLSearchParams(location.search).get("scale") ?? 1);
const WINDOW = windowTokens(uiScale);

const sandbox = {} as { SR: { RUN: { nodes: Node[] } } };
new Function("window", dataSource)(sandbox);
const nodes = sandbox.SR.RUN.nodes;

function toMarkdown(node: Node): string {
  return node.sections
    .map(([title, body]) => {
      const text = Array.isArray(body) ? body.map((b) => `- ${b}`).join("\n") : body;
      return title ? `## ${title}\n\n${text}` : text;
    })
    .join("\n\n");
}
const fromNode = (id: string, tag: string): WindowSpec => {
  const node = nodes.find((n) => n.id === id)!;
  return { title: node.title, tag, variant: "standard", markdown: toMarkdown(node) };
};

const brief: WindowSpec = {
  title: "Adventure Land",
  tag: "Main Gig",
  variant: "brief",
  markdown: `## Hintergrund

Ludis Studio hat vor einer Woche die **gesamte** Analyseabteilung gefeuert. *Warum*, sagt niemand, und ~~niemand~~ fragt.

## Belohnung

> [!Reward] 6.000 ¥ / P
> Pro Person, plus **Spesen** nach Absprache.

### Ziele

- [x] Briefing annehmen (17.05.)
- [x] Betham Farming Gelände auskundschaften (18.05.) mit einem langen Text, damit die Durchstreichung über den Zeilenumbruch läuft
- [ ] Philips Collins aus dem Hinterhof NC-7 holen
- [ ] Herausfinden, ob die Spielerzahlen gefälscht sind
`,
};

const syntax: WindowSpec = {
  title: "Markdown-Test mit einem sehr langen Titel über zwei Zeilen",
  tag: "Test",
  variant: "standard",
  markdown: `# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

Normal, **fett**, *kursiv*, ***beides***, \`code\`, [Link](https://x), ~~durchgestrichen~~, ~einfach bleibt literal~.
Weiche Zeile.  
Harte Zeile.

1. Eins
2. Zwei
   - Verschachtelt
   - Noch eins

> Ein normales Zitat, eingerückt, mit Balken und **dunklerem** Text.

> [!Note] Titel der Notiz
> Normaler Text im Callout.

> [!Foo]
> Unbekannter Typ zeigt seinen Namen.

> [!reward] 12.500 ¥
> Kleinschreibung geht auch.

| Name | Wert |
|---|---|
| A | 1 |

---

\`\`\`
code block
\`\`\`
`,
};

const toD = (commands: Cmd[]) =>
  commands
    .map((c) => {
      const [t, ...a] = c;
      return `${{ 0: "M", 1: "L", 2: "Q", 4: "C", 5: "Z" }[t]}${a.join(" ")}`;
    })
    .join("");

const ORDER: Part["layer"][] = ["base", "fill", "text"];

function network(boxes: Box[], pairs: number[][]): string {
  const c = WINDOW.connector;
  const routes = routeLinks(pairs.map(([a, b]) => ({ a: boxes[a], b: boxes[b] })), boxes, {
    trunkOffset: c.trunkOffset,
    sideOffset: c.sideOffset,
    clearance: c.clearance,
    shadow: WINDOW.shadow.offset,
    bendCost: c.bendCost,
  });
  (window as unknown as { __routes: unknown[] }).__routes = [
    ...((window as unknown as { __routes?: unknown[] }).__routes ?? []),
    { boxes, routes, flow: flowSegments(routes) },
  ];
  const { line, ports } = drawRoutes(routes);
  let out = `<path d="${toD(line)}" fill="none" stroke="${COLOR.yellow}" stroke-opacity="${c.opacity}" stroke-width="${c.width}" stroke-dasharray="${c.dash.join(" ")}"/>`;
  for (const [x, y] of ports as Pt[]) {
    const pts = diamondPoints(x, y, c.portRadius).map((p) => p.join(",")).join(" ");
    out += `<polygon points="${pts}" fill="${COLOR.sceneBg}" stroke="${COLOR.yellow}" stroke-width="${c.width}"/>`;
  }
  // SVG stand-in for the SkSL shader: one dashed line per segment, same phase.
  const cycle = c.dash[0] + c.dash[1];
  flowOverlay = flowSegments(routes)
    .map((f) => `<line x1="${f.x0}" y1="${f.y0}" x2="${f.x1}" y2="${f.y1}" stroke="#5fcfdc" stroke-width="${c.width}" stroke-dasharray="${c.dash.join(" ")}" stroke-dashoffset="${f.phase % cycle}"/>`)
    .join("");
  return out;
}

let flowOverlay = "";

/** Org-chart test: a hub with several targets, a busy right-hand window, a stack. */
function multiCase(): string {
  const b = (x: number, y: number, w = 300, h = 130): Box => ({ x, y, w, h });
  const boxes = [
    b(500, 330), // 0 hub
    b(1000, 40), b(1000, 230), b(1000, 420), b(1000, 610), // 1-4 targets to the right
    b(60, 130), b(60, 530), // 5-6 targets to the left
    b(1500, 230), b(1500, 610), // 7-8 further right, feeding target 2
    b(500, 620), b(780, 830), // 9-10 stacked under the hub
  ];
  const pairs = [[0, 1], [0, 2], [0, 3], [0, 4], [5, 0], [6, 0], [2, 7], [2, 8], [3, 7], [0, 9], [0, 10]];
  const rects = boxes
    .map((box, i) => {
      const points = windowOutline(box.w, box.h, WINDOW.cut).map((p) => p.join(",")).join(" ");
      return `<g transform="translate(${box.x} ${box.y})"><polygon points="${points}" fill="${COLOR.panel}" stroke="${COLOR.yellow}" stroke-width="${WINDOW.border}"/><text x="24" y="60" fill="#fff" font-size="32">${i}</text></g>`;
    })
    .join("");
  return `<svg id="multi" xmlns="http://www.w3.org/2000/svg" width="1900" height="1020">${network(boxes, pairs)}${flowOverlay}${rects}</svg>`;
}

/** A window sits between connected windows, and on the default trunk position. */
function obstacleCase(): string {
  const b = (x: number, y: number, w = 300, h = 130): Box => ({ x, y, w, h });
  const boxes = [
    b(60, 240), // 0 source
    b(900, 240), // 1 target straight across, window 2 is in the way
    b(480, 170, 300, 300), // 2 obstacle between
    b(900, 520), // 3 second target of 0
    b(400, 620, 300, 130), // 4 obstacle across the way to 5
    b(60, 620), // 5
    b(900, 780), // 6 target of 5
  ];
  const pairs = [[0, 1], [0, 3], [5, 6]];
  const rects = boxes
    .map((box, i) => {
      const points = windowOutline(box.w, box.h, WINDOW.cut).map((p) => p.join(",")).join(" ");
      return `<g transform="translate(${box.x} ${box.y})"><polygon points="${points}" fill="${COLOR.panel}" stroke="${COLOR.yellow}" stroke-width="${WINDOW.border}"/><text x="24" y="60" fill="#fff" font-size="32">${i}</text></g>`;
    })
    .join("");
  return `<svg id="obstacle" xmlns="http://www.w3.org/2000/svg" width="1300" height="960">${network(boxes, pairs)}${rects}</svg>`;
}

async function main() {
  const fonts = await loadFonts();
  const longTitle = "Ein sehr langer Titel für ein schmales Fenster";
  const narrow: WindowSpec[] = [
    { title: longTitle, tag: "Main Gig", variant: "standard", markdown: "Schmal." },
    { title: longTitle, tag: "Main Gig", variant: "brief", markdown: "Schmal." },
  ];
  const specs = [brief, { ...brief, variant: "standard" as const }, fromNode("analyse", "Abteilung"), fromNode("ludis", "Org"), syntax, { title: "Org", tag: "X", variant: "standard" as const, markdown: "Kurz." }, ...narrow];
  let svg = "";
  let shadows = "";
  let x = 60;
  const boxes: Box[] = [];
  const stats: Record<string, unknown>[] = [];
  let maxH = 0;

  for (const spec of specs) {
    const width = narrow.includes(spec) ? WINDOW.minWidth : WINDOW.defaultWidth;
    const layout = layoutWindow(fonts, spec, width, uiScale);
    const y = 60;
    maxH = Math.max(maxH, layout.height);
    boxes.push({ x, y, w: width, h: layout.height });
    const path = (p: Part) =>
      `<path transform="translate(${x} ${y + p.offsetY})" d="${toD(p.commands)}" fill="${p.color}" fill-opacity="${p.opacity}"/>`;
    shadows += layout.parts.filter((p) => p.layer === "shadow").map(path).join("");
    const points = windowOutline(width, layout.height, WINDOW.cut).map((p) => p.join(",")).join(" ");
    svg += `<polygon transform="translate(${x} ${y})" points="${points}" fill="${COLOR.panel}" stroke="${COLOR.yellow}" stroke-width="${WINDOW.border}"/>`;
    for (const layer of ORDER) svg += layout.parts.filter((p) => p.layer === layer).map(path).join("");
    const bytes = layout.parts.map((p) => JSON.stringify(p.commands).length);
    stats.push({
      title: spec.title,
      chars: spec.markdown.length,
      parts: layout.parts.length,
      totalBytes: bytes.reduce((a, b) => a + b, 0),
      largestPart: Math.max(...bytes),
      height: Math.round(layout.height),
    });
    x += width + 60;
  }

  const links = network(boxes.slice(0, 4), [[0, 1], [1, 2], [2, 3]]);
  document.getElementById("stage")!.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${maxH + 140}">${shadows}${svg}${links}</svg>`;
  document.getElementById("stage")!.innerHTML += multiCase() + obstacleCase();
  document.getElementById("out")!.textContent = stats.map((s) => JSON.stringify(s)).join("\n");
  (window as unknown as { __stats: unknown }).__stats = stats;
}

void main();
