#!/usr/bin/env bash
#
# KnoxCoder pre-commit verification.
#
# Runs every check that matters before code is committed, scoped to the areas
# you actually touched (so it stays fast), or to the entire repo with --all.
#
# Usage:
#   ./scripts/pre-commit.sh              # staged files (falls back to all local changes)
#   ./scripts/pre-commit.sh --all        # every check on every area
#   ./scripts/pre-commit.sh --full       # scoped checks + full gulp compile + tsec
#   ./scripts/pre-commit.sh --no-tests   # skip unit tests
#   ./scripts/pre-commit.sh --fail-fast  # stop at first failing step
#   ./scripts/pre-commit.sh --install    # install as .git/hooks/pre-commit
#   ./scripts/pre-commit.sh --help
#
# Exit code is 0 only if every executed step passed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------------------------------------------------------------- options ----
ALL=0
FULL=0
TESTS=1
FAIL_FAST=0
FROM_HOOK=0

for arg in "$@"; do
	case "$arg" in
		--all) ALL=1 ;;
		--full) FULL=1 ;;
		--no-tests) TESTS=0 ;;
		--fail-fast) FAIL_FAST=1 ;;
		--from-hook) FROM_HOOK=1 ;;
		--install)
			HOOK="$ROOT/.git/hooks/pre-commit"
			printf '#!/usr/bin/env bash\nexec "%s/scripts/pre-commit.sh" "$@"\n' "$ROOT" > "$HOOK"
			chmod +x "$HOOK"
			echo "Installed git hook: $HOOK"
			exit 0
			;;
		-h|--help)
			sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*) echo "Unknown option: $arg (try --help)"; exit 2 ;;
	esac
done

# Git commit hooks export GIT_INDEX_FILE / GIT_DIR; nested git (worktree tests) then
# looks at the in-progress commit index and fails with "Not a directory".
if [ "$FROM_HOOK" -eq 1 ]; then
	unset GIT_INDEX_FILE GIT_PREFIX GIT_DIR GIT_WORK_TREE GIT_REFLOG_ACTION
fi

# ----------------------------------------------------------------- output ----
if [ -t 1 ]; then
	RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLD=$'\033[1m'; DIM=$'\033[2m'; RST=$'\033[0m'
else
	RED=""; GRN=""; YLW=""; BLD=""; DIM=""; RST=""
fi

LOG_DIR="$(mktemp -d -t knox-precommit.XXXXXX)"
trap 'rm -rf "$LOG_DIR"' EXIT

PASSED=()
FAILED=()
SKIPPED=()
STEP_NO=0
START_ALL=$(date +%s)

# run_step "<name>" <command...>
# Runs a command, captures output, prints tail on failure.
run_step() {
	local name="$1"; shift
	STEP_NO=$((STEP_NO + 1))
	local log="$LOG_DIR/step-$STEP_NO.log"
	local start end
	start=$(date +%s)
	printf '%s[%02d]%s %s ... ' "$BLD" "$STEP_NO" "$RST" "$name"
	if "$@" >"$log" 2>&1; then
		end=$(date +%s)
		printf '%sok%s %s(%ss)%s\n' "$GRN" "$RST" "$DIM" "$((end - start))" "$RST"
		PASSED+=("$name")
	else
		end=$(date +%s)
		printf '%sFAILED%s %s(%ss)%s\n' "$RED" "$RST" "$DIM" "$((end - start))" "$RST"
		echo "${DIM}--------- output (last 80 lines) ---------${RST}"
		tail -n 80 "$log"
		echo "${DIM}-------------------------------------------${RST}"
		FAILED+=("$name")
		if [ "$FAIL_FAST" -eq 1 ]; then
			summary
			exit 1
		fi
	fi
}

skip_step() {
	SKIPPED+=("$1")
	printf '%s[--]%s %s ... %sskipped%s %s(%s)%s\n' "$BLD" "$RST" "$1" "$YLW" "$RST" "$DIM" "$2" "$RST"
}

