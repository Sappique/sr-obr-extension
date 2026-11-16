import { calloutStyle } from "../core/callouts";
import { BodyContext, bodyContext } from "../core/body";
import { calendarBody } from "../calendar/body";
import { FontKey, Fonts } from "../core/fonts";
import {
  Cmd,
  diamond,
  diamondRing,
  hatch,
  clipHalfPlane,
  polygon,
  rect,
  rectRing,
  windowOutline,
} from "../core/geometry";
import { Block, ListItem, parseMarkdown, Run } from "../core/markdown";
import { COLOR, UI_SCALE, WindowTokens, windowTokens } from "../core/style";
import { baselineOffset, drawText, measureText } from "../core/vectorText";

/**
 * Turns a window's content into filled vector parts. Pure (no OBR calls), so
 * the preview page renders exactly what goes into the scene. Each block
 * becomes its own parts with coordinates relative to the block, so edits and
 * reflows reuse unchanged outlines and only move them.
 */
/** What the body shows. "markdown" is the plain text window; the others parse
 * the same text field with their own line format (see src/<kind>/format.ts). */
export type WindowKind = "markdown" | "calendar" | "feed" | "influence";

export interface WindowSpec {
  title: string;
  tag: string;
  variant: "standard" | "brief";
  markdown: string;
  kind?: WindowKind;
  /** Calendar only: the current date, dd.mm.yyyy. */
  today?: string;
  /** Calendar only, not stored: crew names and colours, filled in by the GM's sync. */
  crewColors?: Record<string, string>;
}

/** "base" is the header band: it must stay below every other fill. */
export type PartLayer = "shadow" | "base" | "fill" | "text";

export interface Part {
  layer: PartLayer;
  color: string;
  opacity: number;
  offsetY: number;
  commands: Cmd[];
  hash: string;
}

export interface WindowLayout {
  height: number;
  parts: Part[];
}

/** About 90 kB of JSON; longer text splits into several Path items. */
const MAX_COMMANDS_PER_PART = 3000;

type BodyRenderer = (ctx: BodyContext, spec: WindowSpec, x: number, y: number, width: number) => number;
const BODIES: Record<Exclude<WindowKind, "markdown">, BodyRenderer> = {
  calendar: calendarBody,
  feed: (ctx, spec, x, y, width) => ctx.markdown(spec.markdown, x, y, width),
  influence: (ctx, spec, x, y, width) => ctx.markdown(spec.markdown, x, y, width),
};

export function hashString(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x1b873593;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x00cc9e2d) + 7;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

export const STYLE_VERSION = hashString(JSON.stringify([windowTokens(UI_SCALE.default), COLOR, 3]));

const round = (n: number) => Math.round(n * 10) / 10;

export class Canvas {
  parts: Part[] = [];
  private groups = new Map<string, Cmd[]>();
  private windowGroups = new Map<string, Cmd[]>();
  pending = 0;

  private static put(map: Map<string, Cmd[]>, key: string, commands: Cmd[]) {
    const list = map.get(key);
    if (list) list.push(...commands);
    else map.set(key, [...commands]);
  }

  add(layer: PartLayer, color: string, opacity: number, commands: Cmd[]) {
    Canvas.put(this.groups, `${layer}|${color}|${opacity}`, commands);
    this.pending += commands.length;
  }

  /** For repeated low-opacity details: one item per opacity for the whole window. */
  addWindowLevel(layer: PartLayer, color: string, opacity: number, commands: Cmd[]) {
    Canvas.put(this.windowGroups, `${layer}|${color}|${opacity}`, commands);
  }

  private emit(map: Map<string, Cmd[]>, top: number) {
    for (const [key, commands] of map) {
      const [layer, color, opacity] = key.split("|");
      const relative = commands.map((c) => {
        const out = [c[0]];
        for (let i = 1; i < c.length; i += 2) out.push(round(c[i]), round(c[i + 1] - top));
        return out;
      });
      this.parts.push({
        layer: layer as PartLayer,
        color,
        opacity: Number(opacity),
        offsetY: top,
        commands: relative,
        hash: hashString(key + JSON.stringify(relative)),
      });
    }
    map.clear();
  }

  flush(top: number) {
    this.emit(this.groups, top);
    this.pending = 0;
  }

  flushWindowLevel() {
    this.emit(this.windowGroups, 0);
  }
}

