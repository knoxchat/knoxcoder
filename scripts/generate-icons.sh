#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_SVG="$ROOT/resources/logo.svg"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Generating icons from $SRC_SVG"

BASE_PNG="$TMP_DIR/logo-1024.png"
sips -s format png "$SRC_SVG" --out "$BASE_PNG" >/dev/null
sips -z 1024 1024 "$BASE_PNG" --out "$BASE_PNG" >/dev/null

resize_png() {
	local size="$1"
	local out="$2"
	sips -z "$size" "$size" "$BASE_PNG" --out "$out" >/dev/null
}

# Linux
resize_png 1024 "$ROOT/resources/linux/code.png"
cp "$ROOT/resources/linux/code.png" "$TMP_DIR/linux-code.png"
pngtopnm "$TMP_DIR/linux-code.png" | ppmtoxpm -name code > "$ROOT/resources/linux/rpm/code.xpm"

# Windows tiles
resize_png 150 "$ROOT/resources/win32/code_150x150.png"
resize_png 70 "$ROOT/resources/win32/code_70x70.png"

# Server / web
resize_png 192 "$ROOT/resources/server/code-192.png"
resize_png 512 "$ROOT/resources/server/code-512.png"

# ICO files (multi-size)
ICO_SIZES=(16 24 32 48 64 128 256)
ICO_INPUTS=()
for size in "${ICO_SIZES[@]}"; do
	out="$TMP_DIR/ico-${size}.png"
	resize_png "$size" "$out"
	ICO_INPUTS+=("$out")
done

npx --yes png-to-ico "${ICO_INPUTS[@]}" > "$ROOT/resources/win32/code.ico"
npx --yes png-to-ico "$TMP_DIR/ico-16.png" "$TMP_DIR/ico-32.png" "$TMP_DIR/ico-48.png" > "$ROOT/resources/server/favicon.ico"

# macOS .icns
ICONSET="$TMP_DIR/code.iconset"
mkdir -p "$ICONSET"
resize_png 16 "$ICONSET/icon_16x16.png"
resize_png 32 "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/icon_16x16@2x.png" "$ICONSET/icon_32x32.png"
resize_png 64 "$ICONSET/icon_32x32@2x.png"
resize_png 128 "$ICONSET/icon_128x128.png"
resize_png 256 "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/icon_128x128@2x.png" "$ICONSET/icon_256x256.png"
resize_png 512 "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/icon_256x256@2x.png" "$ICONSET/icon_512x512.png"
resize_png 1024 "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$ROOT/resources/darwin/code.icns"

# Refresh dev Electron bundle icon if present
ELECTRON_APP="$ROOT/.build/electron/KnoxCoder.app"
ELECTRON_ICNS="$ELECTRON_APP/Contents/Resources/KnoxCoder.icns"
if [[ -f "$ELECTRON_ICNS" ]]; then
	cp "$ROOT/resources/darwin/code.icns" "$ELECTRON_ICNS"
	touch "$ELECTRON_APP"
	# Bust macOS dock icon cache for the dev app bundle
	if [[ "$OSTYPE" == "darwin"* ]]; then
		/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$ELECTRON_APP" >/dev/null 2>&1 || true
	fi
fi

echo "Done. Generated:"
echo "  resources/darwin/code.icns"
echo "  resources/win32/code.ico"
echo "  resources/win32/code_150x150.png"
echo "  resources/win32/code_70x70.png"
echo "  resources/linux/code.png"
echo "  resources/linux/rpm/code.xpm"
echo "  resources/server/code-192.png"
echo "  resources/server/code-512.png"
echo "  resources/server/favicon.ico"
