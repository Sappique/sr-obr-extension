# Shadowrun VTT

Owlbear Rodeo extension for the Shadowrun London campaign. One extension, one folder per
feature: `src/core` is shared, `src/windows` holds the floating windows.

## Windows

All text is drawn as vector outlines (Path items), because OBR can't load custom fonts.
A window is a frame (a Curve) plus derived parts attached to it. The source lives in the
frame's metadata (`sappique.sr-obr/window`); only the GM client generates parts.

- **Create:** window tool in the toolbar (GM), click to place.
- **Edit:** right-click a window; the fields are in the context menu.
- **Size of everything:** the extension icon at the top opens the window scale (GM only; scene metadata, applied on slider release).
- **Width:** drag a resize handle. Height follows the content.
- **Connect:** select two windows, context menu "Connect". Again on the same pair removes it.
- **Hide from players:** use OBR's own visibility toggle on the window.
- **Keep players from moving windows:** frames are on the Prop layer, so turn off Prop update and
  delete for players in the room permissions.

### Markdown

CommonMark/GFM: `#`-`######`, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, links, lists,
`- [x]` tasks, `> quote`, `---`, code blocks. Tables degrade to `a · b` lines, images to their alt text.

Callouts (add types in `src/core/callouts.ts`):

```
> [!Reward] 6.000 ¥ / P
> Normal Markdown body.
```

## Develop

```sh
npm install
npm run dev     # http://localhost:5175
```

Add `http://localhost:5175/manifest.json` as an extension in a separate test room.
`http://localhost:5175/preview.html` renders the generated outlines without OBR.
`npm run build` type-checks and bundles into `dist/`.
