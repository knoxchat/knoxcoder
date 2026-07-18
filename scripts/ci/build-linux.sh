#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export VSCODE_ARCH="${VSCODE_ARCH:-x64}"
export npm_config_arch="${npm_config_arch:-x64}"

echo "Building KnoxCoder for Linux (${VSCODE_ARCH})..."

echo "Installing build npm dependencies..."
for i in {1..5}; do
	if (cd build && npm ci); then
		break
	fi
	if [ "$i" -eq 5 ]; then
		echo "npm ci failed in build/ after 5 attempts" >&2
		exit 1
	fi
	echo "Retrying build/ npm ci ($i/5)..."
done

# Native module toolchain and sysroots (see build/azure-pipelines/linux/setup-env.sh).
# Requires build/node_modules for scripts such as build/linux/libcxx-fetcher.ts.
source ./build/azure-pipelines/linux/setup-env.sh

# npm install scripts for packages like @vscode/policy-watcher must not inherit the
# Chromium client toolchain flags (-flto=thin, -fuse-ld=lld, etc.).
VSCODE_CI_CC="${CC:-}"
VSCODE_CI_CXX="${CXX:-}"
VSCODE_CI_CXXFLAGS="${CXXFLAGS:-}"
VSCODE_CI_LDFLAGS="${LDFLAGS:-}"
unset CC CXX CXXFLAGS LDFLAGS

node build/npm/preinstall.ts

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

export CC="$VSCODE_CI_CC"
export CXX="$VSCODE_CI_CXX"
export CXXFLAGS="$VSCODE_CI_CXXFLAGS"
export LDFLAGS="$VSCODE_CI_LDFLAGS"
unset VSCODE_CI_CC VSCODE_CI_CXX VSCODE_CI_CXXFLAGS VSCODE_CI_LDFLAGS

echo "Downloading built-in extensions..."
node build/lib/builtInExtensions.ts

echo "Compiling..."
npm run gulp core-ci

echo "Packaging desktop app..."
npm run gulp "vscode-linux-${VSCODE_ARCH}-min-ci"

echo "Building .deb package..."
npm run gulp "vscode-linux-${VSCODE_ARCH}-prepare-deb"
npm run gulp "vscode-linux-${VSCODE_ARCH}-build-deb"

VERSION="$(node -p "require('./package.json').version")"
ARTIFACT_DIR="$ROOT/.build/ci-artifacts/linux-${VSCODE_ARCH}"
mkdir -p "$ARTIFACT_DIR"

tar -czf "$ARTIFACT_DIR/knoxcoder-linux-${VSCODE_ARCH}-${VERSION}.tar.gz" -C .. "VSCode-linux-${VSCODE_ARCH}"

DEB="$(find "$ROOT/.build/linux/deb" -name '*.deb' -type f | head -1)"
if [ -n "$DEB" ]; then
	cp "$DEB" "$ARTIFACT_DIR/knoxcoder_${VERSION}_${VSCODE_ARCH}.deb"
fi

echo "Artifacts written to $ARTIFACT_DIR"
ls -la "$ARTIFACT_DIR"
