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

# Build the CLI (tunnel binary) and place it next to the desktop app, like the
# upstream "Mix in CLI" step. The deb dependency generator requires it.
echo "Building CLI (tunnel binary)..."
if ! command -v cargo > /dev/null 2>&1; then
	echo "Installing Rust toolchain..."
	curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
	source "$HOME/.cargo/env"
fi

# Static OpenSSL, same package/version as the upstream CLI pipelines.
OPENSSL_ROOT="$ROOT/.build/openssl"
if [ ! -d "$OPENSSL_ROOT/out" ]; then
	mkdir -p "$OPENSSL_ROOT"
	(cd "$OPENSSL_ROOT" && npm pack @vscode/openssl-prebuilt@0.0.11 && tar -xzf vscode-openssl-prebuilt-*.tgz --strip-components=1)
fi

# Link against the glibc 2.28 sysroot (downloaded by setup-env.sh) so the
# generated .deb dependencies stay compatible with older distros.
CLI_TARGET="x86_64-unknown-linux-gnu"
if command -v rustup > /dev/null 2>&1; then
	rustup target add "$CLI_TARGET" > /dev/null
fi
(
	cd cli
	# The Chromium client toolchain flags exported above must not leak into
	# crate build scripts.
	unset CC CXX CXXFLAGS LDFLAGS
	export VSCODE_CLI_COMMIT="$(git rev-parse HEAD)"
	export OPENSSL_LIB_DIR="$OPENSSL_ROOT/out/x64-linux/lib"
	export OPENSSL_INCLUDE_DIR="$OPENSSL_ROOT/out/x64-linux/include"
	export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER="$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/bin/x86_64-linux-gnu-gcc"
	export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-C link-arg=--sysroot=$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/x86_64-linux-gnu/sysroot -C link-arg=-L$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/x86_64-linux-gnu/sysroot/usr/lib/x86_64-linux-gnu"
	export CC_x86_64_unknown_linux_gnu="$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/bin/x86_64-linux-gnu-gcc --sysroot=$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/x86_64-linux-gnu/sysroot"
	export CXX_x86_64_unknown_linux_gnu="$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/bin/x86_64-linux-gnu-g++ --sysroot=$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/x86_64-linux-gnu/sysroot"
	export PKG_CONFIG_LIBDIR_x86_64_unknown_linux_gnu="$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/x86_64-linux-gnu/sysroot/usr/lib/x86_64-linux-gnu/pkgconfig:$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/x86_64-linux-gnu/sysroot/usr/share/pkgconfig"
	export PKG_CONFIG_SYSROOT_DIR_x86_64_unknown_linux_gnu="$VSCODE_CLIENT_SYSROOT_DIR/x86_64-linux-gnu/x86_64-linux-gnu/sysroot"
	cargo build --release --target "$CLI_TARGET" --bin=code
)

TUNNEL_APP_NAME="$(node -p "require('./product.json').tunnelApplicationName")"
mkdir -p "../VSCode-linux-${VSCODE_ARCH}/bin"
cp "cli/target/$CLI_TARGET/release/code" "../VSCode-linux-${VSCODE_ARCH}/bin/$TUNNEL_APP_NAME"
chmod +x "../VSCode-linux-${VSCODE_ARCH}/bin/$TUNNEL_APP_NAME"

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
