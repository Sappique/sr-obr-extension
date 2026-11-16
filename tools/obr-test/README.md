# OBR test helpers

Drive the extension in a **real** Owlbear Rodeo room from the command line, as GM and as a
guest player. The Playwright MCP can't do this (no saved login), so we start our own Chromium
(the Playwright one from the nix store) with a CDP (DevTools protocol) port and drive it with a
tiny Node client (built-ins only). Normally it runs **headless**: no windows, nothing depends on
a visible workspace.

## Setup

1. `npm run dev` in `vtt_extension/` (port 5175).
2. **Once, headed**, to sign in (profiles persist in `~/.cache/vtt-obr/gm` and `.../guest`):
   - `tools/obr-test/launch.sh gm`: sign in with the throwaway account, open the test room and
     make sure the extension `http://localhost:5175/manifest.json` is added.
   - `tools/obr-test/launch.sh guest '<room url>'`: join as a guest ("Ask to join"), the GM
     accepts. You can fill the name and click the button with `cdp.mjs 9223 eval /room/ -e '...'`.
   - Close both cleanly (`Browser.close` over CDP, or close the window) so the profiles are saved.
3. **Every session, headless** (in the background, it doesn't return):
   ```sh
   R='<room url>'
   HEADLESS=1 setsid nohup tools/obr-test/launch.sh gm "$R" >/tmp/gm.log 2>&1 </dev/null &
   HEADLESS=1 SIZE=1200,850 setsid nohup tools/obr-test/launch.sh guest "$R" >/tmp/guest.log 2>&1 </dev/null &
   ```
   The GM stays signed in and the guest gets straight back into the room (no new join request).
   Each page shows a "WebGL Support Required" dialog (software WebGL); dismiss it:
   `cdp.mjs <port> eval /room/ -e '[...document.querySelectorAll("button")].find(b=>b.innerText==="ACKNOWLEDGE")?.click()'`.
   Stop them with CDP `Browser.close` (not `kill -9`, which can lose profile state).

What `HEADLESS=1` adds (see `launch.sh`):

- `--headless=new --ozone-platform=headless`, and it unsets `WAYLAND_DISPLAY`, `DISPLAY`,
  `EGL_PLATFORM`, `NIXOS_OZONE_WL`. With the Wayland session env, SwiftShader's Vulkan asks for a
  Wayland surface, fails, and OBR shows "Unable to create WebGL Context".
- `--use-angle=swiftshader --enable-unsafe-swiftshader`: software WebGL (OBR's canvas needs it).
- `--blink-settings=primaryPointerType=4,...,availableHoverTypes=2`: headless reports no pointing
  device (`pointer: none`, `hover: none`); this reports a mouse.
- `--user-agent=` the normal Chrome UA of the same version (headless would say "HeadlessChrome").
  Cloudflare/OBR didn't challenge it.
- `--hide-scrollbars`; `SIZE=W,H` sets the window (default `1500,950`). The page viewport is
  about 143 px shorter than the window (1500x950 gives 1500x807), at device pixel ratio 1, so
  screenshot pixels = CSS px = click coordinates.

### Caveats

- **Dragging items:** with the Select tool (rectangle mode), OBR only drags items that are already
  selected; pressing on an unselected item starts a selection rectangle. That's OBR's logic,
  not a headless quirk. Use the Move tool (`rodeo.owlbear.tool/move`) to drag unselected items, or
  click first to select. Grid snapping applies.
- `shot` uses a plain capture. Don't use `captureBeyondViewport` headless: it can return the
  WebGL canvas blank or stale.
- SwiftShader is slower than a GPU but fine for a mostly static map; a drag takes about 1 s.

### Alternative: headed on a virtual sway output

If something needs a real GPU or a real window, sway can create an invisible monitor that renders
normally (tested: about 60 fps, CDP input and plain screenshots work):
`swaymsg create_output` (prints nothing; the new one is the last `HEADLESS-n` in
`swaymsg -t get_outputs`), `swaymsg output HEADLESS-n position 20000 0`, start the headed
browser, `swaymsg '[con_id=<id>] move to output HEADLESS-n'`, and `swaymsg output HEADLESS-n unplug`
at the end. The window shows up briefly on the current workspace before it's moved, and the
output gets a workspace you can reach with the keyboard. Headed windows on a normal but
**hidden** workspace don't work: sway sends them no frames, so `click`/`drag`/`rclick` hang and
plain screenshots never return.

## Commands

| Command | What |
|---|---|
| `node tools/obr-test/cdp.mjs <port> list` | Pages and iframes (each extension page is its own target). |
| `node tools/obr-test/cdp.mjs <port> eval <urlPart> -e '<expr>'` | Evaluate in the first target whose URL contains `urlPart` (promises awaited). |
| `tools/obr-test/obr.sh <port> '<async body>'` | Like eval in `background.html`, with `OBR` imported (same SDK instance as the extension). Return a JSON-able value. |
| `node tools/obr-test/cdp.mjs <port> shot <out.png>` | Screenshot of the room tab. |
| `node tools/obr-test/cdp.mjs <port> click x y` / `rclick x y` / `drag x1 y1 x2 y2` | Real mouse input on the room page (CSS px; short pauses between events, so OBR sees each frame). |

Ports: GM 9222, guest 9223.

## Tips

- Scene to screen: `screen = scenePos * viewportScale + viewportPosition` (`OBR.viewport.getScale()`,
  `getPosition()`); `OBR.viewport.setPosition/setScale` to frame an area first.
- Use real tool clicks to test tool code: `OBR.tool.activateTool(id)` and
  `OBR.tool.activateMode(id, modeId)` via `obr.sh`, then `cdp.mjs click`.
- Headed on a HiDPI output, screenshots are in device pixels (twice the CSS px); click coordinates are CSS px.
- Only the GM client runs the extension's syncs; wait ~1–2 s after a change before checking.
- Context-menu embeds (e.g. `map-editor.html`) are separate targets while the menu is open; edit
  their inputs via `eval` and dispatch `input`/`change` events.