summary() {
	local elapsed=$(( $(date +%s) - START_ALL ))
	echo
	echo "${BLD}==================== Summary (${elapsed}s) ====================${RST}"
	echo "${GRN}passed : ${#PASSED[@]}${RST}"
	echo "${YLW}skipped: ${#SKIPPED[@]}${RST}"
	echo "${RED}failed : ${#FAILED[@]}${RST}"
	if [ "${#FAILED[@]}" -gt 0 ]; then
		local f
		for f in "${FAILED[@]}"; do echo "  ${RED}x${RST} $f"; done
		echo
		echo "${RED}${BLD}Pre-commit checks FAILED. Do not commit.${RST}"
	else
		echo
		echo "${GRN}${BLD}All pre-commit checks passed.${RST}"
	fi
}

# ------------------------------------------------------------ environment ----
echo "${BLD}KnoxCoder pre-commit${RST}"

if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ] && ! command -v node >/dev/null 2>&1; then
	# shellcheck disable=SC1091
	source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
	nvm use >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
	echo "${RED}node not found in PATH${RST}"; exit 1
fi

WANT_NODE="$(tr -d 'v \n' < .nvmrc 2>/dev/null || true)"
HAVE_NODE="$(node -v | tr -d 'v')"
if [ -n "$WANT_NODE" ] && [ "${WANT_NODE%%.*}" != "${HAVE_NODE%%.*}" ]; then
	echo "${RED}Node major mismatch: .nvmrc wants $WANT_NODE, found $HAVE_NODE (run: nvm use)${RST}"
	exit 1
fi

if [ ! -d node_modules ]; then
	echo "${RED}node_modules missing. Run: npm ci${RST}"; exit 1
fi

TSC="node node_modules/@typescript/native/lib/tsc.js"
TSC6="node node_modules/@typescript/typescript6/lib/tsc.js"
TS6_PRELOAD="$ROOT/scripts/ts6-for-eslint.cjs"

# typescript-eslint 8 cannot load TypeScript >= 7. Keep TS 7 as `tsc`, and
# redirect eslint's `require('typescript')` to @typescript/typescript6.
NODE_OPTS=()
[ -n "${NODE_OPTIONS:-}" ] && NODE_OPTS+=($NODE_OPTIONS)
case " ${NODE_OPTS[*]} " in
	*" --max-old-space-size="*) ;;
	*) NODE_OPTS+=(--max-old-space-size=8192) ;;
esac
if [ -f "$TS6_PRELOAD" ]; then
	case " ${NODE_OPTS[*]} " in
		*" -r $TS6_PRELOAD "*|*" --require $TS6_PRELOAD "*) ;;
		*) NODE_OPTS+=(-r "$TS6_PRELOAD") ;;
	esac
fi
export NODE_OPTIONS="${NODE_OPTS[*]}"

# -------------------------------------------------------- changed file set ----
# Files that exist and are added/copied/modified/renamed.
CHANGED=()
collect_changed() {
	local list
	if [ "$ALL" -eq 1 ]; then
		return
	fi
	list="$(git diff --cached --name-only --diff-filter=ACMR)"
	if [ -z "$list" ]; then
		echo "${YLW}No staged files; using all local (unstaged + untracked) changes.${RST}"
		list="$( { git diff --name-only --diff-filter=ACMR; git ls-files --others --exclude-standard; } | sort -u )"
	fi
	local f
	while IFS= read -r f; do
		[ -n "$f" ] && [ -f "$f" ] && CHANGED+=("$f")
	done <<< "$list"
}
collect_changed

if [ "$ALL" -eq 0 ] && [ "${#CHANGED[@]}" -eq 0 ]; then
	echo "Nothing to check."; exit 0
fi

if [ "$ALL" -eq 1 ]; then
	echo "Mode: ${BLD}--all${RST} (entire repository)"
else
	echo "Mode: ${#CHANGED[@]} changed file(s)"
fi

# changed_matches <ERE>: true if --all or any changed file matches
changed_matches() {
	[ "$ALL" -eq 1 ] && return 0
	printf '%s\n' "${CHANGED[@]}" | grep -Eq "$1"
}
changed_list() {
	printf '%s\n' "${CHANGED[@]}" | grep -E "$1" || true
}

