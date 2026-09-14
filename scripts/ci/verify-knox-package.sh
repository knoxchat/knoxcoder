#!/usr/bin/env bash
# Verify a packaged Knox system extension (T9.1).
# Usage:
#   verify-knox-package.sh <path-to-extensions/knox>
#   verify-knox-package.sh <packaged-app-root>   # Linux/Windows: resources/app/extensions/knox
#   verify-knox-package.sh <KnoxCoder.app>       # macOS: Contents/Resources/app/extensions/knox
set -euo pipefail

if [ "${1:-}" = "" ]; then
	echo "usage: $0 <extensions/knox | packaged-app-root | KnoxCoder.app>" >&2
	exit 2
fi

resolve_knox_dir() {
	local input="$1"
	local candidates=(
		"$input"
		"$input/resources/app/extensions/knox"
		"$input/Contents/Resources/app/extensions/knox"
	)
	local c
	for c in "${candidates[@]}"; do
		if [ -f "$c/package.json" ]; then
			echo "$c"
			return
		fi
	done
	echo "Knox package check failed: no package.json under $input (tried resources/app and Contents/Resources/app)" >&2
	exit 1
}

fail() {
	echo "Knox package check failed: $*" >&2
	exit 1
}

KNOX_DIR="$(cd "$(resolve_knox_dir "$1")" && pwd)"
PKG="$KNOX_DIR/package.json"

KNOX_PKG="$PKG" node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.env.KNOX_PKG, "utf8"));
const problems = [];
if (p.name !== "knox") problems.push("name=" + p.name);
if (p.publisher !== "vscode") problems.push("publisher=" + p.publisher);
if (!p.main) problems.push("missing main");
if (p.browser) problems.push("unexpected browser field (Knox is not a web extension)");
if (problems.length) {
	console.error(problems.join("; "));
	process.exit(1);
}
' || fail "package.json identity (expected vscode.knox, main, no browser)"

[ -f "$KNOX_DIR/dist/src/extension.js" ] || fail "dist/src/extension.js missing"
if [ -f "$KNOX_DIR/gui/assets/index.js" ] || [ -f "$KNOX_DIR/gui/assets/index.css" ]; then
	fail "gui/assets must not be packaged after the native sidebar cutover"
fi

SQLITE="$(
	KNOX_DIR="$KNOX_DIR" node -e '
const fs = require("fs");
const path = require("path");
function walk(dir) {
	for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, name.name);
		if (name.isDirectory()) {
			const found = walk(p);
			if (found) return found;
		} else if (name.name === "node_sqlite3.node") {
			return p;
		}
	}
}
const found = walk(process.env.KNOX_DIR);
if (!found) process.exit(2);
process.stdout.write(found);
'
)" || fail "node_sqlite3.node missing (platform sqlite)"

[ -f "$KNOX_DIR/node_modules/jsdom/lib/api.js" ] || fail "jsdom/lib/api.js missing (esbuild external)"
KNOX_DIR="$KNOX_DIR" node -e '
const { createRequire } = require("module");
const path = require("path");
const jsdomApi = path.join(process.env.KNOX_DIR, "node_modules/jsdom/lib/api.js");
const req = createRequire(jsdomApi);
for (const id of ["tough-cookie", "saxes", "parse5", "whatwg-url"]) {
	try {
		req.resolve(id);
	} catch {
		console.error("jsdom cannot resolve " + id);
		process.exit(2);
	}
}
' || fail "jsdom production tree incomplete (tough-cookie and other jsdom requires)"

echo "Knox native package OK: $KNOX_DIR"
echo "  host:  dist/src/extension.js"
echo "  sqlite: $SQLITE"
echo "  jsdom:  node_modules/jsdom + production deps"
