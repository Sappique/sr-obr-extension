#!/usr/bin/env bash
# Run an async snippet with the OBR SDK inside the extension's background iframe.
#   tools/obr-test/obr.sh <port> '<async body using OBR; return a JSON-able value>'
# It imports the exact SDK module the extension uses, so OBR.* calls act as that client.
dir=$(dirname "$0")
body="$2"
node "$dir/cdp.mjs" "$1" eval background.html -e "(async () => { const sdk = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('owlbear-rodeo_sdk')); const { default: OBR } = await import(sdk); $body })().catch(e => 'ERR ' + (e?.stack || e))"