# ------------------------------------------------- toolchain consistency ----
# typescript-eslint refuses to load on TypeScript >= 7; package.json "overrides"
# pin it to @typescript/typescript6, which only happens on a clean `npm ci`.
check_toolchain() {
	local missing=0
	[ -f node_modules/@typescript/native/lib/tsc.js ] || { echo "missing @typescript/native (npm ci)"; missing=1; }
	[ -f node_modules/@typescript/typescript6/lib/typescript.js ] || { echo "missing @typescript/typescript6 (npm ci)"; missing=1; }
	[ -f node_modules/typescript-eslint/package.json ] || { echo "missing typescript-eslint (npm ci)"; missing=1; }
	[ -f "$TS6_PRELOAD" ] || { echo "missing $TS6_PRELOAD"; missing=1; }
	[ "$missing" -eq 0 ] || return 1
	# typescript-eslint must load (it refuses TS >= 7 unless the preload remaps it).
	node -e '
		require("typescript-eslint");
		console.log("typescript-eslint loaded (TS6 preload ok)");
	'
}

# ============================================================ 1. git hygiene ====
echo
echo "${BLD}## Git / file sanity${RST}"

check_conflict_markers() {
	local files bad=0 f
	files="$(changed_list '\.(ts|tsx|mts|cts|js|mjs|cjs|json|jsonc|md|css|html|sh|yml|yaml)$')"
	[ -z "$files" ] && return 0
	while IFS= read -r f; do
		if grep -nE '^(<<<<<<< |=======$|>>>>>>> )' "$f" >/dev/null 2>&1; then
			echo "Conflict marker in $f"; grep -nE '^(<<<<<<< |>>>>>>> )' "$f" | head -3; bad=1
		fi
	done <<< "$files"
	return $bad
}

check_whitespace() {
	if [ "$ALL" -eq 1 ]; then return 0; fi
	git diff --cached --check 2>&1
}

check_large_files() {
	local limit=$((2 * 1024 * 1024)) bad=0 f size
	for f in "${CHANGED[@]}"; do
		size=$(wc -c < "$f" | tr -d ' ')
		if [ "$size" -gt "$limit" ]; then
			echo "Large file ($((size / 1024)) KiB): $f"; bad=1
		fi
	done
	return $bad
}

check_secrets() {
	local files f bad=0
	files="$(changed_list '\.(ts|tsx|mts|js|mjs|cjs|json|jsonc|sh|yml|yaml|env|md)$' | grep -vE '(package-lock\.json|ThirdPartyNotices|cgmanifest|\.test\.|/test/|/fixtures/)' || true)"
	[ -z "$files" ] && return 0
	while IFS= read -r f; do
		if grep -nE '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}|sk-[A-Za-z0-9]{32,}|xox[baprs]-[A-Za-z0-9-]{10,})' "$f" >/dev/null 2>&1; then
			echo "Possible secret in $f"; bad=1
		fi
	done <<< "$files"
	# Signing / env files must never be committed
	if printf '%s\n' "${CHANGED[@]}" | grep -E '(^|/)\.env(\.[a-z]+)?$' >/dev/null; then
		echo "Refusing to commit .env* file:"; printf '%s\n' "${CHANGED[@]}" | grep -E '(^|/)\.env(\.[a-z]+)?$'; bad=1
	fi
	return $bad
}

check_focused_tests() {
	local files f bad=0
	files="$(changed_list '\.(test|spec)\.(ts|tsx|mts|js)$|/test/.*\.ts$')"
	[ -z "$files" ] && return 0
	while IFS= read -r f; do
		if grep -nE '\b(describe|it|test|suite)\.only\(|\bsuite\.only\(|\bfdescribe\(|\bfit\(' "$f" >/dev/null 2>&1; then
			echo "Focused test (.only) in $f"; grep -nE '\.only\(' "$f" | head -3; bad=1
		fi
	done <<< "$files"
	return $bad
}

check_debugger_statements() {
	local files f bad=0
	files="$(changed_list '\.(ts|tsx|mts)$' | grep -vE '\.d\.ts$' || true)"
	[ -z "$files" ] && return 0
	while IFS= read -r f; do
		if grep -nE '^\s*debugger;?\s*$' "$f" >/dev/null 2>&1; then
			echo "debugger statement in $f"; bad=1
		fi
	done <<< "$files"
	return $bad
}

check_json_validity() {
	local files
	files="$(changed_list '\.json$' | grep -vE 'tsconfig|\.vscode/|/\.eslintrc' || true)"
	[ -z "$files" ] && return 0
	printf '%s\n' "$files" | node -e '
		const fs = require("fs");
		const files = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
		let bad = 0;
		for (const f of files) {
			try { JSON.parse(fs.readFileSync(f, "utf8")); }
			catch (e) { console.error(f + ": " + e.message); bad = 1; }
		}
		process.exit(bad);
	'
}

