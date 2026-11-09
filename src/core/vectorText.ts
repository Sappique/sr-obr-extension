import opentype from "opentype.js";
import { FontKey, Fonts } from "./fonts";
import { Cmd, MOVE, LINE, QUAD, CUBIC, CLOSE } from "./geometry";

export interface TextOptions {
  /** Letter spacing in em. */
  spacing?: number;
  italic?: boolean;
}

const ITALIC_SHEAR = 0.2;
const FALLBACKS: FontKey[] = ["bold", "regular", "mono", "display"];

function hasGlyph(font: opentype.Font, ch: string): boolean {
  return font.charToGlyph(ch).index !== 0;
}

/** Splits text into runs per font, falling back glyph by glyph. */
function segments(fonts: Fonts, key: FontKey, text: string) {
  const out: { font: opentype.Font; text: string }[] = [];
  for (const raw of Array.from(text)) {
    let font: opentype.Font | undefined = hasGlyph(fonts[key], raw) ? fonts[key] : undefined;
    let ch = raw;
    if (!font) {
      const other = FALLBACKS.find((k) => hasGlyph(fonts[k], raw));
      if (other) font = fonts[other];
      else {
        font = fonts[key];
        ch = "?";
      }
    }
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += ch;
    else out.push({ font, text: ch });
  }
  return out;
}

export function measureText(
  fonts: Fonts,
  key: FontKey,
  text: string,
  size: number,
  options: TextOptions = {},
): number {
  const letterSpacing = options.spacing ?? 0;
  return segments(fonts, key, text).reduce(
    (sum, s) => sum + s.font.getAdvanceWidth(s.text, size, { letterSpacing }),
    0,
  );
}

/** Appends the outlines of text with its baseline at (x, y). Returns the advance. */
export function drawText(
  out: Cmd[],
  fonts: Fonts,
  key: FontKey,
  text: string,
  x: number,
  y: number,
  size: number,
  options: TextOptions = {},
): number {
  const letterSpacing = options.spacing ?? 0;
  let cursor = x;
  const skew = (px: number, py: number) =>
    options.italic ? px + (y - py) * ITALIC_SHEAR : px;
  for (const seg of segments(fonts, key, text)) {
    const path = seg.font.getPath(seg.text, cursor, y, size, { letterSpacing });
    for (const c of path.commands) {
      if (c.type === "M") out.push([MOVE, skew(c.x, c.y), c.y]);
      else if (c.type === "L") out.push([LINE, skew(c.x, c.y), c.y]);
      else if (c.type === "Q")
        out.push([QUAD, skew(c.x1, c.y1), c.y1, skew(c.x, c.y), c.y]);
      else if (c.type === "C")
        out.push([CUBIC, skew(c.x1, c.y1), c.y1, skew(c.x2, c.y2), c.y2, skew(c.x, c.y), c.y]);
      else out.push([CLOSE]);
    }
    cursor += seg.font.getAdvanceWidth(seg.text, size, { letterSpacing });
  }
  return cursor - x;
}

/** Baseline offset from the top of a CSS-style line box. */
export function baselineOffset(fonts: Fonts, key: FontKey, size: number, lineHeight: number) {
  const f = fonts[key];
  const ascent = (f.ascender / f.unitsPerEm) * size;
  const descent = (-f.descender / f.unitsPerEm) * size;
  return (lineHeight - (ascent + descent)) / 2 + ascent;
}
