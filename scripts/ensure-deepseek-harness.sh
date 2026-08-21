#!/usr/bin/env bash
#
# Prepare the DeepSeek Harness submodule for a KnoxCoder production build:
# clone via .gitmodules, install with pnpm, and build the CLI.
#
# Usage:
#   ./scripts/ensure-deepseek-harness.sh                 # clone + pnpm install + build
#   ./scripts/ensure-deepseek-harness.sh checkout-only   # clone only (no Node required)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECKOUT="third_party/deepseek-harness"
MODE="${1:-all}"
GIT=(git -c "url.https://github.com/.insteadOf=git@github.com:")

harness_url() {
	"${GIT[@]}" config -f .gitmodules --get submodule.third_party/deepseek-harness.url \
		|| echo "https://github.com/deepseek-ai/deepseek-harness.git"
}

recorded_sha() {
	"${GIT[@]}" ls-tree HEAD "$CHECKOUT" 2>/dev/null | awk '{print $3}' || true
}

checkout_harness() {
	if [[ -f "$CHECKOUT/package.json" ]]; then
		echo "DeepSeek Harness already checked out at $CHECKOUT"
		return 0
	fi

	echo ">>> Cloning DeepSeek Harness submodule..."
	mkdir -p third_party
	"${GIT[@]}" submodule sync --recursive -- "$CHECKOUT" || true
	if "${GIT[@]}" submodule update --init --recursive -- "$CHECKOUT" \
		&& [[ -f "$CHECKOUT/package.json" ]]; then
		echo "DeepSeek Harness submodule is ready."
		return 0
	fi

	local url sha
	url="$(harness_url)"
	sha="$(recorded_sha)"
	echo ">>> Submodule update did not populate $CHECKOUT; cloning $url"
	rm -rf "$CHECKOUT"
	"${GIT[@]}" clone --recurse-submodules "$url" "$CHECKOUT"
	if [[ -n "$sha" ]]; then
		echo ">>> Checking out recorded submodule commit $sha"
		"${GIT[@]}" -C "$CHECKOUT" fetch --depth 1 origin "$sha" || "${GIT[@]}" -C "$CHECKOUT" fetch origin "$sha"
		"${GIT[@]}" -C "$CHECKOUT" checkout --detach "$sha"
	fi

	if [[ ! -f "$CHECKOUT/package.json" ]]; then
		echo "Failed to clone DeepSeek Harness into $CHECKOUT" >&2
		exit 1
	fi
	echo "DeepSeek Harness clone is ready."
}

checkout_harness

if [[ "$MODE" == "checkout-only" ]]; then
	exit 0
fi

if ! command -v node >/dev/null 2>&1; then
	echo "Node.js is required to install and build DeepSeek Harness." >&2
	exit 1
fi

echo ">>> Installing and building DeepSeek Harness..."
node --experimental-strip-types --no-warnings "$ROOT/build/lib/deepseekHarness.ts"
