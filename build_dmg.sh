#!/usr/bin/env bash
#
# macOS production build: compile, sign, create DMG, and optionally notarize.
# Configuration is loaded from .env.signing in the repo root.
#
# Usage:
#   ./build_dmg.sh                 # full production build + sign + DMG + notarize
#   ./build_dmg.sh --skip-build    # sign/notarize an existing build
#   ./build_dmg.sh --skip-notarize # build and sign only
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

SKIP_BUILD=false
SKIP_SIGN=false
SKIP_NOTARIZE=false
DMG_ONLY=false

for arg in "$@"; do
	case "$arg" in
		--skip-build) SKIP_BUILD=true ;;
		--skip-sign) SKIP_SIGN=true ;;
		--skip-notarize) SKIP_NOTARIZE=true ;;
		--dmg-only) DMG_ONLY=true; SKIP_BUILD=true; SKIP_SIGN=true ;;
		-h|--help)
			cat <<'EOF'
Usage: ./build_dmg.sh [options]

Options:
  --skip-build      Skip the gulp compile/package step
  --skip-sign       Skip code signing
  --skip-notarize   Skip Apple notarization (overrides NOTARIZE in .env.signing)
  --dmg-only        Only create/sign the DMG from an already signed app
  -h, --help        Show this help message

Output:
  dist/KnoxCoder-darwin-<arch>.dmg
  ../VSCode-darwin-<arch>/KnoxCoder.app

Important:
  Always open the app from the build output folder or the DMG.
  Do NOT copy the .app with Finder first — that adds hidden files and breaks
  the code signature, which macOS reports as "damaged".
EOF
			exit 0
			;;
		*)
			echo "Unknown option: $arg"
			exit 1
			;;
	esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "This script must be run on macOS."
	exit 1
fi

ENV_FILE="$ROOT/.env.signing"
if [[ ! -f "$ENV_FILE" ]]; then
	echo "Missing $ENV_FILE"
	echo "Create it from the template comments in .env.signing and fill in your Apple credentials."
	exit 1
fi

# shellcheck disable=SC1091
source "$ENV_FILE"

require_var() {
	if [[ -z "${!1:-}" ]]; then
		echo "Missing required variable in .env.signing: $1"
		exit 1
	fi
}

require_var APPLE_SIGNING_IDENTITY
require_var APPLE_ID
require_var APPLE_TEAM_ID

ARCH="$(uname -m)"
case "$ARCH" in
	arm64) VSCODE_ARCH="arm64"; GULP_TASK="vscode-darwin-arm64-min" ;;
	x86_64) VSCODE_ARCH="x64"; GULP_TASK="vscode-darwin-x64-min" ;;
	*)
		echo "Unsupported architecture: $ARCH"
		exit 1
		;;
esac

BUILD_DIR="$(dirname "$ROOT")"
APP_ROOT="$BUILD_DIR/VSCode-darwin-$VSCODE_ARCH"
PRODUCT_NAME="$(node -p "require('./product.json').nameLong")"
APP_PATH="$APP_ROOT/$PRODUCT_NAME.app"
DIST_DIR="$ROOT/dist"
DMG_PATH="$DIST_DIR/${PRODUCT_NAME}-darwin-${VSCODE_ARCH}.dmg"
NOTARIZE_ZIP="$DIST_DIR/${PRODUCT_NAME}-notarize.zip"
MIN_FREE_GB=5

export VSCODE_ARCH
export VSCODE_QUALITY="${VSCODE_QUALITY:-stable}"
export CODESIGN_IDENTITY="$APPLE_SIGNING_IDENTITY"

should_notarize() {
	[[ "$SKIP_NOTARIZE" == "false" && "${NOTARIZE:-false}" == "true" ]]
}

verify_signing_identity() {
	if ! security find-identity -v -p codesigning | grep -Fq "$APPLE_SIGNING_IDENTITY"; then
		echo "Developer ID not found in keychain:"
		echo "  $APPLE_SIGNING_IDENTITY"
		echo
		echo "Available identities:"
		security find-identity -v -p codesigning || true
		exit 1
	fi
}

check_disk_space() {
	local avail_kb
	avail_kb="$(df -k "$DIST_DIR" 2>/dev/null | awk 'NR==2 {print $4}' || df -k "$ROOT" | awk 'NR==2 {print $4}')"
	local avail_gb=$((avail_kb / 1024 / 1024))
	if (( avail_gb < MIN_FREE_GB )); then
		echo "Need at least ${MIN_FREE_GB} GB free disk space for DMG creation (found ~${avail_gb} GB)."
		exit 1
	fi
}

