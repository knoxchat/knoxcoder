# Agent eval suite

Golden tasks for Knox Agent. The model is **scripted** (predetermined tool calls). File edits, policy, and abort go through real `callTool` + middleware — the same path as GUI Agent chat.

No live LLM in CI (`cd core && npm test`). Optional live walkthrough: [Live eval (manual)](#live-eval-manual-not-ci).

## Run

```bash
cd core
npm test                 # full core suite, including eval/
npx vitest run eval      # this folder only
```

## Golden tasks

| Task | What it proves |
|------|----------------|
| edit-by-strreplace | `builtin_edit_file` unique replace lands |
| multi-file refactor | `builtin_apply_patch` updates two files atomically |
| test-fix loop | fail → StrReplace → pass (terminal is intercepted; no spawn) |
| permission denial | `~/.ssh` write and `rm -rf /` throw `PERMISSION_DENIED`; workspace unchanged |
| maxSteps stop | After the cap, further tool calls are not executed |
| abort mid-tool | Cancel during `writeFile` → `CANCELLED`; file unchanged |
| git blame | Eval `subprocess` hook returns blame for `builtin_git_blame` (HL-29) |
| git log pickaxe | Eval `subprocess` hook returns `-S` hits for `builtin_git_log` (HL-29) |
| git bisect start | Eval `subprocess` hook returns remaining revisions (HL-30) |
| kconfig get/search | Reads `.config` symbols; search stays in `*Kconfig*` (HL-34) |
| maintainers lookup | MAINTAINERS F: match for `mm/filemap.c` without dumping THE REST |
| qemu stub panic | Intercepted `builtin_qemu` + oops oracle (RIP, not “clean”) (HL-32) |
| verifyCommand panic | Post-edit `make test` with a kernel panic is not a clean oracle (HL-07) |
| plan create/list | `builtin_plan` checklist survives the eval loop (HL-17) |
| doom-loop identical greps | Third identical `exact_search` is blocked; `stoppedReason=doom_loop` (HL-11) |
| doom-loop identical make | Three identical `builtin_build` gcc errors stop the loop (HL-11) |
| glob+grep one turn | Consecutive readonly tools both execute (HL-01 parallel batch) |
| exact_search | In-memory grep via `getSearchResults` |
| exact_search path+fileType | Path-scoped `copy_to_user` in `mm/` (HL-22) |
| exact_search truncation | Footer `truncated; pass maxResults/path/fileType` |
| view_subdirectory | Nested tree listing without VS Code |
| glob honors gitignore | `generated/foo.c` is omitted when `.gitignore` lists `generated/` (HL-19) |
| gcc-fix | `builtin_build` gcc error → StrReplace → parsed clean build |
| rustc-fix | `builtin_build` E0425 → StrReplace → intercepted cargo check green (RL-14) |
| rust-borrowck | E0502 fixed with `mem::take`, not `.clone()` (RL-15) |
| rust-test-tamper | Weakening `assert_eq!` / `#[ignore]` is not goal-complete (RL-16) |
| post-edit verifyCommand | Edit appends intercepted make diagnostics (HL-07) |
| git status | Eval `subprocess` hook returns porcelain for `builtin_git_status` |
| await_shell long job | Intercepted background `sleep 180` then `builtin_await_shell` (middleware allows 10 min waits; HL-14) |
| kbuild extract-then-edit | grep `copy_process` → StrReplace → intercepted make |
| codebase card | Kernel fixture injects `make ARCH=` + subsystem dirs (HL-28) |
| autonomous add() test | `/autonomous`-style step runs `builtin_edit_file` then terminal |

Default catalog is read/edit/write/patch/terminal. Systems tasks pass `SYSTEMS_EVAL_CATALOG` (adds glob, grep, view_subdirectory, await_shell, git status/diff/log/blame/bisect, builtin_build, builtin_qemu, builtin_kconfig, builtin_maintainers, builtin_plan). Eval and subagent both call `core/agent/loop.ts` (`runAgentLoop`), including doom-loop, heuristic compaction, and consecutive readonly batching. GUI Agent chat uses the same runtime (`gui/src/redux/thunks/runGuiAgentLoop.ts`) with token streaming and Ask/Accept waits. Real git blame/pickaxe/bisect fixtures live in `core/tools/implementations/git.test.ts` and `gitBisect.test.ts`. QEMU spawn + monitor parsing lives in `core/tools/implementations/qemu.test.ts`; the eval golden intercepts `builtin_qemu` and still runs the oops oracle.

## Add a task

1. Script turns in `goldenTasks.test.ts` (`toolCalls` then a text summary).
2. Assert `stoppedReason`, `files`, and `toolTrace`.
3. Keep the model mocked. Intercept shell with `evaluateCommand` instead of spawning.

See `harness.ts` (`runAgentEval`).

## Honesty gate

`honestyGate.test.ts` fails the suite if a tool is added to `allTools` / `allAvailableTools` without a `callTool` route, or if `SmartToolRouter` is re-exported. That router is experimental and not the product path. PR checklist: `.github/pull_request_template.md`.

## Live eval (manual, not CI)

Use a **real** chat model against the tiny C Makefile tree. Never enable a live LLM in `npm test`.

```bash
# 1. Copy or open the fixture
ls core/eval/fixtures/mini-c/
# Makefile  add.c  add.h  main.c

# 2. Confirm the oracle is red (add() subtracts)
cd core/eval/fixtures/mini-c
make test   # exits 1

# 3. In Knox Agent chat, systems profile optional:
#    "Fix add() so make test passes. Use builtin_build / the Makefile."

# 4. Expect: builtin_read_file / builtin_edit_file on add.c, then builtin_build or make test green.
```

The bug is `return a - b;` in `add.c`. A passing run returns `a + b` and `make test` exits 0. This is not a kernel build.

### mini-rust (RL-17)

Same shape, Cargo oracle. CI goldens intercept cargo (no rustc required on the eval runner).

```bash
cd core/eval/fixtures/mini-rust
cargo test          # red: add() subtracts
# Agent: "Fix add() so cargo test passes. Use builtin_build."
# Expect: edit src/lib.rs, cargo check/test green. Must not edit the test.
```

The bug is `a - b` in `src/lib.rs`. A passing run returns `a + b` and does not delete `assert_eq!` or add `#[ignore]`. Do not commit `target/`.

## Rust mastery tiers (RL-55)

| Tier | Knox artifact | CI? |
|------|----------------|-----|
| 0 Syntax/idiom | optional later; rustlings-like snippets | no live LLM |
| 1 Borrowck known-good | RL-15 `mem::take` (clone shortcut warns) | scripted yes |
| 2 Repair | RL-14 mini-rust `add()` E0425 | scripted yes |
| 3 Unsafe / Miri | intercepted `action=miri` UB log | scripted yes |
| 4 Async / Send | clippy `await_holding_lock` parse | scripted partial |
| 5 API design / semver | rust-review checklist | manual |
| 6 Perf / criterion | skill forbids unmeasured claims | manual |

Manual smoke (do not vendor): [Exercism Rust](https://exercism.org/tracks/rust), [rustlings](https://github.com/rust-lang/rustlings).

`summarizeRustEval` logs edits-to-green, clippy warnings, clone/unwrap density, miri-clean, and **test-tamper** (must stay 0 in production). No metrics product UI.