export interface Base {
  font: FontKey;
  boldFont: FontKey;
  size: number;
  lineHeight: number;
  color: string;
  boldColor: string;
  spacing?: number;
  upper?: boolean;
  /** Ignore inline marks (headings use a single style). */
  plain?: boolean;
  strike?: boolean;
}

interface Piece {
  text: string;
  font: FontKey;
  size: number;
  color: string;
  width: number;
  x: number;
  italic: boolean;
  strike: boolean;
  underline: boolean;
}

interface Word {
  pieces: Piece[];
  spaceWidth: number;
}

export type Line = { pieces: Piece[]; width: number };

export class Renderer {
  constructor(
    private fonts: Fonts,
    private canvas: Canvas,
    private t: WindowTokens,
  ) {}

  private piece(text: string, run: Run, base: Base): Piece {
    const shown = base.upper ? text.toUpperCase() : text;
    const code = !!run.code && !base.plain;
    const bold = !!run.bold && !base.plain;
    const link = !!run.link && !base.plain;
    const font: FontKey = code ? "mono" : bold ? base.boldFont : base.font;
    const size = code ? base.size * 0.9 : base.size;
    const width = measureText(this.fonts, font, shown, size, { spacing: base.spacing });
    return {
      text: shown,
      font,
      size,
      color: code || link ? COLOR.cyan : bold ? base.boldColor : base.color,
      width,
      x: 0,
      italic: !!run.italic && !base.plain,
      strike: !!base.strike || (!!run.strike && !base.plain),
      underline: link,
    };
  }

  private words(runs: Run[], base: Base): (Word | null)[] {
    const out: (Word | null)[] = [];
    let current: Piece[] = [];
    let space = 0;
    const commit = () => {
      if (current.length) out.push({ pieces: current, spaceWidth: space });
      if (current.length) space = 0;
      current = [];
    };
    for (const run of runs) {
      if (run.text === "\n") {
        commit();
        out.push(null);
        space = 0;
        continue;
      }
      for (const [token] of run.text.matchAll(/\s+|\S+/g)) {
        if (/^\s/.test(token)) {
          commit();
          space = this.piece(" ", run, base).width;
          continue;
        }
        token.split(/(?<=-)/).forEach((part, i) => {
          if (i > 0) commit();
          current.push(this.piece(part, run, base));
        });
      }
    }
    commit();
    return out;
  }

  /** Splits a word wider than the line into chunks that fit. */
  private breakLongWord(word: Word, width: number, runBase: Base): Word[] {
    const out: Word[] = [];
    let chunk: Piece[] = [];
    let used = 0;
    for (const piece of word.pieces) {
      let text = "";
      for (const ch of Array.from(piece.text)) {
        const w = measureText(this.fonts, piece.font, text + ch, piece.size, { spacing: runBase.spacing });
        if (used + w > width && (text || chunk.length)) {
          if (text) chunk.push(this.sized(piece, text, runBase));
          out.push({ pieces: chunk, spaceWidth: out.length ? 0 : word.spaceWidth });
          chunk = [];
          used = 0;
          text = ch;
        } else text += ch;
      }
      if (text) {
        const rest = this.sized(piece, text, runBase);
        chunk.push(rest);
        used += rest.width;
      }
    }
    if (chunk.length) out.push({ pieces: chunk, spaceWidth: out.length ? 0 : word.spaceWidth });
    return out;
  }

  private sized(piece: Piece, text: string, base: Base): Piece {
    return {
      ...piece,
      text,
      width: measureText(this.fonts, piece.font, text, piece.size, { spacing: base.spacing }),
    };
  }

  flow(runs: Run[], base: Base, width: number): Line[] {
    const lines: Line[] = [];
    let line: Line = { pieces: [], width: 0 };
    for (const entry of this.words(runs, base)) {
      if (entry === null) {
        lines.push(line);
        line = { pieces: [], width: 0 };
        continue;
      }
      const wordWidth = (w: Word) => w.pieces.reduce((s, p) => s + p.width, 0);
      const chunks = wordWidth(entry) > width ? this.breakLongWord(entry, width, base) : [entry];
      for (const word of chunks) {
        const w = wordWidth(word);
        let gap = line.pieces.length ? word.spaceWidth : 0;
        if (line.pieces.length && line.width + gap + w > width) {
          lines.push(line);
          line = { pieces: [], width: 0 };
          gap = 0;
        }
        let x = line.width + gap;
        for (const piece of word.pieces) {
          piece.x = x;
          x += piece.width;
          line.pieces.push(piece);
        }
        line.width = x;
      }
    }
    if (line.pieces.length || lines.length === 0) lines.push(line);
    return lines;
  }

