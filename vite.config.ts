import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";

/**
 * Where the built extension is served from, e.g. "/sr-obr-extension/" on GitHub
 * Pages (set by the deploy workflow). Owlbear puts the manifest's host in front
 * of the manifest's "/..." paths, so the build prefixes them with this folder.
 */
const PAGES_BASE = process.env.PAGES_BASE ?? "/";

const manifestPaths = {
  name: "manifest-paths",
  apply: "build" as const,
  closeBundle() {
    const file = resolve(import.meta.dirname, "dist/manifest.json");
    const text = readFileSync(file, "utf8").replace(/"\/([^"]*\.(?:html|svg|png))"/g, `"${PAGES_BASE}$1"`);
    writeFileSync(file, text);
  },
};

export default defineConfig({
  // Relative asset URLs, so the build works from a subfolder (GitHub Pages).
  base: "./",
  plugins: [manifestPaths],
  server: {
    port: 5175,
    strictPort: true,
    // Owlbear Rodeo fetches the manifest cross-origin.
    cors: true,
    // preview.html reads the mock content from ../designs.
    fs: { allow: [".."] },
  },
  build: {
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, "background.html"),
        editor: resolve(import.meta.dirname, "editor.html"),
        "map-editor": resolve(import.meta.dirname, "map-editor.html"),
        "map-import": resolve(import.meta.dirname, "map-import.html"),
        settings: resolve(import.meta.dirname, "settings.html"),
        sidebar: resolve(import.meta.dirname, "sidebar.html"),
        dice: resolve(import.meta.dirname, "dice.html"),
      },
    },
  },
});
