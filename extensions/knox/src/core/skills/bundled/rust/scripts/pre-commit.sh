#!/usr/bin/env bash
#
# Knox Rust gate — one rustc/cargo quality gate for humans, git hooks and the
# Knox agent (`builtin_build action=gate`).
#
# Runs, per discovered Cargo workspace / crate:
#   toolchain -> hygiene -> fmt -> check -> clippy -> test (+ doc/audit/deny)
#
# Install into a project (Knox: `builtin_build action=gate_init`):
#   cp <knox>/skills/bundled/rust/scripts/pre-commit.sh scripts/pre-commit.sh
#   chmod +x scripts/pre-commit.sh
#
# Install the git hook (you run this; the agent never does):
#   scripts/pre-commit.sh --install-hook
#
# Emergency bypass (hook only):
#   KNOX_SKIP_HOOK=1 git commit ...
#
# Environment:
#   KNOX_HOOK_MODE   hook mode: full (default) | quick | strict
#   KNOX_RUST_DIRS   space-separated crate/workspace dirs (relative to project
#                    root) instead of auto-discovery
#   KNOX_GATE_QUIET  1 = never stream cargo output (print only on failure)
#
# The last line of output is always machine readable:
#   knox-gate: PASS mode=full crates=1 steps=5
#   knox-gate: FAIL mode=full crates=1 failed=clippy
#
# Compatible with bash 3.2 (macOS /bin/bash) — no mapfile, no assoc arrays.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${KNOX_GATE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# Edition 2024 needs rustc 1.85+.
EDITION_2024_MIN="1.85"

MODE="full"
FROM_HOOK=0
KEEP_GOING=0
APPLY_FMT=0
OFFLINE=0
VERBOSE=0
LIST_ONLY=0
EXPLICIT_DIRS=()

CRATES=()
PASSED_STEPS=()
FAILED_STEPS=()
SKIPPED_STEPS=()
HINTS=()
KEEP_GOING_FAILED=0
SUITE_START=0
GIT_ROOT=""
REL_PREFIX=""
COMMON=()
STREAM=0
HOST_TARGET=""

if [[ -t 1 ]]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m'
  YELLOW=$'\033[33m' CYAN=$'\033[36m' RESET=$'\033[0m'
  export CARGO_TERM_COLOR="${CARGO_TERM_COLOR:-always}"
  STREAM=1
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
  export CARGO_TERM_COLOR="${CARGO_TERM_COLOR:-never}"
fi
export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-1}"
export CARGO_TERM_PROGRESS_WHEN="${CARGO_TERM_PROGRESS_WHEN:-auto}"

usage() {
  cat <<'EOF'
Knox Rust gate — fmt / check / clippy / test for every Cargo crate.

Usage:
  scripts/pre-commit.sh [options]

Modes:
  (default)       Full gate: toolchain, hygiene, fmt --check, check,
                  clippy -D warnings, tests (incl. doc tests)
  --quick         Fast loop: hygiene, fmt, check, clippy (no tests)
  --strict        Full gate + extra clippy lints, todo!/unimplemented! fail,
                  cargo doc -D warnings, cargo-audit / cargo-deny if installed
  --fix           Apply `cargo fmt` first, then run the gate

Git:
  --install-hook    Install .git/hooks/pre-commit (runs when staged files
                    touch Rust, Cargo or gate files)
  --uninstall-hook  Remove the hook if this script installed it
  --from-hook       Internal: invoked by the hook (skips when nothing relevant)

Flags:
  --keep-going    Run every step even after a failure; exit non-zero at end
  --offline       Pass --offline to cargo (registry must already be cached)
  --verbose       Always stream cargo output (default when stdout is a tty)
  --dir DIR       Only gate this crate/workspace dir (repeatable)
  --list          Print discovered crates and exit
  -h, --help      Show this help

Environment:
  KNOX_SKIP_HOOK=1       bypass the hook once
  KNOX_HOOK_MODE=quick   hook mode (full | quick | strict); default full
  KNOX_RUST_DIRS="a b"   crate dirs instead of auto-discovery
  KNOX_GATE_QUIET=1      never stream cargo output
EOF
}

log() { printf '%s\n' "$*"; }
info() { log "${CYAN}==>${RESET} $*"; }
ok() { log "${GREEN}OK${RESET}  $*"; }
warn() { log "${YELLOW}WARN${RESET} $*"; }
err() { log "${RED}FAIL${RESET} $*" >&2; }

