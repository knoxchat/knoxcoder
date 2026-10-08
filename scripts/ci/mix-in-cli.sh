#!/usr/bin/env bash
# Build the Rust CLI (knoxcoder-tunnel) and copy it into an already packaged
# desktop tree at ../VSCode-<platform>-<arch>/bin/, matching the upstream
# "Mix in CLI" step. Debian/RPM dependency generation requires that binary.
#
# Usage:
#   VSCODE_ARCH=x64 ./scripts/ci/mix-in-cli.sh
#
# Environment:
#   VSCODE_ARCH       x64 | arm64   (default: x64)
#   VSCODE_PLATFORM   linux | win32 (default: detected from uname)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ARCH="${VSCODE_ARCH:-x64}"
UNAME="$(uname -s)"
if [[ -n "${VSCODE_PLATFORM:-}" ]]; then
	PLATFORM="$VSCODE_PLATFORM"
elif [[ "$UNAME" == MINGW* || "$UNAME" == MSYS* || "$UNAME" == CYGWIN* || "$UNAME" == *NT* ]]; then
	PLATFORM=win32
else
	PLATFORM=linux
fi

if ! command -v cargo >/dev/null 2>&1; then
	echo "Installing Rust toolchain..."
	if [[ "$PLATFORM" == "win32" ]]; then
		if [[ "$ARCH" == "arm64" ]]; then
			RUSTUP_HOST="aarch64-pc-windows-msvc"
			RUSTUP_URL="https://static.rust-lang.org/rustup/dist/aarch64-pc-windows-msvc/rustup-init.exe"
		else
			RUSTUP_HOST="x86_64-pc-windows-msvc"
			RUSTUP_URL="https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"
		fi
		curl -sSfL "$RUSTUP_URL" -o /tmp/rustup-init.exe
		/tmp/rustup-init.exe -y --profile minimal --default-toolchain stable --default-host "$RUSTUP_HOST"
	else
		curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
	fi
	# shellcheck disable=SC1091
	source "$HOME/.cargo/env"
fi

OPENSSL_ROOT="$ROOT/.build/openssl"
if [[ ! -d "$OPENSSL_ROOT/out" ]]; then
	echo "Downloading @vscode/openssl-prebuilt..."
	mkdir -p "$OPENSSL_ROOT"
	(cd "$OPENSSL_ROOT" && npm pack @vscode/openssl-prebuilt@0.0.11 && tar -xzf vscode-openssl-prebuilt-*.tgz --strip-components=1)
fi

to_native_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
	else
		printf '%s\n' "$1"
	fi
}

TUNNEL_APP_NAME="$(node -p "require('./product.json').tunnelApplicationName")"
CLIENT_DIR="$(dirname "$ROOT")/VSCode-${PLATFORM}-${ARCH}"
if [[ ! -d "$CLIENT_DIR" ]]; then
	echo "Expected packaged app at $CLIENT_DIR" >&2
	exit 1
fi
mkdir -p "$CLIENT_DIR/bin"

echo "Building CLI (tunnel binary) for ${PLATFORM}-${ARCH}..."
if [[ "$PLATFORM" == "win32" ]]; then
	OPENSSL_TRIPLE="${ARCH}-windows-static"
	export OPENSSL_LIB_DIR="$(to_native_path "$OPENSSL_ROOT/out/${OPENSSL_TRIPLE}/lib")"
	export OPENSSL_INCLUDE_DIR="$(to_native_path "$OPENSSL_ROOT/out/${OPENSSL_TRIPLE}/include")"
	(
		cd cli
		export VSCODE_CLI_COMMIT="$(git rev-parse HEAD)"
		cargo build --release --bin=code
	)
	cp "cli/target/release/code.exe" "$CLIENT_DIR/bin/${TUNNEL_APP_NAME}.exe"
	echo "Installed $CLIENT_DIR/bin/${TUNNEL_APP_NAME}.exe"
else
	OPENSSL_TRIPLE="${ARCH}-linux"
	export OPENSSL_LIB_DIR="$OPENSSL_ROOT/out/${OPENSSL_TRIPLE}/lib"
	export OPENSSL_INCLUDE_DIR="$OPENSSL_ROOT/out/${OPENSSL_TRIPLE}/include"
	(
		cd cli
		# Chromium client toolchain flags from build/linux/setup-env.sh must not leak here.
		unset CC CXX CXXFLAGS LDFLAGS
		export VSCODE_CLI_COMMIT="$(git rev-parse HEAD)"
		cargo build --release --bin=code
	)
	cp "cli/target/release/code" "$CLIENT_DIR/bin/${TUNNEL_APP_NAME}"
	chmod +x "$CLIENT_DIR/bin/${TUNNEL_APP_NAME}"
	echo "Installed $CLIENT_DIR/bin/${TUNNEL_APP_NAME}"
fi