submit_for_notarization() {
	local artifact="$1"
	local label="$2"

	echo "Submitting $label for notarization..."
	if [[ -n "${APPLE_NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
		xcrun notarytool submit "$artifact" \
			--keychain-profile "$APPLE_NOTARY_KEYCHAIN_PROFILE" \
			--wait
	else
		require_var APPLE_PASSWORD
		xcrun notarytool submit "$artifact" \
			--apple-id "$APPLE_ID" \
			--password "$APPLE_PASSWORD" \
			--team-id "$APPLE_TEAM_ID" \
			--wait
	fi
}

staple_artifact() {
	local artifact="$1"
	local label="$2"

	echo "Stapling notarization ticket to $label..."
	xcrun stapler staple "$artifact"
	xcrun stapler validate "$artifact"
}

verify_dmg_app() {
	local mount_point
	mount_point="$(hdiutil attach "$DMG_PATH" -readonly -nobrowse | awk '/\/Volumes\// {print $3; exit}')"
	if [[ -z "$mount_point" ]]; then
		echo "Failed to mount DMG for verification: $DMG_PATH"
		exit 1
	fi

	local mounted_app="$mount_point/$PRODUCT_NAME.app"
	if [[ ! -d "$mounted_app" ]]; then
		hdiutil detach "$mount_point" >/dev/null 2>&1 || true
		echo "App not found inside DMG at: $mounted_app"
		exit 1
	fi

	echo ">>> Verifying app inside DMG..."
	if ! codesign --verify --deep --strict --verbose=2 "$mounted_app"; then
		hdiutil detach "$mount_point" >/dev/null 2>&1 || true
		echo "The DMG contains an invalid app copy. Delete the DMG and retry after freeing disk space."
		exit 1
	fi

	if should_notarize; then
		if ! spctl -a -vv --type exec "$mounted_app" 2>&1; then
			hdiutil detach "$mount_point" >/dev/null 2>&1 || true
			echo "The app inside the DMG failed Gatekeeper validation."
			exit 1
		fi
	fi

	hdiutil detach "$mount_point"
}

verify_app_signature() {
	echo ">>> Verifying app signature..."
	codesign --verify --deep --strict --verbose=2 "$APP_PATH"
}

verify_app_notarization() {
	echo ">>> Verifying app notarization..."
	xcrun stapler validate "$APP_PATH"
	spctl -a -vv --type exec "$APP_PATH"
}

verify_app() {
	verify_app_signature
	if should_notarize; then
		verify_app_notarization
	fi
}

# VS Code 1.129.0 requires Node.js v24.18.0+ (see .nvmrc)
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
	# shellcheck disable=SC1091
	source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
	nvm use 2>/dev/null || nvm use 24.18.0
fi

mkdir -p "$DIST_DIR"

echo "=== KnoxCoder macOS Production Build ==="
echo "  Architecture:  $VSCODE_ARCH"
echo "  App output:      $APP_PATH"
echo "  DMG output:      $DMG_PATH"
echo "  Sign identity:   $APPLE_SIGNING_IDENTITY"
echo "  Notarize:        $(should_notarize && echo yes || echo no)"
echo

if [[ "$SKIP_BUILD" == "false" ]]; then
	echo ">>> Building production app ($GULP_TASK)..."
	echo "    This can take 20-40 minutes on the first run."
	echo
	npm run gulp -- "$GULP_TASK"
fi

if [[ ! -d "$APP_PATH" ]]; then
	echo "App bundle not found at:"
	echo "  $APP_PATH"
	exit 1
fi

if [[ "$SKIP_SIGN" == "false" ]]; then
	verify_signing_identity

	echo ">>> Signing app with hardened entitlements..."
	node build/darwin/sign.ts "$BUILD_DIR"
	verify_app_signature
fi

echo ">>> Refreshing app bundle timestamps..."
bash build/darwin/refresh-app-timestamps.sh "$APP_PATH"

if should_notarize && [[ "$DMG_ONLY" == "false" ]]; then
	echo ">>> Notarizing app..."
	rm -f "$NOTARIZE_ZIP"
	ditto -c -k --keepParent "$APP_PATH" "$NOTARIZE_ZIP"
	submit_for_notarization "$NOTARIZE_ZIP" "app zip"
	staple_artifact "$APP_PATH" "app"
	rm -f "$NOTARIZE_ZIP"
	verify_app_notarization
fi

check_disk_space

echo ">>> Creating DMG..."
rm -f "$DMG_PATH"
node build/darwin/create-dmg.ts "$BUILD_DIR" "$DIST_DIR"

INTERIM_DMG="$DIST_DIR/VSCode-darwin-$VSCODE_ARCH.dmg"
if [[ ! -f "$INTERIM_DMG" ]]; then
	echo "DMG was not created at expected path: $INTERIM_DMG"
	exit 1
fi
mv "$INTERIM_DMG" "$DMG_PATH"

DISK_ICON="$ROOT/resources/darwin/disk.icns"
if [[ ! -f "$DISK_ICON" ]]; then
	DISK_ICON="$ROOT/resources/darwin/code.icns"
fi
if [[ -f "$DISK_ICON" ]]; then
	echo ">>> Patching DMG volume icon..."
	python3 build/darwin/patch-dmg.py "$DMG_PATH" "$DISK_ICON"
fi

echo ">>> Verifying DMG checksum..."
hdiutil verify "$DMG_PATH"
verify_dmg_app

if [[ "$SKIP_SIGN" == "false" || "$DMG_ONLY" == "true" ]]; then
	verify_signing_identity
	echo ">>> Signing DMG..."
	codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG_PATH"
	codesign --verify --verbose=2 "$DMG_PATH"
fi

if should_notarize; then
	echo ">>> Notarizing DMG..."
	submit_for_notarization "$DMG_PATH" "DMG"
	staple_artifact "$DMG_PATH" "DMG"
fi

echo
echo "=== Build complete ==="
echo "  App:  $APP_PATH"
echo "  DMG:  $DMG_PATH"
echo
echo "Open the DMG (recommended):"
echo "  open \"$DMG_PATH\""
echo
echo "Or open the app directly from the build folder:"
echo "  open \"$APP_PATH\""
echo
echo "To install to /Applications, use ditto (not Finder drag/copy):"
echo "  ditto \"$APP_PATH\" \"/Applications/$PRODUCT_NAME.app\""