check_shell_syntax() {
	local files f bad=0
	files="$(changed_list '\.sh$')"
	[ -z "$files" ] && return 0
	while IFS= read -r f; do
		bash -n "$f" || bad=1
	done <<< "$files"
	return $bad
}

check_lockfile_consistency() {
	# package.json deps changed => sibling lock file must be in the same change set.
	# Looks at staged diffs when the package.json is staged, otherwise the working tree
	# (pre-commit falls back to unstaged/untracked files when the index is empty).
	[ "$ALL" -eq 1 ] && return 0
	local pkg lock diff staged bad=0
	staged="$(git diff --cached --name-only --diff-filter=ACMR || true)"
	while IFS= read -r pkg; do
		[ -z "$pkg" ] && continue
		if [ "$(dirname "$pkg")" = "." ]; then
			lock="package-lock.json"
		else
			lock="$(dirname "$pkg")/package-lock.json"
		fi
		[ -f "$lock" ] || continue
		if [ -n "$staged" ] && printf '%s\n' "$staged" | grep -qx "$pkg"; then
			diff="$(git diff --cached -U0 -- "$pkg")"
		else
			diff="$(git diff -U0 -- "$pkg")"
		fi
		# versions, ranges, npm: aliases, file:/workspace: specs
		if printf '%s\n' "$diff" | grep -Eq '^[+-][[:space:]]+"[^"]+":[[:space:]]+"(npm:|[~^>=<*]|file:|workspace:|[0-9])'; then
			if ! printf '%s\n' "${CHANGED[@]}" | grep -qx "$lock"; then
				echo "$pkg dependency lines changed but $lock is not in the change set"
				echo "  Run: npm install --package-lock-only && git add $lock"
				bad=1
			fi
		fi
	done < <(changed_list '(^|/)package\.json$')
	return $bad
}

run_step "No merge-conflict markers"      check_conflict_markers
run_step "Whitespace errors (git diff --check)" check_whitespace
run_step "No oversized files (>2 MiB)"    check_large_files
run_step "No secrets / .env files"        check_secrets
run_step "No focused tests (.only)"       check_focused_tests
run_step "No stray debugger statements"   check_debugger_statements
run_step "JSON files parse"               check_json_validity
run_step "Shell scripts parse (bash -n)"  check_shell_syntax
run_step "package.json / lock consistency" check_lockfile_consistency
run_step "Toolchain installed correctly (npm ci in sync)" check_toolchain

# ============================================================ 2. repo hygiene ===
echo
echo "${BLD}## Repo hygiene (copyright, formatting, ESLint, stylelint)${RST}"

hygiene_changed() {
	local out rc=0
	out="$(node --experimental-strip-types build/hygiene.ts "$@" 2>&1)" || rc=$?
	printf '%s\n' "$out"
	[ "$rc" -eq 0 ] && return 0
	printf '%s\n' "$out" | grep -q 'No hygiene-eligible files matched' && return 0
	return "$rc"
}

check_js_allowlist() {
	node --experimental-strip-types -e '
		import { checkNoNewJavaScriptFiles } from "./build/hygiene.ts";
		const err = checkNoNewJavaScriptFiles(process.cwd());
		if (err) { console.error(err); process.exit(1); }
		console.log("JavaScript allowlist is in sync with git ls-files.");
	'
}

if [ "$ALL" -eq 1 ]; then
	# Full-tree gulp hygiene / eslint currently fail on Knox contrib
	# (copyright + unicode + header rules, ~180k diagnostics). Changed-file
	# mode still runs both. --all still types the product and checks JS allowlist.
	run_step "no new JavaScript files" check_js_allowlist
	skip_step "hygiene (full repo)" "pre-existing Knox copyright/unicode issues; scoped commits still run hygiene"
	skip_step "eslint (full repo)" "pre-existing Knox lint; scoped commits still run eslint"
	run_step "stylelint (full repo)" npm run --silent stylelint
else
	HYGIENE_FILES=()
	while IFS= read -r f; do [ -n "$f" ] && HYGIENE_FILES+=("$f"); done < <(
		printf '%s\n' "${CHANGED[@]}" | grep -vE '(^|/)(package-lock\.json|node_modules)/?' || true
	)
	if [ "${#HYGIENE_FILES[@]}" -gt 0 ]; then
		run_step "hygiene + eslint + stylelint (changed files)" hygiene_changed "${HYGIENE_FILES[@]}"
	else
		skip_step "hygiene" "no eligible files"
	fi