  /** Draws lines with their top at y. Flushes parts; returns nothing. */
  draw(lines: Line[], base: Base, x: number, y: number) {
    let top = y;
    const baseline = baselineOffset(this.fonts, base.font, base.size, base.lineHeight);
    lines.forEach((line, i) => {
      const by = y + i * base.lineHeight + baseline;
      let previous: Piece | undefined;
      for (const p of line.pieces) {
        const commands: Cmd[] = [];
        drawText(commands, this.fonts, p.font, p.text, x + p.x, by, p.size, {
          spacing: base.spacing,
          italic: p.italic,
        });
        this.canvas.add("text", p.color, 1, commands);
        const start = previous && previous.strike && p.strike ? previous.x + previous.width : p.x;
        if (p.strike) {
          this.canvas.add(
            "text", p.color, 1,
            rect(x + start, by - p.size * 0.3, p.x + p.width - start, p.size * 0.07),
          );
        }
        if (p.underline) {
          this.canvas.add("text", p.color, 1, rect(x + p.x, by + p.size * 0.12, p.width, p.size * 0.06));
        }
        previous = p;
      }
      if (this.canvas.pending > MAX_COMMANDS_PER_PART && i < lines.length - 1) {
        this.canvas.flush(top);
        top = y + (i + 1) * base.lineHeight;
      }
    });
    this.canvas.flush(top);
  }

  text(runs: Run[], base: Base, x: number, y: number, width: number): number {
    const lines = this.flow(runs, base, width);
    this.draw(lines, base, x, y);
    return y + lines.length * base.lineHeight;
  }

  private margins(block: Block): [number, number] {
    switch (block.type) {
      case "heading":
        return [this.t.heading.top, this.t.heading.bottom];
      case "paragraph":
        return [0, this.t.body.paragraphBottom];
      case "list":
        return [this.t.body.itemGap, this.t.body.paragraphBottom];
      case "code":
        return [this.t.code.top, this.t.code.bottom];
      case "quote":
        return [this.t.quote.top, this.t.quote.bottom];
      case "callout":
        return [this.t.callout.top, this.t.callout.bottom];
      case "rule":
        return [this.t.rule.top, this.t.rule.bottom];
    }
  }

  blocks(blocks: Block[], x: number, y: number, width: number, base: Base): number {
    let previousBottom = 0;
    blocks.forEach((block, i) => {
      const [top, bottom] = this.margins(block);
      if (i > 0) y += Math.max(previousBottom, top);
      y = this.block(block, x, y, width, base);
      previousBottom = bottom;
    });
    return y;
  }

  private block(block: Block, x: number, y: number, width: number, base: Base): number {
    switch (block.type) {
      case "paragraph":
        return this.text(block.runs, base, x, y, width);
      case "heading":
        return this.heading(block.runs, block.depth, x, y, width);
      case "list":
        return this.list(block.items, block.ordered, block.start, x, y, width, base);
      case "quote":
        return this.quote(block.blocks, x, y, width, base);
      case "callout":
        return this.callout(block, x, y, width, base);
      case "code": {
        const mono: Base = {
          ...base, font: "mono", boldFont: "mono", size: this.t.code.size,
          lineHeight: this.t.code.size * 1.3, color: COLOR.cyan, boldColor: COLOR.cyan,
        };
        for (const line of block.lines) y = this.text([{ text: line || " " }], mono, x, y, width);
        return y;
      }
      case "rule":
        this.canvas.add("fill", COLOR.cyan, this.t.rule.opacity, rect(x, y, width, this.t.rule.height));
        this.canvas.flush(y);
        return y + this.t.rule.height;
    }
  }

  heading(runs: Run[], depth: number, x: number, y: number, width: number): number {
    const h = this.t.heading;
    const size = h.sizes[depth - 1];
    const base: Base = {
      font: "mono", boldFont: "mono", size, lineHeight: size * h.lineHeight,
      color: COLOR.yellow, boldColor: COLOR.yellow, spacing: h.spacing, upper: true, plain: true,
    };
    const lines = this.flow(runs, base, width);
    this.draw(lines, base, x, y);
    if (depth <= h.linedDepth) {
      const last = lines[lines.length - 1];
      const start = x + last.width + h.lineGap;
      const available = x + width - start;
      const cy = y + (lines.length - 0.5) * base.lineHeight;
      if (available > 0) {
        this.canvas.addWindowLevel(
          "fill", COLOR.yellow, h.lineOpacity,
          rect(start, cy - h.lineThickness / 2, available, h.lineThickness),
        );
      }
    }
    return y + lines.length * base.lineHeight;
  }

