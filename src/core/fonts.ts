import opentype from "opentype.js";
import lightUrl from "@fontsource/rajdhani/files/rajdhani-latin-300-normal.woff?url";
import regularUrl from "@fontsource/rajdhani/files/rajdhani-latin-500-normal.woff?url";
import boldUrl from "@fontsource/rajdhani/files/rajdhani-latin-700-normal.woff?url";
import monoUrl from "@fontsource/share-tech-mono/files/share-tech-mono-latin-400-normal.woff?url";
import displayUrl from "@fontsource/orbitron/files/orbitron-latin-900-normal.woff?url";

export type FontKey = "light" | "regular" | "bold" | "mono" | "display";
export type Fonts = Record<FontKey, opentype.Font>;

const URLS: Record<FontKey, string> = {
  light: lightUrl,
  regular: regularUrl,
  bold: boldUrl,
  mono: monoUrl,
  display: displayUrl,
};

let loading: Promise<Fonts> | null = null;

export function loadFonts(): Promise<Fonts> {
  loading ??= (async () => {
    const keys = Object.keys(URLS) as FontKey[];
    const parsed = await Promise.all(
      keys.map(async (key) => {
        const res = await fetch(URLS[key]);
        if (!res.ok) throw new Error(`Font ${key}: HTTP ${res.status}`);
        return opentype.parse(await res.arrayBuffer());
      }),
    );
    return Object.fromEntries(keys.map((k, i) => [k, parsed[i]])) as Fonts;
  })();
  return loading;
}
