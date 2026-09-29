---
name: rust
description: Cargo / rustc / clippy loop for Rust crates. Use when fixing rustc E0502 or E04xx borrow/lifetime errors in src/lib.rs, cargo check, clippy, rustc --explain, crate APIs, async tokio.
---

# Rust / Cargo

Inner loop (do not skip):

1. `cargo fmt --check`
2. `builtin_build` → `cargo check --workspace --all-targets` (not `cargo build`)
3. `builtin_build` `action=clippy` → `cargo clippy --workspace --all-targets -- -D warnings`
4. `builtin_build` `action=fmt` → `cargo fmt --check` (do not surprise-write rustfmt)
5. `builtin_build` `action=test` → `cargo test --workspace` (or nextest in the shell if installed), plus `cargo test --doc` for libs
6. `cargo +nightly miri test` only if this edit touched `unsafe`

7. **Before claiming done:** `builtin_build` `action=gate` — the whole gate in one call (toolchain → hygiene → fmt → check → clippy `-D warnings` → test incl. doc tests, for every crate). `mode=quick` skips tests; `mode=strict` adds extra clippy lints, fails on `todo!()`/`unimplemented!()`, runs `cargo doc -D warnings`, and `cargo audit` / `cargo deny` when installed.

Never `cargo clean` / `publish` / `login` unless the user explicitly asked. Prefer `builtin_build` over shell cargo.

## Gate script (`scripts/pre-commit.sh`)

`action=gate` runs the project's `scripts/pre-commit.sh` when it exists, else an inline cargo chain. If the project has none, `builtin_build action=gate_init` installs the bundled one (auto-discovers Cargo workspaces / standalone crates, honours `[workspace] exclude`, compiles-only for crates with a non-host `[build] target` such as bare-metal kernels, uses `cargo nextest` when present, keeps `--locked` when `Cargo.lock` exists). The last output line is machine readable: `knox-gate: PASS|FAIL|SKIP mode=… failed=step,…`.

- Human / CI: `scripts/pre-commit.sh [--quick|--strict|--fix|--keep-going|--offline|--dir DIR|--list]`.
- Git hook: only the **user** runs `scripts/pre-commit.sh --install-hook` (`KNOX_HOOK_MODE=quick` for a faster hook, `KNOX_SKIP_HOOK=1` to bypass once). Never install or remove hooks yourself.
- Hygiene it enforces before compiling: merge markers, `*.rs.bk`/`.orig` leftovers, `dbg!`, tracked or un-ignored `target/`, staged `Cargo.toml` without its `Cargo.lock`. It hints (does not run) miri when the diff touches `unsafe`.
- On FAIL fix the first failing step and re-run; do not edit tests to pass, and do not weaken lints with `#[allow]` to turn the gate green.

## Truth

- Read `Cargo.toml` + `Cargo.lock` versions before using a crate API. Do not invent `rand` / `axum` / tokio methods. Card injects pinned versions; missing lock → `cargo generate-lockfile`.
- rust-analyzer hover / go-to-definition before writing a method call (hover includes types). If RA is missing, `builtin_build` and read `~/.cargo/registry/src` or `vendor/`. Writes under `~/.cargo/registry` are denied.
- `builtin_build` `action=doc` / `doc: crate::symbol` reads rustdoc JSON when present; otherwise points at the locked registry/vendor source. Do not scrape docs.rs.
- On the first sight of `error[E0xxx]`, call `builtin_build` with `explain: E0xxx` (`rustc --explain`). E0117/E0119 → newtype, not impl-header thrash.

## Ownership (E04xx / E05xx / E06xx)

Restate the ownership graph in prose. Remedy menu only: split borrows, index-based access, `std::mem::take`, pass `&mut` down, restructure, arena/`slotmap`. Not “sprinkle `.clone()`” / `Arc<Mutex<_>>` / `RefCell` without a `// share:` or `// owned:` justification.

After 2 failed compile attempts, stop mutating types and reconsider design.

## Policy

- New crate: `edition = "2024"`, `rust-version = "1.98.1"`, and `rust-toolchain.toml` channel `1.98.1`. Never write `edition = "2021"` on a new `Cargo.toml`. Existing crates: MSRV / edition from `rust-toolchain.toml` or `package.edition` — never newer syntax.
- `#![forbid(unsafe_code)]` unless the task authorizes unsafe. Every `unsafe` block needs `// SAFETY:`.
- No new dependency without justification (`cargo tree -i`).
- Zero clippy warnings at `-D warnings`. No `#[allow]` without an inline reason.
- Failing test first. Do not edit tests to pass. `todo!()` / `unimplemented!()` is not done.
- No performance claims without criterion numbers.
- Compiler-green ≠ correct. Mention proptest/fuzz when logic is the risk; do not fake a fuzzer tool.

## Roles

Spawn `rust-borrowck` after 1 failed borrowck attempt; `rust-review` before claiming done; `rust-architect` for new public APIs. Do not nest `task`. When changing `pub` items, rust-review must consider semver (`cargo public-api` / `cargo semver-checks` if installed). Never `cargo publish`.

## Outer gates + optional tools

- After check is green, post-edit also runs `cargo fmt --check` then clippy `-D warnings`. Tests: `action=test` (add `--doc` / `docTests: true` on libs). The full pre-done sweep is `action=gate`.
- New dependency: justify + `builtin_build action=tree` (`cargo tree -i <crate>`). `action=deny` / `action=audit` only if those binaries exist — do not block the inner loop on a network audit.
- `action=fix` is `cargo fix --allow-dirty` for mechanical rustc suggestions. Never `--broken-code`.
- `action=expand` if `cargo-expand` is installed; otherwise the tool says to install it.
- Sanitizers are **manual** (Linux/nightly): `RUSTFLAGS="-Zsanitizer=address"` — do not default this on macOS VS Code.
- Speed: keep a warm `target/`, `CARGO_TERM_COLOR=always`. Suggest user-installed sccache / mold / lld. Do not download toolchains unprompted. Prefer Knox checkpoints / git worktrees for parallel attempts (`target/` is checkpoint-ignored).
