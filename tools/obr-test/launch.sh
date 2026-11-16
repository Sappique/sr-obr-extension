#!/usr/bin/env bash
# Start Chromium (headed, or headless with HEADLESS=1) with a CDP port for testing in a real Owlbear Rodeo room.
#   tools/obr-test/launch.sh gm    [url]   -> port 9222, profile ~/.cache/vtt-obr/gm
#   tools/obr-test/launch.sh guest [url]   -> port 9223, profile ~/.cache/vtt-obr/guest
# Profiles persist, so the GM login (throwaway account) survives between sessions.
# HEADLESS=1 runs it without a window (sign in headed once first). SIZE=WxH sets the viewport.
set -euo pipefail
name=${1:?gm or guest}
url=${2:-https://www.owlbear.rodeo/}
case "$name" in gm) port=9222 ;; guest) port=9223 ;; *) port=${PORT:?set PORT for other names} ;; esac
chrome=$(ls -d /nix/store/*-playwright-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)
[ -n "$chrome" ] || { echo "No Playwright Chromium in the nix store" >&2; exit 1; }
profile="$HOME/.cache/vtt-obr/$name"
mkdir -p "$profile"
rm -f "$profile"/Singleton{Lock,Socket,Cookie}  # stale locks from a crashed or copied profile
extra=()
if [ -n "${HEADLESS:-}" ]; then
  # Software WebGL for OBR's canvas, and the normal Chrome user agent (headless says "HeadlessChrome").
  ver=$("$chrome" --version | grep -oE '[0-9]+' | head -1)
  # Without a display: the Wayland session env makes SwiftShader's Vulkan ask for a Wayland surface.
  unset WAYLAND_DISPLAY DISPLAY EGL_PLATFORM NIXOS_OZONE_WL
  extra=(--headless=new --ozone-platform=headless --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars
    # Headless has no pointing device (pointer: none, hover: none); OBR then acts as on a touch
    # screen and dragging an unselected item does nothing. Report a mouse (fine pointer + hover).
    --blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2
    --user-agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$ver.0.0.0 Safari/537.36")
fi
exec "$chrome" --user-data-dir="$profile" --remote-debugging-port="$port" \
  --no-first-run --no-default-browser-check \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --window-size="${SIZE:-1500,950}" "${extra[@]}" "$url"
