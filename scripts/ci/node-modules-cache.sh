#!/usr/bin/env bash
# Shared helpers for restoring/saving the upstream-style node_modules cache in CI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cache_archive_path() {
	if command -v 7z >/dev/null 2>&1; then
		echo "$ROOT/.build/node_modules_cache/cache.7z"
	else
		echo "$ROOT/.build/node_modules_cache/cache.tgz"
	fi
}

extract_node_modules_cache() {
	local archive
	archive="$(cache_archive_path)"
	if [ ! -f "$archive" ]; then
		echo "Expected node_modules cache archive at $archive" >&2
		exit 1
	fi

	echo "Extracting node_modules cache from $archive..."
	cd "$ROOT"
	if [[ "$archive" == *.7z ]]; then
		7z x "$archive" -aoa
	else
		tar -xzf "$archive"
	fi
}

save_node_modules_cache() {
	if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
		return 0
	fi

	echo "Creating node_modules cache archive..."
	cd "$ROOT"
	mkdir -p "$ROOT/.build/node_modules_cache"
	node "$ROOT/build/azure-pipelines/common/listNodeModules.ts" "$ROOT/.build/node_modules_list.txt"

	local archive
	archive="$(cache_archive_path)"
	if [[ "$archive" == *.7z ]]; then
		7z a "$archive" -mx3 @"$ROOT/.build/node_modules_list.txt"
	else
		tar -czf "$archive" --files-from "$ROOT/.build/node_modules_list.txt"
	fi
}

case "${1:-}" in
	extract)
		extract_node_modules_cache
		;;
	save)
		save_node_modules_cache
		;;
	*)
		echo "Usage: $0 {extract|save}" >&2
		exit 1
		;;
esac
