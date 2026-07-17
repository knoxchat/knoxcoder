#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# VS Code 1.129.0 requires Node.js v24.18.0+ (see .nvmrc)
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
	# shellcheck disable=SC1091
	source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
	nvm use 2>/dev/null || nvm use 24.18.0
fi

ARCH="$(uname -m)"
case "$ARCH" in
	arm64) GULP_TASK="vscode-darwin-arm64" ;;
	x86_64) GULP_TASK="vscode-darwin-x64" ;;
	*)
		echo "Unsupported architecture: $ARCH"
		exit 1
		;;
esac

echo "Building standalone KnoxCoder app ($GULP_TASK)..."
echo "This can take 20-40 minutes on the first run."
echo

npm run gulp -- "$GULP_TASK"

APP_PATH="$(dirname "$ROOT")/VSCode-darwin-${ARCH}/KnoxCoder.app"

if [[ ! -d "$APP_PATH" ]]; then
	echo "Build finished but app bundle was not found at:"
	echo "  $APP_PATH"
	exit 1
fi

bash "$ROOT/build/darwin/refresh-app-timestamps.sh" "$APP_PATH"

echo
echo "Build complete!"
echo "  $APP_PATH"
echo
echo "Open directly:"
echo "  open \"$APP_PATH\""
echo
echo "Install to Applications (optional):"
echo "  ditto \"$APP_PATH\" \"/Applications/KnoxCoder.app\""