  private list(
    items: ListItem[], ordered: boolean, start: number,
    x: number, y: number, width: number, base: Base,
  ): number {
    const b = this.t.body;
    const numberWidth = ordered
      ? measureText(this.fonts, base.boldFont, `${start + items.length - 1}.`, base.size) + base.size * 0.4
      : 0;
    items.forEach((item, i) => {
      if (i > 0) y += b.itemGap;
      const indent = item.task ? b.taskIndent : ordered ? numberWidth : b.bulletIndent;
      const cy = y + base.lineHeight / 2;
      if (item.task) {
        const cx = b.taskRadius;
        this.canvas.add(
          "text", COLOR.yellow, 1,
          item.checked
            ? diamond(x + cx, cy, b.taskRadius * 0.8)
            : diamondRing(x + cx, cy, b.taskRadius * 0.8, b.taskBorder),
        );
      } else if (ordered) {
        const commands: Cmd[] = [];
        drawText(
          commands, this.fonts, base.boldFont, `${start + i}.`, x,
          y + baselineOffset(this.fonts, base.font, base.size, base.lineHeight), base.size,
        );
        this.canvas.add("text", COLOR.yellow, 1, commands);
      } else {
        this.canvas.add("text", COLOR.yellow, 1, diamond(x + b.bulletRadius, cy, b.bulletRadius));
      }
      const itemBase: Base = item.checked
        ? { ...base, color: COLOR.dim, boldColor: COLOR.dim, strike: true }
        : base;
      const top = y;
      y = this.blocks(item.blocks, x + indent, y, width - indent, itemBase);
      if (item.blocks.length === 0) {
        y += base.lineHeight;
        this.canvas.flush(top);
      }
    });
    return y;
  }

  private quote(blocks: Block[], x: number, y: number, width: number, base: Base): number {
    const q = this.t.quote;
    const inner: Base = { ...base, color: q.color, boldColor: q.boldColor };
    const end = this.blocks(blocks, x + q.indent, y, width - q.indent, inner);
    this.canvas.add("fill", q.color, 1, rect(x, y, q.bar, Math.max(end - y, base.lineHeight)));
    this.canvas.flush(y);
    return end;
  }

  private callout(
    block: Extract<Block, { type: "callout" }>,
    x: number, y: number, width: number, base: Base,
  ): number {
    const c = this.t.callout;
    const style = calloutStyle(block.kind);
    const innerX = x + c.padX + c.border;
    const innerWidth = width - 2 * (c.padX + c.border);
    let cursor = y + c.padY + c.border;
    const hasTitle = block.title.some((r) => r.text.trim());

    if (style.title === "display" && hasTitle) {
      const title: Base = {
        font: "display", boldFont: "display", size: c.titleSize,
        lineHeight: c.titleSize * c.titleLineHeight,
        color: style.color, boldColor: style.color, spacing: 0.04,
      };
      cursor = this.text(block.title, title, innerX, cursor, innerWidth);
    } else {
      const label: Base = {
        font: "mono", boldFont: "mono", size: c.labelSize, lineHeight: c.labelSize * 1.4,
        color: style.color, boldColor: style.color, spacing: c.labelSpacing, upper: true, plain: true,
      };
      cursor = this.text([{ text: block.kind }], label, innerX, cursor, innerWidth);
      if (hasTitle) {
        const title: Base = { ...base, font: "bold", color: COLOR.white, boldColor: COLOR.white };
        cursor = this.text(block.title, title, innerX, cursor, innerWidth);
      }
    }
    if (block.blocks.length) {
      cursor += c.titleBottom;
      const body: Base = { ...base, color: COLOR.white };
      cursor = this.blocks(block.blocks, innerX, cursor, innerWidth, body);
    }
    const end = cursor + c.padY + c.border;
    const h = end - y;
    this.canvas.add("fill", style.color, c.tint, rect(x, y, width, h));
    this.canvas.add("text", style.color, 1, rectRing(x, y, width, h, c.border));
    this.canvas.flush(y);
    return end;
  }
}