die() {
  err "$*"
  printf 'knox-gate: FAIL mode=%s error=%s\n' "$MODE" "$*"
  exit 1
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

format_duration() {
  local secs="$1"
  if ((secs < 60)); then
    printf '%ss' "$secs"
  else
    printf '%dm%02ds' "$((secs / 60))" "$((secs % 60))"
  fi
}

join_by() {
  local sep="$1" out="" item
  shift
  for item in "$@"; do
    if [[ -z "$out" ]]; then out="$item"; else out="$out$sep$item"; fi
  done
  printf '%s' "$out"
}

# --- summary ---------------------------------------------------------------

print_summary() {
  local total=$(($(date +%s) - SUITE_START)) hint
  log ""
  log "${BOLD}summary${RESET}  $(format_duration "$total")"
  if ((${#PASSED_STEPS[@]})); then
    log "  ${GREEN}passed${RESET}  $(join_by ' ' "${PASSED_STEPS[@]}")"
  fi
  if ((${#SKIPPED_STEPS[@]})); then
    log "  ${YELLOW}skipped${RESET} $(join_by ', ' "${SKIPPED_STEPS[@]}")"
  fi
  if ((${#HINTS[@]})); then
    for hint in "${HINTS[@]}"; do
      log "  ${YELLOW}hint${RESET}    $hint"
    done
  fi
  if ((${#FAILED_STEPS[@]})); then
    log "  ${RED}failed${RESET}  $(join_by ' ' "${FAILED_STEPS[@]}")"
    log ""
    log "Fix the failed step(s) and re-run: scripts/pre-commit.sh"
    printf 'knox-gate: FAIL mode=%s crates=%s failed=%s\n' \
      "$MODE" "${#CRATES[@]}" "$(join_by ',' "${FAILED_STEPS[@]}")"
    return 1
  fi
  log "${GREEN}${BOLD}Rust gate passed${RESET}"
  printf 'knox-gate: PASS mode=%s crates=%s steps=%s\n' \
    "$MODE" "${#CRATES[@]}" "${#PASSED_STEPS[@]}"
  return 0
}

record_skip() {
  SKIPPED_STEPS+=("$1 ($2)")
  warn "$1 skipped: $2"
}

add_hint() { HINTS+=("$1"); }

# --- step runner -----------------------------------------------------------

# Run a command; stream it (tty / --verbose) or capture and print on failure.
run_cmd() {
  if ((STREAM)); then
    "$@"
    return $?
  fi
  local out rc=0
  out="$(mktemp "${TMPDIR:-/tmp}/knox-gate.XXXXXX")"
  "$@" >"$out" 2>&1 || rc=$?
  if ((rc == 0)); then
    rm -f "$out"
    return 0
  fi
  local lines
  lines="$(wc -l <"$out" | tr -d ' ')"
  if ((lines > 400)); then
    log "... ($((lines - 400)) earlier lines omitted)"
    tail -n 400 "$out"
  else
    cat "$out"
  fi
  rm -f "$out"
  return "$rc"
}

run_step() {
  local name="$1"
  shift
  local start now secs
  start="$(date +%s)"
  info "${BOLD}${name}${RESET}"
  if run_cmd "$@"; then
    now="$(date +%s)"
    secs=$((now - start))
    PASSED_STEPS+=("$name")
    ok "$name $(format_duration "$secs")"
    return 0
  fi
  now="$(date +%s)"
  secs=$((now - start))
  FAILED_STEPS+=("$name")
  err "$name $(format_duration "$secs")"
  if ((KEEP_GOING)); then
    KEEP_GOING_FAILED=1
    return 0
  fi
  print_summary || true
  exit 1
}

crate_label() {
  local rel="${1#"$PROJECT_ROOT"}"
  rel="${rel#/}"
  printf '%s' "${rel:-.}"
}

run_per_crate() {
  local step="$1" fn="$2" dir name
  for dir in "${CRATES[@]}"; do
    name="$step"
    if ((${#CRATES[@]} > 1)); then
      name="$step[$(crate_label "$dir")]"
    fi
    run_step "$name" "$fn" "$dir"
  done
}

cargo_in() {
  local dir="$1"
  shift
  (cd "$dir" && cargo "$@")
}

# --- args ------------------------------------------------------------------

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --quick) MODE="quick" ;;
      --strict) MODE="strict" ;;
      --full) MODE="full" ;;
      --fix) APPLY_FMT=1 ;;
      --from-hook) FROM_HOOK=1 ;;
      --install-hook)
        install_git_hook
        exit 0
        ;;
      --uninstall-hook)
        uninstall_git_hook
        exit 0
        ;;
      --keep-going) KEEP_GOING=1 ;;
      --offline) OFFLINE=1 ;;
      --verbose) VERBOSE=1 ;;
      --list) LIST_ONLY=1 ;;
      --dir)
        shift
        [[ $# -gt 0 ]] || die "--dir needs a value"
        EXPLICIT_DIRS+=("$1")
        ;;
      --dir=*) EXPLICIT_DIRS+=("${1#--dir=}") ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "Unknown option: $1 (see --help)" ;;
    esac
    shift
  done
  if ((VERBOSE)); then STREAM=1; fi
  if [[ "${KNOX_GATE_QUIET:-}" == "1" ]]; then STREAM=0; fi
}

# --- git -------------------------------------------------------------------

init_git() {
  if GIT_ROOT="$(git -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null)"; then
    REL_PREFIX="$(git -C "$PROJECT_ROOT" rev-parse --show-prefix 2>/dev/null || true)"
  else
    GIT_ROOT=""
    REL_PREFIX=""
  fi
}

in_git() { [[ -n "$GIT_ROOT" ]]; }

staged_files() {
  git -C "$PROJECT_ROOT" diff --cached --name-only --diff-filter=ACMR --relative 2>/dev/null || true
}

rust_paths_staged() {
  local staged
  staged="$(staged_files)"
  [[ -n "$staged" ]] || return 1
  grep -qE '(^|/)(Cargo\.(toml|lock)|rust-toolchain(\.toml)?|\.?rustfmt\.toml|\.?clippy\.toml|deny\.toml|build\.rs)$|\.rs$|(^|/)\.cargo/config(\.toml)?$|(^|/)scripts/pre-commit\.sh$' <<<"$staged"
}

install_git_hook() {
  in_git_or_die
  local hook_dir hook rel
  hook_dir="$(git -C "$PROJECT_ROOT" rev-parse --git-path hooks)"
  case "$hook_dir" in
    /*) ;;
    *) hook_dir="$PROJECT_ROOT/$hook_dir" ;;
  esac
  mkdir -p "$hook_dir"
  hook="$hook_dir/pre-commit"
  rel="$REL_PREFIX"

  if [[ -e "$hook" ]] && ! grep -q 'Knox Rust gate' "$hook" 2>/dev/null; then
    die "Existing git hook at $hook was not installed by this script. Move it aside and re-run --install-hook."
  fi

  {
    printf '#!/usr/bin/env bash\n'
    printf '# Generated by scripts/pre-commit.sh --install-hook (Knox Rust gate)\n'
    printf 'set -euo pipefail\n'
    printf 'ROOT="$(git rev-parse --show-toplevel)"\n'
    printf 'exec "$ROOT/%sscripts/pre-commit.sh" --from-hook "$@"\n' "$rel"
  } >"$hook"
  chmod +x "$hook"
  ok "Installed git pre-commit hook: $hook"
  log "Runs when staged files touch Rust / Cargo / gate files. Mode: \$KNOX_HOOK_MODE (default full)."
  log "Bypass once: KNOX_SKIP_HOOK=1 git commit ..."
}

uninstall_git_hook() {
  in_git_or_die
  local hook_dir hook
  hook_dir="$(git -C "$PROJECT_ROOT" rev-parse --git-path hooks)"
  case "$hook_dir" in
    /*) ;;
    *) hook_dir="$PROJECT_ROOT/$hook_dir" ;;
  esac
  hook="$hook_dir/pre-commit"
  if [[ ! -e "$hook" ]]; then
    log "No pre-commit hook at $hook"
    return 0
  fi
  if ! grep -q 'Knox Rust gate' "$hook" 2>/dev/null; then
    die "Hook at $hook was not installed by this script; leaving it alone."
  fi
  rm -f "$hook"
  ok "Removed $hook"
}

in_git_or_die() {
  in_git || die "Not inside a git work tree: $PROJECT_ROOT"
}

maybe_skip_from_hook() {
  ((FROM_HOOK)) || return 0
  if [[ "${KNOX_SKIP_HOOK:-}" == "1" ]]; then
    warn "KNOX_SKIP_HOOK=1 — skipping Rust gate"
    printf 'knox-gate: SKIP reason=KNOX_SKIP_HOOK\n'
    exit 0
  fi
  case "${KNOX_HOOK_MODE:-full}" in
    quick | full | strict) MODE="${KNOX_HOOK_MODE:-full}" ;;
    *) die "KNOX_HOOK_MODE must be quick, full or strict" ;;
  esac
  if in_git && ! rust_paths_staged; then
    info "No staged Rust / Cargo files; skipping Rust gate"
    printf 'knox-gate: SKIP reason=no-staged-rust\n'
    exit 0
  fi
}

# --- crate discovery -------------------------------------------------------

manifest_is_workspace() {
  grep -qE '^[[:space:]]*\[workspace([].]|$)' "$1" 2>/dev/null
}

workspace_excludes() { # manifest rel-path
  tr -d '\n' <"$1" |
    grep -oE 'exclude[[:space:]]*=[[:space:]]*\[[^]]*\]' |
    grep -qF "\"$2\""
}

# True when an ancestor dir (up to PROJECT_ROOT) has a [workspace] manifest.
covered_by_workspace() {
  local dir manifest_dir
  manifest_dir="$(dirname "$1")"
  # A manifest that declares its own [workspace] is always a root.
  if manifest_is_workspace "$1"; then return 1; fi
  dir="$manifest_dir"
  while [[ "$dir" != "$PROJECT_ROOT" && "$dir" != "/" ]]; do
    dir="$(dirname "$dir")"
    if [[ -f "$dir/Cargo.toml" ]] && manifest_is_workspace "$dir/Cargo.toml"; then
      # `exclude = ["path"]` detaches a crate: it is its own root.
      if workspace_excludes "$dir/Cargo.toml" "${manifest_dir#"$dir"/}"; then
        return 1
      fi
      return 0
    fi
    [[ "$dir" == "$PROJECT_ROOT" ]] && break
  done
  return 1
}

discover_crates() {
  CRATES=()
  local dir manifest item
  local -a wanted=()

  if ((${#EXPLICIT_DIRS[@]})); then
    wanted=("${EXPLICIT_DIRS[@]}")
  elif [[ -n "${KNOX_RUST_DIRS:-}" ]]; then
    # shellcheck disable=SC2206
    wanted=(${KNOX_RUST_DIRS})
  fi

  if ((${#wanted[@]})); then
    for item in "${wanted[@]}"; do
      case "$item" in
        /*) dir="$item" ;;
        *) dir="$PROJECT_ROOT/$item" ;;
      esac
      dir="$(cd "$dir" 2>/dev/null && pwd)" || die "Crate dir not found: $item"
      [[ -f "$dir/Cargo.toml" ]] || die "No Cargo.toml in $dir"
      CRATES+=("$dir")
    done
    return 0
  fi

  while IFS= read -r manifest; do
    [[ -n "$manifest" ]] || continue
    if covered_by_workspace "$manifest"; then continue; fi
    CRATES+=("$(dirname "$manifest")")
  done < <(
    find "$PROJECT_ROOT" -maxdepth 4 -name Cargo.toml \
      -not -path '*/target/*' -not -path '*/node_modules/*' \
      -not -path '*/.git/*' -not -path '*/vendor/*' \
      -not -path '*/.cargo/*' 2>/dev/null | sort
  )
}

# --- per-crate facts -------------------------------------------------------

crate_config_files() {
  local dir="$1" f
  for f in "$dir/.cargo/config.toml" "$dir/.cargo/config"; do
    [[ -f "$f" ]] && printf '%s\n' "$f"
  done
  return 0
}

# .cargo/config sets [build] target = "<non-host triple>" (bare metal, wasm...).
crate_custom_target() {
  local f
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    if awk '
      /^\[/ { sec = $0; sub(/[[:space:]]*(#.*)?$/, "", sec) }
      sec == "[build]" && /^[[:space:]]*target[[:space:]]*=/ { found = 1 }
      END { exit !found }
    ' "$f"; then
      return 0
    fi
  done < <(crate_config_files "$1")
  return 1
}

crate_uses_build_std() {
  local f
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    if grep -qE '^[[:space:]]*build-std[[:space:]]*=' "$f"; then return 0; fi
  done < <(crate_config_files "$1")
  return 1
}

cargo_flags_for() {
  COMMON=()
  if [[ -f "$1/Cargo.lock" ]]; then COMMON+=(--locked); fi
  if ((OFFLINE)); then COMMON+=(--offline); fi
}

version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, x, "."); split(b, y, ".")
    for (i = 1; i <= 3; i++) {
      xi = x[i] + 0; yi = y[i] + 0
      if (xi > yi) exit 0
      if (xi < yi) exit 1
    }
    exit 0
  }'
}

toml_value() { # file key -> first quoted value
  sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$1" | head -n 1
}

# --- checks ----------------------------------------------------------------

check_toolchain() {
  local dir="$1" ver edition msrv
  have_cmd rustc || { err "rustc not found. Install https://rustup.rs and retry."; return 1; }
  have_cmd cargo || { err "cargo not found. Install the Rust toolchain and retry."; return 1; }
  (cd "$dir" && cargo fmt --version >/dev/null 2>&1) || {
    err "rustfmt missing. Run: rustup component add rustfmt"
    return 1
  }
  (cd "$dir" && cargo clippy --version >/dev/null 2>&1) || {
    err "clippy missing. Run: rustup component add clippy"
    return 1
  }
  if crate_uses_build_std "$dir"; then
    local sysroot
    sysroot="$(cd "$dir" && rustc --print sysroot)"
    [[ -d "$sysroot/lib/rustlib/src/rust/library/core" ]] || {
      err "rust-src missing (build-std). Run: rustup component add rust-src"
      return 1
    }
  fi

  ver="$(cd "$dir" && rustc --version | awk '{print $2}')"
  ver="${ver%%-*}"
  edition="$(toml_value "$dir/Cargo.toml" edition)"
  if [[ "$edition" == "2024" ]] && ! version_ge "$ver" "$EDITION_2024_MIN"; then
    err "rustc $ver is too old for edition 2024 (need >= $EDITION_2024_MIN)"
    return 1
  fi
  msrv="$(toml_value "$dir/Cargo.toml" rust-version)"
  if [[ -n "$msrv" ]] && ! version_ge "$ver" "$msrv"; then
    err "rustc $ver is older than rust-version $msrv in $(crate_label "$dir")/Cargo.toml"
    return 1
  fi
  if [[ ! -f "$dir/Cargo.lock" ]]; then
    add_hint "$(crate_label "$dir"): no Cargo.lock — run cargo generate-lockfile (commit it for binaries)"
  fi
  return 0
}

filter_code_lines() {
  # Drop grep hits that are inside // comments.
  grep -vE '^[^:]+:[0-9]+:[[:space:]]*//' || true
}

grep_rs() { # pattern dir
  grep -rInE --include='*.rs' \
    --exclude-dir=target --exclude-dir=.git --exclude-dir=node_modules \
    "$1" "$2" 2>/dev/null | filter_code_lines
}

check_hygiene() {
  local dir hits leftovers status=0

  for dir in "${CRATES[@]}"; do
    hits="$(grep -rInE --include='*.rs' --include='*.toml' --include='*.sh' \
      --exclude-dir=target --exclude-dir=.git --exclude-dir=node_modules \
      '^(<<<<<<<[[:space:]]|>>>>>>>[[:space:]]|=======$)' "$dir" 2>/dev/null || true)"
    if [[ -n "$hits" ]]; then
      err "Merge conflict markers:"
      printf '%s\n' "$hits" >&2
      status=1
    fi

    leftovers="$(find "$dir" \( -name '*.rs.bk' -o -name '*.rs~' -o -name '*.orig' -o -name '*.rej' \) \
      -not -path '*/target/*' -not -path '*/.git/*' 2>/dev/null | head -n 20 || true)"
    if [[ -n "$leftovers" ]]; then
      err "Leftover editor / rustfmt / merge backup files:"
      printf '%s\n' "$leftovers" >&2
      status=1
    fi

    hits="$(grep_rs '(^|[^A-Za-z0-9_])dbg![[:space:]]*\(' "$dir")"
    if [[ -n "$hits" ]]; then
      err "Remove dbg!(...) before commit:"
      printf '%s\n' "$hits" >&2
      status=1
    fi

    hits="$(grep_rs '(^|[^A-Za-z0-9_])(todo|unimplemented)![[:space:]]*[(\[{]' "$dir")"
    if [[ -n "$hits" ]]; then
      if [[ "$MODE" == "strict" ]]; then
        err "todo!/unimplemented! is not done work (strict):"
        printf '%s\n' "$hits" >&2
        status=1
      else
        add_hint "$(crate_label "$dir"): todo!/unimplemented! present ($(printf '%s\n' "$hits" | wc -l | tr -d ' ') site(s)) — not done; --strict fails on these"
      fi
    fi

    if in_git; then
      if [[ -n "$(git -C "$dir" ls-files -- target 2>/dev/null | head -n 1)" ]]; then
        err "$(crate_label "$dir"): target/ is tracked by git. Run: git rm -r --cached target"
        status=1
      elif [[ -d "$dir/target" ]] && ! git -C "$dir" check-ignore -q target 2>/dev/null; then
        err "$(crate_label "$dir"): target/ exists but is not git-ignored. Add /target/ to .gitignore"
        status=1
      fi
    fi
  done

  if ((FROM_HOOK)) && in_git; then
    check_staged_lockfiles || status=1
  fi

  hint_unsafe_changes
  return "$status"
}

check_staged_lockfiles() {
  local dir rel status=0 staged
  staged="$(staged_files)"
  for dir in "${CRATES[@]}"; do
    rel="${dir#"$PROJECT_ROOT"}"
    rel="${rel#/}"
    if [[ -n "$rel" ]]; then rel="$rel/"; fi
    if grep -qxF "${rel}Cargo.toml" <<<"$staged" &&
      ! grep -qxF "${rel}Cargo.lock" <<<"$staged" &&
      [[ -f "$dir/Cargo.lock" ]]; then
      if ! git -C "$dir" diff --quiet -- Cargo.lock 2>/dev/null ||
        [[ -n "$(git -C "$dir" ls-files --others --exclude-standard -- Cargo.lock 2>/dev/null)" ]]; then
        err "${rel}Cargo.toml is staged but ${rel}Cargo.lock has unstaged changes"
        status=1
      fi
    fi
  done
  return "$status"
}

hint_unsafe_changes() {
  in_git || return 0
  local diff
  if git -C "$PROJECT_ROOT" rev-parse --verify -q HEAD >/dev/null 2>&1; then
    diff="$(git -C "$PROJECT_ROOT" diff HEAD -U0 -- '*.rs' 2>/dev/null || true)"
  else
    diff="$(git -C "$PROJECT_ROOT" diff --cached -U0 -- '*.rs' 2>/dev/null || true)"
  fi
  if grep -qE '^\+[^+].*(^|[^A-Za-z0-9_])unsafe[[:space:]]*(\{|fn |impl |trait )' <<<"$diff"; then
    add_hint "diff touches unsafe — run: cargo +nightly miri test (rustup +nightly component add miri) and keep // SAFETY: comments"
  fi
  return 0
}

# --- cargo steps -----------------------------------------------------------

step_fmt() {
  local dir="$1"
  if ((APPLY_FMT)); then
    cargo_in "$dir" fmt --all || return 1
  fi
  cargo_in "$dir" fmt --all -- --check
}

step_check() {
  local dir="$1"
  local -a targets=(--all-targets)
  cargo_flags_for "$dir"
  if crate_custom_target "$dir"; then targets=(); fi
  cargo_in "$dir" check --workspace ${targets[@]+"${targets[@]}"} ${COMMON[@]+"${COMMON[@]}"}
}

step_clippy() {
  local dir="$1"
  local -a targets=(--all-targets)
  local -a deny=(-D warnings -D clippy::dbg_macro)
  cargo_flags_for "$dir"
  if crate_custom_target "$dir"; then targets=(); fi
  if [[ "$MODE" == "strict" ]]; then
    deny+=(
      -W clippy::undocumented_unsafe_blocks
      -W clippy::manual_let_else
      -W clippy::cast_possible_truncation
      -W clippy::doc_markdown
      -W clippy::todo
      -W clippy::unimplemented
    )
  fi
  cargo_in "$dir" clippy --workspace ${targets[@]+"${targets[@]}"} \
    ${COMMON[@]+"${COMMON[@]}"} -- "${deny[@]}"
}

step_test() {
  local dir="$1"
  cargo_flags_for "$dir"
  if crate_custom_target "$dir"; then
    # Bare-metal / wasm: compile the harness only. Separate target dir so
    # build-std after clippy does not hit duplicate lang items.
    cargo_in "$dir" test --workspace ${COMMON[@]+"${COMMON[@]}"} \
      --target-dir target/knox-gate-test --no-run --quiet
    return $?
  fi
  if (cd "$dir" && cargo nextest --version >/dev/null 2>&1); then
    cargo_in "$dir" nextest run --workspace ${COMMON[@]+"${COMMON[@]}"} || return 1
    cargo_in "$dir" test --workspace --doc ${COMMON[@]+"${COMMON[@]}"}
    return $?
  fi
  cargo_in "$dir" test --workspace ${COMMON[@]+"${COMMON[@]}"}
}

step_doc() {
  local dir="$1"
  cargo_flags_for "$dir"
  (cd "$dir" && RUSTDOCFLAGS="${RUSTDOCFLAGS:-} -D warnings" \
    cargo doc --workspace --no-deps ${COMMON[@]+"${COMMON[@]}"})
}

run_optional_audit() {
  local dir
  if ! cargo audit --help >/dev/null 2>&1; then
    record_skip "cargo-audit" "install with: cargo install cargo-audit"
    return 0
  fi
  for dir in "${CRATES[@]}"; do
    [[ -f "$dir/Cargo.lock" ]] || { record_skip "cargo-audit[$(crate_label "$dir")]" "no Cargo.lock"; continue; }
    run_step "cargo-audit[$(crate_label "$dir")]" bash -c 'cd "$1" && cargo audit' _ "$dir"
  done
}

run_optional_deny() {
  local dir
  if ! cargo deny --help >/dev/null 2>&1; then
    record_skip "cargo-deny" "install with: cargo install cargo-deny"
    return 0
  fi
  for dir in "${CRATES[@]}"; do
    if [[ ! -f "$dir/deny.toml" && ! -f "$PROJECT_ROOT/deny.toml" ]]; then
      record_skip "cargo-deny[$(crate_label "$dir")]" "no deny.toml"
      continue
    fi
    run_step "cargo-deny[$(crate_label "$dir")]" bash -c 'cd "$1" && cargo deny check' _ "$dir"
  done
}

# --- banner ----------------------------------------------------------------

print_banner() {
  local first="${CRATES[0]}"
  log "${BOLD}Knox Rust gate${RESET}  ${DIM}(${MODE})${RESET}"
  log "root:   $PROJECT_ROOT"
  log "cargo:  $(cd "$first" && cargo --version 2>/dev/null || echo missing)"
  log "rustc:  $(cd "$first" && rustc --version 2>/dev/null || echo missing)"
  log "host:   ${HOST_TARGET:-unknown}"
  local dir
  for dir in "${CRATES[@]}"; do
    local extra=""
    if crate_custom_target "$dir"; then extra=" ${DIM}(custom [build] target: tests compile only)${RESET}"; fi
    log "crate:  $(crate_label "$dir")$extra"
  done
  log ""
}

# --- main ------------------------------------------------------------------

init_git
parse_args "$@"
maybe_skip_from_hook
discover_crates

if ((${#CRATES[@]} == 0)); then
  if ((FROM_HOOK)); then
    info "No Cargo.toml under $PROJECT_ROOT; skipping Rust gate"
    printf 'knox-gate: SKIP reason=no-cargo-toml\n'
    exit 0
  fi
  die "No Cargo.toml found under $PROJECT_ROOT (use --dir DIR or KNOX_RUST_DIRS)"
fi

if ((LIST_ONLY)); then
  for dir in "${CRATES[@]}"; do log "$(crate_label "$dir")"; done
  exit 0
fi

have_cmd cargo || die "cargo not found. Install https://rustup.rs and retry."
HOST_TARGET="$(cd "${CRATES[0]}" && rustc -vV 2>/dev/null | sed -n 's/^host: //p' || true)"
SUITE_START="$(date +%s)"
print_banner

run_per_crate "toolchain" check_toolchain
run_step "hygiene" check_hygiene
run_per_crate "fmt" step_fmt
run_per_crate "check" step_check
run_per_crate "clippy" step_clippy

if [[ "$MODE" != "quick" ]]; then
  run_per_crate "test" step_test
fi

if [[ "$MODE" == "strict" ]]; then
  for dir in "${CRATES[@]}"; do
    if crate_custom_target "$dir"; then
      record_skip "doc[$(crate_label "$dir")]" "custom [build] target"
    else
      run_step "doc[$(crate_label "$dir")]" step_doc "$dir"
    fi
  done
  run_optional_audit
  run_optional_deny
fi

print_summary
if ((KEEP_GOING_FAILED)); then
  exit 1
fi
exit 0
