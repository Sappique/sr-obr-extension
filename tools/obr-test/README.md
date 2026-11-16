# OBR test helpers

Drive the extension in a **real** Owlbear Rodeo room from the command line, as GM and as a
guest player. The Playwright MCP can't do this (headless, no saved login), so we use headed
Chromium windows with a CDP (DevTools protocol) port and a tiny Node client (built-ins only).

## Setup (once per session)

1. `npm run dev` in `vtt_extension/` (port 5175).
2. `tools/obr-test/launch.sh gm` — sign in with the throwaway account (the profile is kept in
   `~/.cache/vtt-obr/gm`, so later sessions stay signed in). Open the test room and make sure the
   extension `http://localhost:5175/manifest.json` is added.
3. `tools/obr-test/launch.sh guest '<room url>'` — joins as a guest ("Ask to join"); the GM accepts.
   You can fill the name and click the button with `cdp.mjs 9223 eval /room/ -e '...'`.

The windows may sit on other workspaces, but must not be minimised (screenshots go blank).

## Commands

| Command | What |
|---|---|
| `node tools/obr-test/cdp.mjs <port> list` | Pages and iframes (each extension page is its own target). |
| `node tools/obr-test/cdp.mjs <port> eval <urlPart> -e '<expr>'` | Evaluate in the first target whose URL contains `urlPart` (promises awaited). |
| `tools/obr-test/obr.sh <port> '<async body>'` | Like eval in `background.html`, with `OBR` imported (same SDK instance as the extension). Return a JSON-able value. |
| `node tools/obr-test/cdp.mjs <port> shot <out.png>` | Screenshot of the room tab. |
| `node tools/obr-test/cdp.mjs <port> click x y` / `rclick x y` / `drag x1 y1 x2 y2` | Real mouse input on the room page (CSS px of the screenshot). |

Ports: GM 9222, guest 9223.

## Tips

- Scene to screen: `screen = scenePos * viewportScale + viewportPosition` (`OBR.viewport.getScale()`,
  `getPosition()`); `OBR.viewport.setPosition/setScale` to frame an area first.
- Use real tool clicks to test tool code: `OBR.tool.activateTool(id)` and
  `OBR.tool.activateMode(id, modeId)` via `obr.sh`, then `cdp.mjs click`.
- Only the GM client runs the extension's syncs; wait ~1–2 s after a change before checking.
- Context-menu embeds (e.g. `map-editor.html`) are separate targets while the menu is open; edit
  their inputs via `eval` and dispatch `input`/`change` events.
