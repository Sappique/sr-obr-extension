import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
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
        settings: resolve(import.meta.dirname, "settings.html"),
        sidebar: resolve(import.meta.dirname, "sidebar.html"),
        dice: resolve(import.meta.dirname, "dice.html"),
      },
    },
  },
});
