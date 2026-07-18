#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export VSCODE_ARCH="${VSCODE_ARCH:-x64}"
export npm_config_arch="${npm_config_arch:-x64}"
export npm_config_foreground_scripts="${npm_config_foreground_scripts:-true}"

echo "Building KnoxCoder for Windows (${VSCODE_ARCH})..."

# patchWin32DependenciesTask uses signtool from the Windows SDK when stripping signatures.
SDK_BIN=""
for candidate in /c/Program\ Files\ \(x86\)/Windows\ Kits/10/bin/*/x64; do
	if [ -x "$candidate/signtool.exe" ]; then
		SDK_BIN="$candidate"
	fi
done
if [ -n "$SDK_BIN" ]; then
	export PATH="$SDK_BIN:$PATH"
	echo "Using Windows SDK tools from $SDK_BIN"
else
	echo "Warning: signtool not found; Windows packaging may fail if signed binaries are present." >&2
fi

echo "Installing npm dependencies..."
for i in {1..5}; do
	if npm ci; then
		break
	fi
	if [ "$i" -eq 5 ]; then
		echo "npm ci failed after 5 attempts" >&2
		exit 1
	fi
	echo "Retrying npm ci ($i/5)..."
done

echo "Downloading built-in extensions..."
node build/lib/builtInExtensions.ts

echo "Compiling..."
npm run gulp core-ci

echo "Packaging desktop app..."
npm run gulp "vscode-win32-${VSCODE_ARCH}-min-ci"
npm run gulp "vscode-win32-${VSCODE_ARCH}-inno-updater"

# Build the CLI (tunnel binary) and place it next to the desktop app, like the
# upstream "Move VS Code CLI" step, so the archive and installers include it.
echo "Building CLI (tunnel binary)..."

# Static OpenSSL, same package/version as the upstream CLI pipelines.
OPENSSL_ROOT="$ROOT/.build/openssl"
if [ ! -d "$OPENSSL_ROOT/out" ]; then
	mkdir -p "$OPENSSL_ROOT"
	(cd "$OPENSSL_ROOT" && npm pack @vscode/openssl-prebuilt@0.0.11 && tar -xzf vscode-openssl-prebuilt-*.tgz --strip-components=1)
fi

(
	cd cli
	export VSCODE_CLI_COMMIT="$(git rev-parse HEAD)"
	# Rust build scripts need Windows-style paths.
	export OPENSSL_LIB_DIR="$(cygpath -m "$OPENSSL_ROOT/out/${VSCODE_ARCH}-windows-static/lib")"
	export OPENSSL_INCLUDE_DIR="$(cygpath -m "$OPENSSL_ROOT/out/${VSCODE_ARCH}-windows-static/include")"
	cargo build --release --bin=code
)

TUNNEL_APP_NAME="$(node -p "require('./product.json').tunnelApplicationName")"
mkdir -p "$(dirname "$ROOT")/VSCode-win32-${VSCODE_ARCH}/bin"
cp "cli/target/release/code.exe" "$(dirname "$ROOT")/VSCode-win32-${VSCODE_ARCH}/bin/${TUNNEL_APP_NAME}.exe"

echo "Building installers..."
npm run gulp "vscode-win32-${VSCODE_ARCH}-system-setup"
npm run gulp "vscode-win32-${VSCODE_ARCH}-user-setup"

VERSION="$(node -p "require('./package.json').version")"
ARTIFACT_DIR="$ROOT/.build/ci-artifacts/win32-${VSCODE_ARCH}"
mkdir -p "$ARTIFACT_DIR"

CLIENT_DIR="$(dirname "$ROOT")/VSCode-win32-${VSCODE_ARCH}"
if [ ! -d "$CLIENT_DIR" ]; then
	echo "Expected client output at $CLIENT_DIR" >&2
	exit 1
fi

# GitHub-hosted Windows runners include 7-Zip. The packaged app lives next to the repo root.
(
	cd "$(dirname "$ROOT")"
	7z a -tzip "$ARTIFACT_DIR/knoxcoder-win32-${VSCODE_ARCH}-${VERSION}.zip" "./VSCode-win32-${VSCODE_ARCH}/*" -r -mx=3
)

SYSTEM_SETUP="$ROOT/.build/win32-${VSCODE_ARCH}/system-setup/VSCodeSetup.exe"
USER_SETUP="$ROOT/.build/win32-${VSCODE_ARCH}/user-setup/VSCodeSetup.exe"

if [ -f "$SYSTEM_SETUP" ]; then
	cp "$SYSTEM_SETUP" "$ARTIFACT_DIR/KnoxCoderSetup-${VSCODE_ARCH}-${VERSION}.exe"
fi
if [ -f "$USER_SETUP" ]; then
	cp "$USER_SETUP" "$ARTIFACT_DIR/KnoxCoderUserSetup-${VSCODE_ARCH}-${VERSION}.exe"
fi

echo "Artifacts written to $ARTIFACT_DIR"
ls -la "$ARTIFACT_DIR"
