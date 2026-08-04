#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -f "$ROOT/resources/logo.png" && ! -f "$ROOT/resources/logo.svg" ]]; then
	echo "Missing resources/logo.png and resources/logo.svg" >&2
	exit 1
fi

if [[ ! -d "$SCRIPT_DIR/node_modules/sharp" ]]; then
	echo "Installing icon generation dependencies..."
	npm install --prefix "$SCRIPT_DIR" --no-fund --no-audit
fi

node "$SCRIPT_DIR/generate-icons.mjs"
