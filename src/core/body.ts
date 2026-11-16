import type { Base, Canvas, PartLayer, Renderer } from "../windows/layout";
import { FontKey, Fonts } from "./fonts";
import { Cmd } from "./geometry";
import { parseMarkdown, Run } from "./markdown";
import { SCALE, WindowTokens } from "./style";
import { baselineOffset, drawText, measureText } from "./vectorText";

/**
 * Drawing kit for window bodies other than plain Markdown (the calendar). Everything is vector outlines, collected into parts by
 * colour; call flush(top) at row or section boundaries so edits only resend
 * the rows that changed.
 */
export interface TextStyle {
  font: FontKey;
  size: number;
  color: string;
  spacing?: number;
  upper?: boolean;
  align?: "left" | "right" | "center";
  /** Cut with an ellipsis to fit. */
  maxWidth?: number;
  italic?: boolean;
  opacity?: number;
}

export interface BodyContext {
  fonts: Fonts;
  t: WindowTokens;
  /** Design px to scene units at the current window scale. */
  u: (n: number) => number;
  add(layer: PartLayer, color: string, opacity: number, commands: Cmd[]): void;
  /** One item per colour for the whole window (thin repeated details). */
  addWindowLevel(layer: PartLayer, color: string, opacity: number, commands: Cmd[]): void;
  flush(top: number): void;
  pending(): number;
  measure(text: string, font: FontKey, size: number, spacing?: number): number;
  /** One line with its top at y and the given line height. Returns the drawn width. */
  line(text: string, x: number, y: number, lineHeight: number, style: TextStyle): number;
  /** Wrapped body text (inline Markdown marks allowed). Returns the bottom y. */
  paragraph(text: string, x: number, y: number, width: number, style: Partial<ParagraphStyle>): number;
  /** Full Markdown blocks in the window body style. Returns the bottom y. */
  markdown(text: string, x: number, y: number, width: number): number;
  /** Section heading like a Markdown heading (H1-H3 get the line). Returns the bottom y. */
  heading(text: string, depth: number, x: number, y: number, width: number): number;
}

export interface ParagraphStyle {
  font: FontKey;
  boldFont: FontKey;
  size: number;
  lineHeight: number;
  color: string;
  boldColor: string;
}

function fit(fonts: Fonts, text: string, style: TextStyle): string {
  const shown = style.upper ? text.toUpperCase() : text;
  if (style.maxWidth === undefined) return shown;
  const w = (s: string) => measureText(fonts, style.font, s, style.size, { spacing: style.spacing });
  if (w(shown) <= style.maxWidth) return shown;
  let lo = 0;
  let hi = shown.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (w(shown.slice(0, mid).trimEnd() + "…") <= style.maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? shown.slice(0, lo).trimEnd() + "…" : "";
}

export function bodyContext(
  fonts: Fonts,
  canvas: Canvas,
  renderer: Renderer,
  t: WindowTokens,
  scale: number,
  base: Base,
): BodyContext {
  const u = (n: number) => n * SCALE * scale;
  const toBase = (style: Partial<ParagraphStyle>): Base => ({
    ...base,
    ...style,
    lineHeight: style.lineHeight ?? (style.size ? style.size * 1.3 : base.lineHeight),
  });
  return {
    fonts,
    t,
    u,
    add: (layer, color, opacity, commands) => canvas.add(layer, color, opacity, commands),
    addWindowLevel: (layer, color, opacity, commands) => canvas.addWindowLevel(layer, color, opacity, commands),
    flush: (top) => canvas.flush(top),
    pending: () => canvas.pending,
    measure: (text, font, size, spacing) => measureText(fonts, font, text, size, { spacing }),
    line(text, x, y, lineHeight, style) {
      const shown = fit(fonts, text, style);
      if (!shown) return 0;
      const width = measureText(fonts, style.font, shown, style.size, { spacing: style.spacing });
      const left = style.align === "right" ? x - width : style.align === "center" ? x - width / 2 : x;
      const commands: Cmd[] = [];
      drawText(
        commands, fonts, style.font, shown, left,
        y + baselineOffset(fonts, style.font, style.size, lineHeight), style.size,
        { spacing: style.spacing, italic: style.italic },
      );
      canvas.add("text", style.color, style.opacity ?? 1, commands);
      return width;
    },
    paragraph(text, x, y, width, style) {
      const runs: Run[] = [];
      for (const block of parseMarkdown(text)) {
        if (block.type === "paragraph") {
          if (runs.length) runs.push({ text: "\n" });
          runs.push(...block.runs);
        }
      }
      if (!runs.length) return y;
      return renderer.text(runs, toBase(style), x, y, width);
    },
    markdown: (text, x, y, width) => renderer.blocks(parseMarkdown(text), x, y, width, base),
    heading: (text, depth, x, y, width) => renderer.heading([{ text }], depth, x, y, width),
  };
}
