#!/usr/bin/env bash
# Start a headed Chromium with a CDP port for testing in a real Owlbear Rodeo room.
#   tools/obr-test/launch.sh gm    [url]   -> port 9222, profile ~/.cache/vtt-obr/gm
#   tools/obr-test/launch.sh guest [url]   -> port 9223, profile ~/.cache/vtt-obr/guest
# Profiles persist, so the GM login (throwaway account) survives between sessions.
set -euo pipefail
name=${1:?gm or guest}
url=${2:-https://www.owlbear.rodeo/}
case "$name" in gm) port=9222 ;; guest) port=9223 ;; *) port=${PORT:?set PORT for other names} ;; esac
chrome=$(ls -d /nix/store/*-playwright-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)
[ -n "$chrome" ] || { echo "No Playwright Chromium in the nix store" >&2; exit 1; }
profile="$HOME/.cache/vtt-obr/$name"
mkdir -p "$profile"
exec "$chrome" --user-data-dir="$profile" --remote-debugging-port="$port" \
  --no-first-run --no-default-browser-check \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --window-size=1500,950 "$url"