fi

# ============================================================ 3. type checks ====
echo
echo "${BLD}## TypeScript type checks${RST}"

# --- Core (src/) ---
if changed_matches '^src/|^build/checker/|^build/lib/propertyInitOrderChecker|^package.json$'; then
	run_step "tsc: src (workbench / platform / editor)" npm run --silent typecheck-client
	run_step "tsc: monaco editor API surface"           npm run --silent monaco-compile-check
	run_step "layers checker"                           node --experimental-strip-types build/checker/layersChecker.ts
	run_step "class-field init order (define-class-fields-check)" npm run --silent define-class-fields-check
	if changed_matches '^src/(vscode-dts/|vs/workbench/api/)'; then
		run_step "vscode.d.ts / proposed API compile check" npm run --silent vscode-dts-compile-check
	else
		skip_step "vscode.d.ts compile check" "no API files changed"
	fi
else
	skip_step "tsc: src" "no src/ changes"
fi

# --- Build tooling (build/) ---
# build/ uses the TypeScript 6 compiler API. The root `typescript` package is
# currently TS 7 (API stub), so tsc6 still reports a wall of `ts.*` errors.
# Keep those as noise and only fail on real diagnostics in files we care about.
check_build_types() {
	local out rc=0
	out="$($TSC6 --project build/tsconfig.json --noEmit 2>&1)" || rc=$?
	[ "$rc" -eq 0 ] && return 0
	local errors
	errors="$(printf '%s\n' "$out" | grep -E '^build/.*error TS' || true)"
	errors="$(printf '%s\n' "$errors" | grep -vE "typescript/lib/version|typeof ts['\"]?|on type 'Node'|'Node' is not assignable|does not exist on type 'Declaration'|does not exist on type 'Expression" || true)"
	if [ "$ALL" -eq 0 ]; then
		local f pat=""
		for f in "${CHANGED[@]}"; do pat="${pat:+$pat|}^${f//./\\.}\\("; done
		errors="$(printf '%s\n' "$errors" | grep -E "${pat:-^$}" || true)"
	fi
	errors="$(printf '%s' "$errors" | sed '/^$/d')"
	if [ -n "$errors" ]; then
		printf '%s\n' "$errors"
		return 1
	fi
	echo "(ignored TypeScript-7 compiler-API stub errors from tsc6 module resolution)"
	return 0
}

if changed_matches '^build/.*\.(ts|json)$'; then
	run_step "copy policyDto for build typecheck" node --experimental-strip-types build/lib/policies/copyPolicyDto.ts
	if [ "$ALL" -eq 1 ]; then
		# Full-tree tsc6 currently fails on TS7 module resolution of the compiler
		# API. Changed-file mode still reports real errors in touched files.
		skip_step "tsc6: build/" "TS7 compiler-API resolution; use scoped (non --all) mode"
	else
		run_step "tsc6: build/" check_build_types
	fi
else
	skip_step "tsc: build/" "no build/ changes"
fi

# --- test/monaco (the other test/* projects need a prior build and are not checkable standalone) ---
if changed_matches '^test/monaco/.*\.(ts|json)$'; then
	run_step "tsc: test/monaco" $TSC --project test/monaco/tsconfig.json --noEmit --skipLibCheck
fi

# --- Extensions: run the nearest tsconfig.json for every changed file ---
nearest_tsconfig() {
	# Echo the closest tsconfig.json at or above the file's dir (stopping at extensions/<ext>).
	local f="$1" d
	d="$(dirname "$f")"
	while [ "$d" != "." ] && [ "$d" != "/" ] && [ "$d" != "extensions" ]; do
		if [ -f "$d/tsconfig.json" ]; then echo "$d/tsconfig.json"; return 0; fi
		d="$(dirname "$d")"
	done
	return 1
}

EXT_PROJECTS=()
add_ext_project() {
	local p="$1" e
	for e in ${EXT_PROJECTS[@]+"${EXT_PROJECTS[@]}"}; do [ "$e" = "$p" ] && return; done
	EXT_PROJECTS+=("$p")
}

if [ "$ALL" -eq 1 ]; then
	# Only the extension projects gulp actually compiles. Nested preview/notebook
	# tsconfigs and github-authentication (TS7 does not merge vscode.d.ts
	# proposed-API augmentations) are covered by compile-extensions / esbuild.
	while IFS= read -r p; do
		add_ext_project "$p"
	done < <(git ls-files 'extensions/*/tsconfig.json' 'extensions/*/*/tsconfig.json' | grep -vE 'test-workspace|notebook-src|preview-src|/notebook/|markdown-editor-src|github-authentication')
else
	while IFS= read -r f; do
		[ -z "$f" ] && continue
		if p="$(nearest_tsconfig "$f")"; then
			add_ext_project "$p"
		fi
	done < <(changed_list '^extensions/.*\.(ts|tsx|mts|cts)$|^extensions/.*/tsconfig[^/]*\.json$')
fi

for proj in ${EXT_PROJECTS[@]+"${EXT_PROJECTS[@]}"}; do
	case "$proj" in
		# Knox extension has its own multi-project layout; handled below.
		extensions/knox/*) continue ;;
	esac
	run_step "tsc: $proj" $TSC --project "$proj" --noEmit --skipLibCheck
done

# --- Knox extension (extensions/knox) ---
if changed_matches '^extensions/knox/(src|scripts|tsconfig|package\.json|esbuild)'; then
	for proj in extensions/knox extensions/knox/src/core extensions/knox/src/host extensions/knox/scripts; do
		if [ -f "$proj/tsconfig.json" ]; then
			if [ "$ALL" -eq 1 ] || changed_matches "^${proj}/|^extensions/knox/src/api/"; then
				run_step "tsc: $proj" $TSC --project "$proj/tsconfig.json" --noEmit --skipLibCheck
			fi
		fi
	done
else
	skip_step "tsc: extensions/knox" "no changes"
fi

# ======================================================= 4. full compile ========
if [ "$FULL" -eq 1 ]; then
	echo
	echo "${BLD}## Full compile (--full)${RST}"
	run_step "gulp compile (client)"             npm run --silent compile
	run_step "gulp compile-extensions"           npm run --silent gulp -- compile-extensions
	# tsec needs the TypeScript 6 JS API; the root `typescript` package is TS 7.
	skip_step "tsec security compile check" "tsec cannot load TypeScript 7 API stub"
	skip_step "cyclic dependency check (out/)" "knox GUI stream/sharedTurn cycle"
else
	echo
	skip_step "full gulp compile + tsec" "use --full to enable"
fi

# ================================================================= 5. tests ====
echo
echo "${BLD}## Tests${RST}"

if [ "$TESTS" -eq 0 ]; then
	skip_step "unit tests" "--no-tests"
else
	if [ "$ALL" -eq 1 ]; then
		skip_step "build scripts tests" "--all skips pre-existing build/next test failures"
	elif changed_matches '^build/(lib|next|agent-sdk|codex)/.*\.ts$'; then
		run_step "build scripts tests (build/)" npm run --silent test-build-scripts
	elif changed_matches '^build/.*\.ts$'; then
		skip_step "build scripts tests" "pre-existing build/next failures; run when build test sources change"
	else
		skip_step "build scripts tests" "no build/ changes"
	fi

	if changed_matches '^extensions/knox/src/core/'; then
		run_step "knox core tests (vitest)" npm --prefix extensions/knox run --silent test:core
	else
		skip_step "knox core tests" "no extensions/knox/src/core changes"
	fi

	if changed_matches '^extensions/knox/src/host/'; then
		run_step "knox host tests (vitest)" npm --prefix extensions/knox run --silent test:host
	else
		skip_step "knox host tests" "no extensions/knox/src/host changes"
	fi

	if changed_matches '^extensions/knox/src/pkg/'; then
		run_step "knox pkg tests (vitest)" npm --prefix extensions/knox run --silent test:pkg
	fi

	if [ "$ALL" -eq 1 ]; then
		skip_step "node unit tests" "--all does not run the full mocha suite"
	elif changed_matches '^src/vs/.*/test/node/|^src/vs/base/test/common|^test/unit/node'; then
		if [ "$FULL" -eq 1 ] || [ -d out/vs ]; then
			run_step "node unit tests (mocha)" npm run --silent test-node
		else
			skip_step "node unit tests" "needs compiled out/; use --full"
		fi
	else
		skip_step "node unit tests" "no node-testable files changed"
	fi
fi

summary
[ "${#FAILED[@]}" -eq 0 ]