function header(
  renderer: Renderer, canvas: Canvas, fonts: Fonts, spec: WindowSpec, width: number, t: WindowTokens,
): number {
  const h = t.header;
  const brief = spec.variant === "brief";
  const size = h.title.size;
  const tagText = spec.tag.trim().toUpperCase();
  const tagWidth = tagText
    ? measureText(fonts, "mono", tagText, h.tag.size, { spacing: h.tag.spacing }) + 2 * h.tag.padX
    : 0;
  const tagHeight = h.tag.size + 2 * h.tag.padY;
  const tagSpace = tagText ? tagWidth + h.gap : 0;

  const titleBase: Base = {
    font: "bold", boldFont: "bold", size, lineHeight: size * h.title.lineHeight,
    color: brief ? COLOR.black : COLOR.white, boldColor: COLOR.white,
    spacing: h.title.spacing, upper: true, plain: true,
  };
  const titleX = h.padLeft + tagSpace;
  const lines = renderer.flow(
    [{ text: spec.title }], titleBase, Math.max(size * 3, width - titleX - h.padRight),
  );
  const titleHeight = lines.length * titleBase.lineHeight;
  const content = Math.max(titleHeight, tagHeight);
  const height = h.padTop + content + h.padBottom;

  // Band, clipped to the window's cut corner.
  const band = clipHalfPlane(windowOutline(width, height + t.cut * 2, t.cut), ([, y]) => y - height);
  canvas.add("base", COLOR.yellow, brief ? 1 : h.tint, polygon(band));
  if (!brief) {
    // Hairline inside the frame: stops at the border and at the cut corner.
    const y = height - h.lineHeight;
    const inset = t.border / 2;
    const right = y >= t.cut ? width - inset : width - (t.cut - y) - inset * Math.SQRT2;
    canvas.add("fill", COLOR.yellow, h.lineOpacity, rect(inset, y, right - inset, h.lineHeight));
    // Accent bar: tag plus title, keeping the same gap on the right as on the left.
    const titleWidth = Math.max(...lines.map((line) => line.width));
    const bar = Math.min(titleX - h.padLeft + titleWidth, width - 2 * h.padLeft);
    canvas.add("text", COLOR.yellow, 1, rect(h.padLeft, height - h.underlineHeight, bar, h.underlineHeight));
  }

  if (tagText) {
    const tagY = h.padTop + Math.min(titleBase.lineHeight, content) / 2 - tagHeight / 2;
    canvas.add("fill", brief ? COLOR.black : COLOR.yellow, 1, rect(h.padLeft, tagY, tagWidth, tagHeight));
    const commands: Cmd[] = [];
    drawText(
      commands, fonts, "mono", tagText, h.padLeft + h.tag.padX,
      tagY + baselineOffset(fonts, "mono", h.tag.size, tagHeight), h.tag.size,
      { spacing: h.tag.spacing },
    );
    canvas.add("text", brief ? COLOR.yellow : COLOR.black, 1, commands);
  }
  renderer.draw(lines, titleBase, titleX, h.padTop + (content - titleHeight) / 2);
  canvas.flush(0);
  return height;
}

export function layoutWindow(
  fonts: Fonts, spec: WindowSpec, width: number, scale: number = UI_SCALE.default,
): WindowLayout {
  const t = windowTokens(scale);
  const canvas = new Canvas();
  const renderer = new Renderer(fonts, canvas, t);
  const b = t.body;
  const headerHeight = header(renderer, canvas, fonts, spec, width, t);

  const base: Base = {
    font: "regular", boldFont: "bold", size: b.size, lineHeight: b.size * b.lineHeight,
    color: COLOR.body, boldColor: COLOR.white,
  };
  const kind = spec.kind ?? "markdown";
  const bodyX = b.padX;
  const bodyY = headerHeight + b.padTop;
  const bodyWidth = width - 2 * b.padX;
  const end = kind === "markdown"
    ? renderer.blocks(parseMarkdown(spec.markdown), bodyX, bodyY, bodyWidth, base)
    : BODIES[kind](bodyContext(fonts, canvas, renderer, t, scale, base), spec, bodyX, bodyY, bodyWidth);
  const height = Math.max(end + b.padBottom, t.cut * 2 + headerHeight);
  canvas.flushWindowLevel();

  const s = t.shadow;
  const plate = windowOutline(width, height, t.cut).map(
    ([x, y]) => [x - s.offset, y + s.offset] as [number, number],
  );
  canvas.add("shadow", COLOR.yellow, s.opacity, hatch(plate, s.stripe, s.period));
  canvas.flush(0);
  return { height, parts: canvas.parts };
}
