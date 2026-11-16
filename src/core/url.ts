/**
 * An extension file as an absolute URL. The OBR SDK only puts the origin in
 * front of a path ("/editor.html" -> "https://host/editor.html"), which breaks
 * when the extension is served from a subfolder (GitHub Pages:
 * https://sappique.github.io/sr-obr-extension/). Resolving against the page's
 * own URL works in both places, as every extension page sits at the root of
 * the build.
 */
export const extUrl = (path: string) => new URL(path.replace(/^\//, ""), document.baseURI).href;
