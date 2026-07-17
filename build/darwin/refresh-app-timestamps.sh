#!/usr/bin/env bash
#
# Refresh modification dates on a macOS .app bundle.
#
# zip -X strips Unix timestamp extra fields; unzip then restores entries as
# 1980-01-01 (the MS-DOS ZIP epoch). Run this after packaging round-trips
# or before publishing so Finder shows the correct build date.
#
set -euo pipefail

if [[ $# -lt 1 ]]; then
	echo "Usage: $0 <path-to-.app>" >&2
	exit 1
fi

APP_PATH="$1"

if [[ ! -d "$APP_PATH" ]]; then
	echo "App bundle not found: $APP_PATH" >&2
	exit 1
fi

echo "Refreshing timestamps on: $APP_PATH"
find "$APP_PATH" -exec touch -m {} +
touch -m "$APP_PATH"
