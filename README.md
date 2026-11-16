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
- **Add linked window:** right-click one window, "Add linked window" creates a new one to its right, already connected and with the same visibility.
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

## Crew sheets (`src/sheets`)

A screen-fixed popover on the left edge (design 16): initials squares with two status lines,
clicking one opens that runner's sheet beside the strip (click again to close).

- **Data:** one text item per sheet whose text is the sheet as JSON ("Sheet: Hawk", hidden from
  players, left of the map), so the data can be read and edited with OBR's text tool. Schema,
  validation and formatting in `schema.ts` (v2: dice as integers 4–12, `specializations`,
  attribute names in normal case, shown in capitals). Invalid text: the sheet keeps its last
  valid version, the GM sees the error and edits from the sheet wait until it is fixed. Sheets of
  earlier versions (JSON in item metadata) are converted by the GM client. Edits go through
  `updateItems`, so they sync and undo.
- **Create:** in a scene without sheets the GM gets "Create crew" (seeded from `seed-data.json`).
- **GM edits:** condition text and OK/WRN/CRT/DWN per track, nuyen (±100/±500 or click to type),
  Markdown sections (edit/add/delete), and the structure (name block, skills, colour) as raw JSON.
  Players are read-only.
- **Monitors** animate locally on every client, seeded per runner and track.
- **Standalone preview** with mock data: `http://localhost:5175/sidebar.html`.

## Dice (`src/dice`)

Click an attribute, skill or specialisation row on a sheet to roll attribute (+ skill
(+ specialisation)). Result = highest die + 1 for every other die on its max face; among tied
highest dice the base is one not on its max face (`roll.ts`, tests in `roll.test.ts`).
Anyone can roll any sheet; the roller draws the values and broadcasts them, so every client
plays the same popup at the bottom right: newest on top, collapses to one line 8 s after
arrival, the line slides out 10 s later.
Every visible roll has its own popover window (`dice.html?slot=N`), managed from the
background page (`manager.ts`; messages in `bus.ts`, popup rendering in `view.ts`). OBR applies
a popover's new size a frame before its new position, so a window is only resized while it is
invisible and otherwise only moved; see the comment at the top of `manager.ts`.
Preview (one page, no OBR): `http://localhost:5175/dice.html?demo`.

## Develop

```sh
npm install
npm run dev     # http://localhost:5175
```

Add `http://localhost:5175/manifest.json` as an extension in a separate test room.
`http://localhost:5175/preview.html` renders the generated outlines without OBR.
`npm run build` type-checks and bundles into `dist/`.

## Map markers (`src/map`)

Location markers and runner pins, drawn as vector shapes. The GM client redraws them when
something changes. "Map markers" tool in the toolbar (GM):

- **Place location:** an icon by kind (Location, Person, Group, Corporation, Restaurant / club,
  Danger, Home, Airport, Harbor, Magical, Other; chosen in `designs/18-location-icons.html`) with a
  name label. The label is its own item attached to the icon: drag it anywhere; it follows the icon.
  Right-click the icon or the label, "Edit map marker": name (Enter = new line), kind, line
  alignment (Left / Centre / Right), colour (the kind's, a custom one, or for a home a crew sheet's,
  which then follows the sheet live) and **Broken** (a rounded strike line in a gap through the
  icon). A longer name grows away from the aligned edge. An empty name removes the label; a deleted
  label comes back while the name is set. Locking or unlocking the icon or the label does the same to
  the other one.
- **Place crew pins:** one pin per crew sheet that isn't on the map yet (not the shared sheet),
  all on the clicked spot. These are **linked**: name, initials, colour and order follow the sheet
  live. **Place a single pin:** a **custom** pin with its own name, initials and colour.
  "Edit map marker" switches a pin between Crew sheet (pick the sheet) and Custom.
- **Pins on one spot:** a pin dropped within a head's width of others snaps onto their exact spot,
  and the group is drawn as one thin column of their initials with one pointer (about a second
  after the drop; only while the GM is in the room). Drag one further away to take it out.
- **Sizes:** "Marker icon size" (location icons and pins) and "Marker text size" (location labels:
  plate, bar and text) in the extension's popover (GM). A label's distance from its icon scales with
  the text size.
- **Add locations…** (same popover, GM): paste JSON or text, and the locations are added below each
  other in the middle of the view, ready to be placed. JSON is an array of
  `{"name", "kind", "align"?, "color"?, "broken"?, "sheet"?}` (`sheet` = crew handle whose colour a
  home takes); text is one `kind: name` (or just a name) per line, `|` for a line break.
  `designs/locations-import.json` holds all locations from the mock data.
- **Layers:** pins are on Character (players can move them), locations and labels on Prop.

