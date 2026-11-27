#!/usr/bin/env bash
# Builds the Chrome Web Store zip with only the files the extension needs.
# Usage: scripts/build-zip.sh [output.zip]  (defaults to dist/TabSwitch-v<manifest version>.zip)
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
out="${1:-dist/TabSwitch-v${version}.zip}"

mkdir -p "$(dirname "$out")"
rm -f "$out"
zip -X -q "$out" manifest.json background.js content.js switcher-ui.js popup.html popup.js \
  icons/icon16.png icons/icon48.png icons/icon128.png
echo "$out"
