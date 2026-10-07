# Changelog

All notable changes to KnoxCoder are documented in this file.
## [Unreleased]

## [2.1.0] - 2026-10-07

### Added

- **Knox: Open Knox Settings** shows a grouped picker (editor assist, agent, verification, memory, network, checkpoints) before opening the filtered Settings UI. Removed keys `knoxchat.sandbox` and `knoxchat.sharedLoop` stay as deprecated no-ops so old `settings.json` still loads.
- **Knox: Copy Session Share Link** copies a local `knoxcoder://vscode.knox/session/import?path=` URI; `/share` prints the same link. Opening it imports that Markdown transcript. Nothing is uploaded.
- Local config registry: `uses: owner/package` in `config.yaml` loads `~/.knoxcoder/registry/owner/package.yaml` (or `package@version.yaml`). Remote fetch is refused.
- Compaction quality eval: a long scripted session is compacted and the original `src/add.ts` edit still lands (`eval/compactionQuality.test.ts`).

- In-editor assist (no completion model): CodeLens on empty files, stub functions, TODO/FIXME comments and error diagnostics runs a reviewable edit; `Cmd/Ctrl+I` with no selection scopes to the stub/TODO under the cursor; after Accept, Knox can offer one related edit (once, never while typing). Settings `knoxchat.editAssist.codeLens` and `knoxchat.editAssist.nextEdit`.
- Custom agents from the command palette (list and create `.knoxcoder/agents/*.md`).
- **Knox: Import Session Transcript** restores a `/share` or Markdown-export transcript as a new session (text only, redacted).
- Multi-root workspaces: the workspace folder that owns the active editor file is now the primary root (`getWorkspaceDirs()[0]`) used for shell cwd, git, builds, relative paths, shadow workspace and checkpoint commands; other folders stay reachable via search and absolute paths. The system prompt names the roots when there is more than one. Each root's `AGENTS.md` / `.knoxrules`, `.knoxcoder/hooks.json` (hooks run with that root as `cwd`), and `.knoxcoder/agents` are loaded; glob with no path walks every root.
- Nested `.knoxignore` is honored by `exact_search`, glob and directory walks (patterns apply under that directory, not the workspace root).
- Post-edit oracle also detects Maven, Gradle, Zig and .NET projects, and looks at every workspace root (not only the primary folder).

### Large repo, 500k files (partial)

- **Test:** the opt-in test is `tools/largeRepo.test.ts`, run with `KNOX_LARGE_REPO_FILES=500000` (synthetic monorepo, no git; writes a few GB of tiny files, about 1 minute on a laptop).
- **Results:** it passes on 500k files. `exact_search` took about 11 s, a narrow `glob` 15 ms, and a whole-workspace `glob` stopped at its 100k walk cap in 0.7 s. At that cap it reports only 98.5k of the 500k files, by design.
- **Repo map:** a cold paths-only map takes about 1.5 s, a cold map with signatures about 1.2 s, a cached one about 1.1 s (the walk and stat pass still run), and zooming into one package with `path` about 25 ms. The map is built from the first 100k files the walk returns, so on a repo this size use `path` to reach the rest.
- **Bug fixed:** `exact_search` did not skip `node_modules` when no `.gitignore` listed it, so the 500k run returned only vendored hits. It now skips `node_modules` like `glob` does, unless the path or `fileGlob` points into it.
- **Bug fixed:** `pruneLinesFromTop` / `pruneLinesFromBottom` drifted over budget on long inputs (a 100k-line list pruned to 50k tokens came back at 88k) because each removed line's rounded-up count was subtracted while its newline was ignored. The repo map overshot its token budget by about 13% on the 500k run; it now stays within it. The same helpers trim the prefix and suffix of inline edit prompts.

### Changed

- Retired model names are gone from the product. The OpenAI and Anthropic "Add model" lists now offer GPT-6.1 Sol, GPT-6 Luna, Claude Sonnet 5.5, Claude Opus 5.5 and Claude Haiku 4.5 (they offered GPT-4o, GPT-4 Turbo, GPT-3.5 and Claude 3 / 3.5); the KnoxStudio and OpenRouter defaults and the OpenRouter offline fallback list use current KnoxStudio catalog models. Defaults for new models, the static context-length and token-limit table, the vision-name list, and the pricing fallback table (`modelPricing.json`, seeded from the live `/v1/models` prices) were updated to match. `KnoxChat` no longer defaults to `qwen/qwen3-coder`, which is not in the catalog. Models you already added keep working; live catalog metadata still wins over these static fallbacks.

### Fixed

- Reasoning effort now follows the OpenRouter / KnoxStudio parameter docs. The default effort list is the documented `reasoning_effort` enum (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`); `max` was in it but is not a `reasoning_effort` value. Requests send only documented values: a selected `max` (offered by models that advertise it) goes out as `reasoning_effort: "xhigh"` plus `verbosity: "max"`, and an unknown value is dropped instead of being forwarded and rejected. The chat API is used, not the Responses API, so its four-level table (`minimal`, `low`, `medium`, `high`) does not apply.
- Anthropic image attachments: images were always sent as `image/jpeg`, so PNG screenshots and pasted PNGs were rejected. The media type now follows the image (JPEG, PNG, GIF, WebP) and http(s) image URLs are sent as URL sources.
- `exact_search` no longer returns `node_modules` hits in folders whose `.gitignore` does not list it (non-git folders, unpacked archives). Pass a path or `fileGlob` inside `node_modules` to search it on purpose.
- Light themes: text in the brand teal and the red/green/orange status colours was 2.3-3.5:1 on white; it now meets 4.5:1.
- Keyboard: activity steps, input code-block headers, job titles, search-result lines and checkpoint analysis cards can be focused and activated with Enter or Space.
- Nested `AGENTS.md` in a multi-root window is resolved from the open file's folder, not by joining the same relative path onto every root.
- Workspace hooks, agents and prompts read `.knoxcoder/` only. Missing `config.yaml` / `hooks.json` are skipped without logging ENOENT.
- `/share` redacts API keys and other secrets in the exported transcript (same rules as GUI Markdown export).
- Checkpoint compare uses Myers line-diff so large files no longer render as a full add/delete.
- Windows packages now ship node-pty ConPTY binaries (`conpty.dll` / `OpenConsole.exe`) so the integrated terminal can launch.
- Unlabeled streaming fences get a language from a prefix sniff so they color while the block is still open.

### Removed

- Unused host `toolCallValidation` helpers. Missing tool arguments are still rejected in core tool middleware.
- The Custom Agents tree that split the Knox chat container below the composer. List and create stay in the command palette.
- Solid fill on the composer Send button and the model/effort row; they now sit on the same transparent input surface.

## [2.0.1] - 2026-10-06

### Fixed

- VS Code Marketplace extensions could not install on KnoxCoder 2.x: the extension `engines` check and gallery queries now use `vscodeVersion` instead of the product version.
- Stop during streaming: a provider that rejects with `AbortError` made the turn end as an **error** instead of "stopped", and a provider that ignored the abort signal (hung connection) left Stop waiting forever. The agent loop now races every stream read against the signal, keeps the partial reply, and ends as `aborted`.
- Stop/cancel left orphans: the non-background shell path and hook commands now run in their own process group and are killed as a tree (pipelines and grandchildren included; `taskkill /T` on Windows). Closing the window (`deactivate`) now SIGKILLs every running shell job and child agent instead of leaving detached jobs running.
- Memory/Jev status bar: the log and activity subscriptions were pushed as bare functions, so VS Code could not dispose them on deactivate. They are now disposables.
- i18next 26 ignored the old `initImmediate` option; host and core catalogs now set `initAsync: false` so strings are ready synchronously.

### Added

- Reliability tests (run in `test:core`, no hardware): `agent/loop.soak.test.ts` runs 1000 agent turns in one session (history stays bounded by compaction; retained heap grew 0.3 MB over turns 200-1000), and `context/memory/bench/brainScale.test.ts` measures Memory Brain retrieval with 100k items (pre-turn p95 about 140 ms, `searchSemantic` p95 about 75 ms on a dev laptop; budgets 750 ms p95 / 1.5 s max). `KNOX_SOAK_TURNS` and `KNOX_SCALE_ITEMS` override the sizes.

### Changed

- Memory Brain retrieval at scale: `searchSemantic` and the fusion trigram candidate pool now take candidates from FTS5 in BM25 order instead of LIKE matches ordered by importance. With thousands of memories, common words in unrelated rows used to crowd out the relevant one and every turn scanned the whole table; at 100k items pre-turn p50 went 271 ms to 68 ms and `searchSemantic` p95 441 ms to 75 ms. Brains of 5000 rows or fewer keep the substring LIKE fallback. Episodic FTS now matches first (CTE) so a session filter does not walk every row; at 100k items episodic p95 is about 14 ms. Graph expansion and `searchEpisodic` use FTS above 5000 rows.
- `exact_search` honors `.gitignore` outside git repos and the workspace-root `.knoxignore`, and is bounded: 60 s timeout (`KNOX_SEARCH_TIMEOUT_MS`) and a 16 MB output cap, returning partial results with a notice instead of hanging or exhausting memory on huge repos.

### Build and CI

- `npm run test:host-tsc` is clean (zero errors) and runs in Knox CI: host tsconfig now maps `knoxdev-package/*`, uses the DOM lib, and declares untyped deps (`jsdom`, `win-ca`, `follow-redirects`). Unused-local / override / implicit-return style checks are off for the host project only.
- Desktop packaging (`Build desktop apps`) is **manual only** (`workflow_dispatch`). Tag and branch pushes do not start it.

## [2.0.0] - 2026-10-05

First stable **2.0.0**. Everything since **1.138.2**, including **2.0.0-beta**, plus the items below since the beta.

### Removed

- **`ReasoningEngine`** and its commands `knox.analyzeTask`, `knoxchat.analyzeTask`, `knox.structuredSolve`, `knox.performTaskAnalysis`. None were contributed in the manifest or reachable from the GUI; the product planner is `builtin_plan`. The context-gathering operation no longer returns a random `contextSize`.
- Unreferenced modules: prompt-file v1 helpers and v2 parse/render, the unused `CustomContextProvider` and `edit/claude` template, `protocol/messenger` IDE adapters, `verificationLoop`, tool templates/examples, the unused LRU/LCS/text/JSON-stream utils, `terminalEmulator`, `languageClient`, `battery`, `cleanSlate`, `expandSnippet`, and the four legacy memory tool definitions (calls to the old `builtin_memory_*` names still route to `builtin_memory`).
- OS command sandbox (`knoxchat.sandbox`, macOS `sandbox-exec` / Linux `bwrap` wrappers, composer chip). Shell stays under command guard, path policy, and permission prompts.
- Headless CLI (`@knoxchat/cli`, `knox run`, `knox doctor`, `knox login`, packaged-cli-smoke). Background-agent **Start** (it only copied a CLI command) is gone; list/merge/discard remain.

### Added

- Stream errors classify HTTP 402 quota; copyable diagnostic on the error dialog.
- Rate-limit / quota dialogs use provider-specific hints and show session cost so far.
- Empty chat sample prompts; first-run copy covers KnoxStudio sign-in vs bring-your-own key.
- Update feeds include `sha256hash` and `SHA256SUMS`. Knox production licenses: `docs/third-party-notices.md`. Host migration tests run in Knox CI.
- Cross-window locking: checkpoint store, `sessions.json` and Memory Brain open/migrate.
- Checkpoint quota enforcement reclaims orphan blobs before evicting and reports when only pinned checkpoints remain.
- Memory Brain schema version, pre-migration backup and corruption recovery; atomic session writes.
- Release readiness check (`scripts/ci/release-check.mjs`) for version bump and tag verification.

## [2.0.0-beta] - 2026-10-04

Everything since **1.138.2**. Agent chat, tools, permissions, CLI, and GUI chrome.

### Added

- **Shared agent loop for GUI chat**
  Agent mode with tools now runs on the same `runAgentLoop` as eval, subagents, and `/autonomous`. Transient stream failures retry with backoff, honor `Retry-After`, switch to `knoxchat.fallbackModel` after repeated failures, and show “Connection problem, retrying (n/4)”. The old GUI tool loop and `knoxchat.sharedLoop` flag are gone; chat-only / no-tools / leftover slash commands still stream without tools.

- **Deferred tools and `builtin_tool_search`**
  Each turn sends a small core catalog (read/edit/write/patch/shell/search/glob/plan/ask_user/task/skill); the rest load on demand. Memory graph/sessions/manage/learn merge into `builtin_memory`. Tool-search has its own card. `knoxchat.deferTools` defaults **on**.

- **`builtin_fetch_url`**
  Fetch a URL as Markdown (Readability) with SSRF, redirect, size, and time guards: http(s) only, no credentials, private/localhost/link-local blocked unless `KNOX_FETCH_URL_ALLOW_PRIVATE=1`. Deferred; found via tool search.

- **Lifecycle hooks**
  `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart` from `.knox/hooks.json` and `hooks:` in global/workspace YAML (merged, json last). Exit 2 denies; JSON can rewrite args or inject context; timeouts never block. Audit ring, `/hooks`, `Knox: Show Hooks Log`, and a Hooks panel above the composer.

- **Isolated subagents and custom agents**
  Writing children run in git worktrees (default 3, cap 8, `KNOX_SUBAGENT_CONCURRENCY`). `.knox/agents/*.md` sets name, description, tool allowlist, readonly, and model. Uncommitted parent files seed the worktree; patches merge under a mutex; conflicts stay on disk, never half-applied. Per-child progress streams; jobs panel can cancel one child.

- **Review before edit**
  Mode popover “Review edits” holds writes in memory. Panel lists new/edit/delete with +/-; Diff, Open in editor, Apply, Discard, Apply all (checkpoint first). Disable is refused while edits are pending. Shell/tests still see the real disk and get a staged-edits notice.

- **Project instructions polish**
  `/instructions` lists rules, `AGENTS.md`, and skills in load order with token cost. Skills accept `globs` / `paths` / `applyTo` and hide until a matching file is open. `/init` writes a starter `AGENTS.md` (no overwrite unless `--force`). Files over 2000 tokens, or always-on text over 6000, warn. User skills already live in `~/.knoxcoder/skills`.

- **Headless CLI**
  From `extensions/knox/src/core`: `npm run knox -- login|whoami|logout` (OAuth to `~/.knoxcoder/auth.json`) and `run "<task>"` (`--dir`, `--permission`, `--max-steps`, `--model`, `--json`, `--stream-json`, `--profile default|systems`). Default permission is Edits (shell denied unless `fullAuto`). Exit codes: 0 completed, 1 error, 2 step/doom-loop, 130 abort, 64 usage. Project rules/AGENTS.md load into the prompt; hooks apply.

- **Background agent runs**
  `knox bg start|list|show|merge|discard`: detached worktree `~/.knoxcoder/bg/<id>/tree` on `knox/bg-<id>` from HEAD, desktop notification, `git merge` that aborts clean on conflict. Uncommitted main-repo changes are not copied; no GUI yet.

- **Safer permission defaults and shell command guard**
  New sessions default to **Edits** (reads/edits auto, shell asks). Empty chat shows a first-run banner (Switch to Auto / Keep Edits); saved modes are untouched. Destructive patterns (`git push --force`, `reset --hard`, `clean -fd`, `chmod -R`, raw-device writes, `curl | sh`, `find -delete`, wrappers/`sh -c`/`$()`/xargs) are hard-denied in every mode including Auto unless allowlisted. Writes outside the workspace ask.

- **Secret hygiene**
  API keys, `.env` values, private keys, and bearer tokens are redacted before transcript, Memory Brain, checkpoints, session logs, and prompt logs. Reading `.env*`, `*.pem`, and `id_*` always asks, including in Auto.

- **Jev latency budget and status**
  Hard timeouts (800 ms gates / 2 s others), circuit breaker (3 failures → 5 min skip), local activity log, status-bar indicator, and `Knox: Show Jev Log`. File contents are not sent (user message and tool names only).

- **Context budget and composer meter**
  Compaction uses the real model window (LLM → KnoxChat/OpenRouter catalog → 128k), provider `usage.prompt_tokens` when present, triggers at ~75%, and last-resort prune never drops plan / loop-state / memory messages. A 16px teal donut next to the composer icons shows used/limit (amber 75%, red 90%).

- **Model pricing from data**
  Prices live in `modelPricing.json` (custom → KnoxChat → OpenRouter → table). Cache read/write tokens count; unknown models report “unknown” instead of a wrong number; `:free` OpenRouter ids cost 0.

- **Prompt cache breakpoints**
  Stable prefix (system, codebase card, Rust policy) then volatile plan/serial tail. OpenRouter-routed `anthropic/*` and `google/gemini*` get cache markers (first system + last two user messages). Usage includes cache read/write tokens.

- **Post-edit oracle from the project**
  Auto-detect Cargo, `go vet`, Node typecheck/`tsc`/lint, pytest/ruff/compileall when no verify command and no LSP verifier. Parse those diagnostics; scope to the edited package/file when safe; report `oracle: <command> -> pass|fail (N errors)`.

- **Memory Brain benchmark**
  Fixture recall@k / precision / false-inject / injected tokens / latency with a checked-in baseline; hard inject cap 8000 tokens (`KNOX_MEMORY_INJECT_CAP`). Manual `test-*.ts` scripts under brain are gone.

- **Live-model evals and Knox CI**
  Golden tasks run on both `runAgentLoop` and `runChatTurn`. `npm run test:live` (OAuth, `KNOX_LIVE_MODEL`, `KNOX_LIVE_DEFER`, `KNOX_LIVE_RUNS`) writes `eval/results/history.jsonl` and fails on pass-rate/token regressions. Nightly workflow runs scripted evals + memory bench. **Knox CI** runs core/pkg vitest, `tsc`, and inventory-gate and blocks packaging.

- **Team bundles**
  `knox team export|import` (`knox-team-bundle` v1): `.knoxrules`, `AGENTS.md`, hooks, `.knox/agents/*.md`, `skills/**`. Skips secrets, binaries, files over 256 KB, and path traversal. Import keeps existing files unless `--force`; hooks need `--allow-hooks`; `--dry-run` writes nothing. No GUI or remote registry.

- **Inline completion stats**
  Requests / shown / accepted / empty / failed / cancelled and latency p50/p95 (`Knox: Show Inline Completion Stats`). `knoxchat.inlineCompletionModel` routes to a small model by title. Stays **off** by default (no FIM model; not a 2.1 product surface). Copilot-style next-edit is not planned.

- **User docs**
  `extensions/knox/docs/README.md`: setup, headless use, permission modes, rules/skills, hooks, subagents, memory, checkpoints, Jev, troubleshooting.

- **Turn summary**
  After each agent turn: files with +/-, commands, tests, tokens, elapsed time, plus review-all and undo-turn (checkpoint restore). Later restyled as a card with chips and a separate action row.

- **Tool-card controls**
  Long read/grep results collapse; headers are keyboard operable; running commands have Stop and copy-command.

- **Message queue**
  Type while the agent runs: a chip (send now / remove) persists across reload and drains when the turn ends by itself — not after Stop, error, or a pending approval.

- **Session pin, search, fork, size cap**
  Pin (own “Pinned” group), content search across sessions (skips tool output and files over 8 MB), fork from a message (user-message fork restores the composer), rename/export Markdown already existed. Stored sessions cap at 20 MB (shrink oldest big strings; never drop messages).

- **Onboarding, errors, and accessibility**
  Empty chat with no model shows “Open settings”. Stream errors get a per-kind hint plus Retry, Open settings, and Switch model (hidden on auth errors or a single model). Safer-defaults banner on first run. en/zh GUI string parity test; `prefers-reduced-motion` shortens decorative animation; only real toggles announce pressed; panels region labeled “Agent panels”.

- **Doom-loop extras**
  Oscillating edits (A,B,A,B), stuck oracle signatures, repeated identical `ask_user`, including `apply_patch`. A Change-strategy banner sends a localized “try a different approach” prompt.

- **Startup budget**
  `dbinfoz` / jsdom / Readability lazy-load on first use. Activation logs `[startup] activate Nms …`. `npm run measure-startup` and a budget test (no static heavy imports, bundle ≤ 16 MB, load ≤ 500 ms).

- **Hermetic worktree tests**
  Shared temp-git-repo helper; worktree/subagent tests no longer touch the real checkout.

### Changed

- Bumped product version to **2.0.0-beta** (`package.json` / related product metadata).

- **System prompt overhaul**
  Composable sections: identity/tone, core rules, editing, verification/honesty, shell, git, plan/delegation, systems (PTY/QEMU/kconfig/maintainers/debug/bisect). Default profile drops systems detail (~40%+ smaller); sections gate on enabled tools. Headless uses the gated prompt.

- **`edit_file` is atomic multi-edit**
  `edits: [{old_string,new_string,replace_all?}]` applies in memory; one failure writes nothing. Compact `@@` diff in the result; CRLF and BOM preserved; stale-read (hash from prior read/write/patch) warns without blocking.

- **Shared output truncation**
  One helper with continuation hints for `read_file` (2000 lines), `exact_search` (60k chars), glob, and `view_subdirectory`.

- **Core type-check is clean**
  Path aliases for `knoxdev-package/config-yaml`, `win-ca` shim, test casts. Host reuses middleware `isMissingToolArg` instead of a duplicate.

- **Chat chrome**
  One Dark lifted composer and sent-message surfaces; last scrolled-away prompt stays pinned; transcript resticks when that pin appears or disappears; composer sits flush with the transcript (no duplicate top hairline); tool cards inset with the thinking block; chat scrollbar on by default; `apply_patch` hunks highlight in each file’s language while they stream.

- **Jobs panel** keeps command and last-line output as separate fields so a long line does not swallow the shell command.

- **Tool calling is schema-coerced**: arguments validated against each tool’s JSON Schema; cut-off calls report `InvalidJson`; deterministic input errors are not retried or counted by the circuit breaker; no-op patches are idempotent; host no longer rewrites tool errors as connection failures.

### Fixed

- **Three core tests** that were red: GUI loop-guard path, small-session slimming, ripgrep version (`>= 15.0` with PCRE2).

- **Missing files and directories** from glob/read/list are probe results, not failed tool calls.

- **Cancelling one in-flight tool card** no longer kills other background jobs; Stop still aborts detached shells.

- **Cargo oracle** waits instead of auto-backgrounding (a backgrounded check was reported green while cargo still ran), and skips after HTML/CSS/JS/docs edits that cannot affect a Rust build.

- **Windows packaging** skips File Explorer AppX when `product.json` has no context-menu CLSID (GitHub auto-update `quality=stable` was crashing on undefined `win32ContextMenu[arch]`).

- **Linux RPM/deb packages accept npm prerelease versions**
  RPM forbids `-` in `Version` (`2.0.0-beta` aborted `rpmbuild`). Packaging maps the npm prerelease to `2.0.0~beta` (sorts before `2.0.0`). Deb uses the same form. Auto-update metadata keeps the full `2.0.0-beta` product version.

- **CI sqlite3** rebuilds from source; git bisect accepts quoted `'bad'`.

- **Streaming code blocks** report the correct generated line count (the label was always one short of the gutter).

- **Memory bench precision gate** allows platform jitter so the quality check does not flake across machines.

### Removed

- Unused tool orchestration (`SmartToolRouter`, pipeline, transaction/rollback) and the unused host test-generation service.
- Memory Brain manual `test-*.ts` scripts (covered by `memory-*.test.ts`).
- The duplicate GUI agent-tool path (`tools/call` / doom-loop from the webview) and `knoxchat.sharedLoop` / `knox/sharedLoopEnabled`.

### Files touched in this release

| Path | Action |
|------|--------|
| `extensions/knox/src/core/agent/**` (`chatTurn`, `contextBudget`, `streamRetry`, `permissionGate`, doom-loop) | Added/modified (shared loop, budget, retry) |
| `extensions/knox/src/core/cli/**` | Added (headless run, login, background agents, team bundle) |
| `extensions/knox/src/core/hooks/**` | Added (lifecycle hooks, audit log) |
| `extensions/knox/src/core/tools/**` (`deferred`, `fetchUrl`, `commandGuard`, `stagedEdits`, `truncateOutput`, `schemaArgs`, oracle detect, `editFile`) | Added/modified |
| `extensions/knox/src/core/llm/**` (`systemPrompt`, `promptCache`, `modelPricing.json`, usage on `PromptLog`) | Added/modified |
| `extensions/knox/src/core/jev/guard.ts` | Added (budget, breaker, activity log) |
| `extensions/knox/src/core/util/redactSecrets.ts` / `sessionSearch.ts` / `sessionSizeCap.ts` | Added |
| `extensions/knox/src/core/config/instructionReport.ts` / `agentsMd.ts` / `teamBundle.ts` / skills scope | Added |
| `extensions/knox/src/core/context/memory/bench/**` | Added (benchmark + baseline) |
| `extensions/knox/src/core/eval/**` / `vitest.live.config.ts` | Added/modified (golden parity, live harness, startup budget) |
| `extensions/knox/src/core/test/tempRepo.ts` | Added (hermetic git) |
| `extensions/knox/src/host/extension/sharedChatTurn.ts` / `host/lm/inlineCompletionStats.ts` / Jev + hooks status | Added/modified |
| `src/vs/workbench/contrib/knox/browser/gui/controller/sharedTurn.ts` / `stream.ts` | Added/modified (GUI on shared loop) |
| GUI chrome, panels, composer, tools, i18n `en`/`zh`, queue/sessions/turn-summary/context-meter helpers | Added/modified |
| `.github/workflows/knox-ci.yml` / `knox-nightly.yml` / `build-desktop.yml` | Added/modified (Knox tests gate packaging; sqlite3 from source; prerelease version for RPM/deb) |
| `build/lib/packageVersion.ts` / `build/gulpfile.vscode.linux.ts` / `build/gulpfile.vscode.win32.ts` | Added/modified (npm `2.0.0-beta` → Linux `2.0.0~beta`; Windows RawVersion; skip AppX without CLSID) |
| `scripts/ci/generate-update-metadata.mjs` | Modified (keep prerelease in update feeds) |
| `extensions/knox/docs/README.md` / `extensions/knox/README.md` | Added/modified |
| `package.json` / `package-lock.json` | Modified (version 2.0.0-beta, Knox settings) |
| `CHANGELOG.md` | Modified |

## [1.138.2] - 2026-10-02

### Added

- **Ask / Edits / Auto permission dropdown**
  Chat vs Agent is no longer a user tab. The toolbar is one permission control (Ask / Edits / Auto, Shift+Tab). When Jev is on, it picks Chat vs Agent per turn; otherwise the session stays Agent. Worktree and Jobs live in that same menu. Host `knox.toggleAgentMode` can still force Agent on; turning it off no longer switches the GUI to Chat.

- **Empty model picker opens Add Model**
  First-run setups with no configured or custom models skip the empty dropdown and open the Add Model modal directly (title covers chat and agent).

- **GitHub auto-update**
  Packaged builds compare the running KnoxCoder version against published GitHub releases (`https://github.com/knoxchat/knoxcoder`) and download the matching installer instead of using a VS Code update feed. Linux still opens the releases page. CI attaches `latest-<platform>-<arch>.json`; macOS metadata comes from `./build_dmg.sh`.

- **Workspace checkpoints pin Memory Brain**
  File snapshots now pin a brain checkpoint (and rewind falls back to the nearest earlier pin). Restore-with-memory is transactional so semantic memory cannot stay ahead of the disk.

### Changed

- Bumped product version to **1.138.2** (`package.json` / related product metadata).

- **Knox Core messenger split into modules**
  `extensions/knox/src/core/core.ts` is now `core/Core.ts` plus focused modules (`agent`, `brain`, `tools`, `startup`, …). `import { Core } from "core/core"` still resolves; no handlers were dropped.

- **Memory Brain store and manager split into modules**
  `BrainStore.ts` and `BrainManager.ts` remain facades over `store/` and `manager/`. Call sites are unchanged.

- **README overview is a video** instead of screenshots.

### Fixed

- **Tool calls stay executable when models leak markup**
  Heal unpaired `tool_calls` before the API, remap `tool_name` placeholders, parse exploded DSML, and strip leading `>` / quotes / `:line` from file paths so reads and related tools resolve.

- **Ask-user no longer stalls on empty forms**
  Accept Cursor and Claude question shapes. Empty payloads settle with a schema hint so the turn can continue.

- **Chat replies no longer triple**
  Chat, Memory, and Checkpoint Graph all attach stream listeners; dispatch now de-dupes so the same envelope is not applied three times.

- **Hidden composer dock keeps transcript scroll buttons**, and **Approve / action buttons stay teal fills** in both themes (leftover text chips removed).

### Files touched in this release

| Path | Action |
|------|--------|
| `src/vs/platform/update/**` / `scripts/ci/generate-update-metadata.mjs` / `product.json` / `build_dmg.sh` / `.github/workflows/build-desktop.yml` | Added/modified (GitHub releases auto-update) |
| `extensions/knox/src/core/core/**` | Added (messenger hub split; `core.ts` removed) |
| `extensions/knox/src/core/context/memory/brain/store/**` / `manager/**` | Added (Brain facades kept) |
| `extensions/knox/src/core/llm/healToolCallMessages.ts` / `parseTextToolCalls.ts` / `util/toolFilePath.ts` | Added/modified |
| `extensions/knox/src/core/tools/implementations/askUser.ts` | Modified |
| `extensions/knox/src/core/jev/turn.ts` | Modified (permission-mode routing) |
| GUI chrome, overlays, i18n `en`/`zh`, agent mode, capabilities, state | Modified (Ask/Edits/Auto; leftover Chat/Agent strings removed) |
| Host/core/GUI contract and parity tests | Modified |
| `README.md` | Modified |
| `package.json` / `package-lock.json` | Modified (version 1.138.2) |
| `CHANGELOG.md` | Modified |

## [1.138.1]

### Added

- **OpenRouter provider for Knox Agent**
  Add Model and Configure Provider now include OpenRouter next to KnoxStudio, OpenAI, and Anthropic. Sign in with OpenRouter (one-shot PKCE on `127.0.0.1:8734`, key labeled `KnoxCoder` in the OpenRouter dashboard) or paste an `sk-or-…` key. The OAuth key stays in SecretStorage and is injected at runtime, so it is not written into `config.yaml`. KnoxStudio sign-in remains on port 8733; both sessions can coexist. Sign-out wipes the local key and deletes the minted OpenRouter key when possible; a Manage key link opens the owner’s key page.

- **OpenRouter live model catalog**
  Configure Provider and the Add Model modal (KnoxStudio / OpenRouter toggle) load OpenRouter’s public `GET https://openrouter.ai/api/v1/models` list — searchable, 24-hour cache, same metadata shape as KnoxStudio. If the catalog is unreachable, a small coding fallback is shown (Claude Sonnet 4.6, GPT-4o, Gemini 2.5 Pro). English and Chinese copy is included for the new strings.

- **English / Chinese toggle on Checkpoint Graph and Memory**
  Those editor tab bars now have the same globe language switch as the sidebar (`中` while English, `EN` while Chinese). Changing language in chat, Memory, or Checkpoint Graph updates every Knox view and is stored in the profile. The checkpoint graph remounts on a language switch so cached translated labels refresh.

### Changed

- Bumped product version to **1.138.1** (`package.json` / related product metadata).

- **OpenRouter picker shows advertised floor pricing from `/api/v1/models`**
  Canonical slugs such as `z-ai/glm-5.3-flash` still list a typical-provider rate (`$0.15/0.5`) on that endpoint, while the matching `~*-latest` alias (`~z-ai/glm-flash-latest`) carries the floor / website price (`$0.02/0.2475`). The catalog now copies cheaper alias pricing onto the alias target so GLM 5.3 Flash and similar family members match OpenRouter’s models list instead of the median list price. Badges keep four-decimal $/1M rates (so `0.2475` is not rounded to `0.25`).

- **KnoxChat provider renamed to KnoxStudio**
  The Add Model / Configure Provider label, YAML duplicate prefix, OAuth callback page, minted API token name, and related English/Chinese copy now say KnoxStudio (`api.knoxstudio.ai`). The internal provider id remains `knoxchat`, so existing `config.yaml` models keep working.

- **Add Model modal remembers the last provider tab**
  KnoxStudio vs OpenRouter is stored with the rest of GUI UI state. Reopening the modal — including after a reload — restores the tab you used last instead of always starting on KnoxStudio.

- **Knox Agent can chat through OpenRouter**
  New `OpenRouter` LLM class (`apiBase=https://openrouter.ai/api/v1/`) reuses the existing OpenAI-compatible stream, tools, images, and reasoning autodetect. Requests send KnoxCoder attribution (`HTTP-Referer`, `X-OpenRouter-Title`) so OpenRouter logs do not show the app as Unknown. Tool, image, and reasoning support follow the live catalog the same way KnoxStudio does.

- Shared OAuth loopback now accepts a port so OpenRouter can bind **8734** without moving KnoxStudio off **8733**.

- Adding the same catalog title from two providers prefixes the YAML name (`OpenRouter · GPT-4o`) instead of appending ` (1)`.

### Files touched in this release

| Path | Action |
|------|--------|
| `extensions/knox/src/core/auth/openrouterOAuth/**` | Added (PKCE client, session, tests) |
| `extensions/knox/src/host/oauth/OpenRouterOAuthController.ts` / `openrouterOAuthPersistence.ts` | Added |
| `extensions/knox/src/core/protocol/openrouterOAuth.ts` | Added |
| `extensions/knox/src/core/llm/llms/OpenRouter.ts` | Added |
| `extensions/knox/src/core/llm/openrouterModels.ts` / `openrouterModelsDisk.ts` | Added |
| `extensions/knox/src/pkg/fetch/openrouterAttribution.ts` | Added |
| `src/vs/workbench/contrib/knox/browser/media/logos/openrouter.svg` | Added |
| `src/vs/workbench/contrib/knox/browser/gui/widget/languageToggle.ts` | Added |
| `extensions/knox/src/core/auth/knoxOAuth/loopback.ts` / `session.ts` / `constants.ts` | Modified (shared port, OpenRouter key injection, KnoxStudio token name) |
| `extensions/knox/src/core/llm/autodetect.ts` / `toolSupport.ts` / `llms/index.ts` | Modified |
| `extensions/knox/src/pkg/openai-adapters/**` / `pkg/fetch/fetch.ts` | Modified |
| `extensions/knox/src/host/extension/VsCodeMessenger.ts` / `VsCodeExtension.ts` | Modified |
| GUI overlays, Add Model pages, inbound protocol, composer selects, i18n `en`/`zh` | Modified (KnoxStudio provider label + last tab persist) |
| Checkpoint Graph / Memory pages, `knoxGuiController.ts`, graph/memory CSS | Modified |
| Host/core/GUI contract and parity tests | Modified |
| `package.json` / `package-lock.json` | Modified (version 1.138.1) |
| `CHANGELOG.md` | Modified |

## [1.138.0]

### Added

- Native extenstion Knox agent

### Changed

- **Knox global directory moved from `~/.knox` to `~/.knoxcoder`**
  The builtin Knox agent now keeps config, Memory Brain, sessions, checkpoints, rules, prompts, skills, logs, and job output in `~/.knoxcoder` so it no longer conflicts with the external Knox marketplace extension (`knoxchat.knoxchat`), which uses `~/.knox`. The global `~/.knoxrules` file is now `~/.knoxcoder/.knoxrules`. There is no legacy fallback or migration from `~/.knox`; move files manually if you want to keep them. `KNOX_GLOBAL_DIR` still overrides the location.

- **Project license is now GPL-3.0-only**
  KnoxCoder (including Knox-owned sources) is licensed under the GNU GPL v3. Upstream Visual Studio Code files remain MIT; that notice is kept in `LICENSE.vscode.txt`.

- **Upgrade to VS Code 1.138.0**
  Merged upstream `microsoft/vscode` 1.138.0 while preserving Knox branding, Open VSX gallery, native TypeScript tooling, and Knox-specific customizations.

- Bumped product version to **1.138.0** (`package.json` / related product metadata).

### Removed

- **Chat, Copilot, LLM, prompt, agent, MCP, and sessions surfaces**
  Dropped upstream Copilot/chat/agent-host/MCP/sessions/LLM additions from 1.137–1.138, including the `agentsWindowActivation` proposal, `prompt-basics` language pack, and chat-only commands, so KnoxCoder stays a VS Code fork with an isolated AI context.

### Files touched in this release

| Path | Action |
|------|--------|
| Upstream VS Code 1.138.0 merge surface | Updated |
| `package.json` / related product metadata | Modified (version 1.138.0, Knox toolchain preserved) |
| Copilot / chat / agent-host / MCP / sessions / LLM sources | Removed or not adopted |
| `CHANGELOG.md` | Modified |

## [1.136.2] - 2026-09-07

### Added

- **Knox Agent (`vscode.knox`)**
  Knox ships inside the editor as a system extension (same class as Git): host `dist/`, webview `gui/`, and platform sqlite3. Linux/Windows CI packages it via `packageNativeLocalExtensionsStream` and verifies those artifacts. macOS uses `./build_dmg.sh` (no GitHub Actions macOS job). Disable it in the Extensions view if you need to; it cannot be uninstalled.

### Changed

- Bumped product version to **1.136.2** (`package.json` / related product metadata).
- Marketplace Knox (`knoxchat.knoxchat`) is not required in KnoxCoder and is hidden/blocked. This fork does **not** publish a KnoxCoder-dependent VSIX to Open VSX. Store Knox for vanilla VS Code remains in the **kc** product tree.

### Removed

- Dropped leftover `onnxruntime-node` embeddings stubs. Memory and code search use BM25 + product ripgrep.
- No Rust neon checkpoint crates; checkpoints stay TypeScript.

## [1.136.1] - 2026-09-06

### Changed

- **Upgrade to VS Code 1.136.1**
  Merged upstream `microsoft/vscode` 1.136.1 while preserving Knox branding, Open VSX gallery, native TypeScript tooling, and Knox-specific customizations.

- Bumped product version to **1.136.1** (`package.json` / related product metadata).

### Removed

- **Chat, Copilot, and agent-host surfaces**
  Dropped upstream Copilot/chat/agent-host/MCP/sessions additions from 1.135–1.136 so KnoxCoder stays a VS Code fork with an isolated AI context.

### Files touched in this release

| Path | Action |
|------|--------|
| Upstream VS Code 1.136.1 merge surface | Updated |
| `package.json` / related product metadata | Modified (version 1.136.1, Knox toolchain preserved) |
| Copilot / chat / agent-host / sessions sources | Removed or not adopted |
| `CHANGELOG.md` | Modified |

## [1.134.0] - 2026-08-21

### Changed

- **Upgrade to VS Code 1.134.0**
  Merged upstream `microsoft/vscode` 1.134.0 while preserving Knox branding, Open VSX gallery, native TypeScript tooling, and Knox-specific customizations (no Copilot/chat/agent-host surfaces).

- Bumped product version to **1.134.0** (`package.json` / related product metadata).

- Adopted VS Code 1.134 Modern UI (`contrib/modernUI`), including Knox shell and scroll-shadow styles previously kept under `styleOverrides`.

- Enabled the 1.134 incremental `build-fast` pipeline, skipping Copilot compile when that extension is not present.

### Files touched in this release

| Path | Action |
|------|--------|
| Upstream VS Code 1.134.0 merge surface | Updated |
| `package.json` / `package-lock.json` | Modified (version 1.134.0, Knox toolchain preserved) |
| `src/vs/workbench/contrib/modernUI/**` | Added/updated (Knox CSS ported from styleOverrides) |
| `src/vs/workbench/contrib/styleOverrides/**` | Removed (renamed upstream to modernUI) |
| `CHANGELOG.md` | Modified |

## [1.132.0] - 2026-08-08

### Changed

- **Upgrade to VS Code 1.132.0**
  Merged upstream `microsoft/vscode` 1.132.0 while preserving Knox branding, Open VSX gallery, native TypeScript tooling, and Knox-specific customizations.

- Bumped product version to **1.132.0** (`package.json` / related product metadata).

### Fixed

- **`core-ci` esbuild bundle crash (`"version" is a required argument`)**
  Minified NLS + mangle-privates builds called async `adjustSourceMap` without `await`, so a Promise was passed into `SourceMapConsumer` and CI failed on Linux/Windows during `esbuild-vscode-reh-min`.
  **Change:** await both mangle and NLS source-map adjustments in `build/next/index.ts`.

- **Policy packaging failure against Open VSX**
  Language-pack fetches used the VS Marketplace `extensionquery` API, which Open VSX does not implement, aborting the whole policy build.
  **Change:** skip failed policy localizations with a warning and continue with English-only policies (`build/lib/policies/policyGenerator.ts`).

- **Stale `agentHost` esbuild entry points**
  Removed deleted `agentHostMain` / `diffWorkerMain` bundle entries so `core-ci` can bundle again after those mains were dropped.

- **Build TypeScript / source-map 0.8 compatibility**
  - Pin `@types/glob` to 7.x and `@types/minimatch` to 5.x (stub v9/v6 resolved against modern package types and broke default imports).
  - Add explicit `glob` dependency for the build package.
  - Update `build/lib/nls.ts` and `build/lib/tsb/builder.ts` for async `SourceMapConsumer`.
  - Type empty `webOnlyEntryPoints` as `string[]`.

### Removed

- **Telemetry / AI relevance plumbing**
  Dropped orphaned telemetry senders, AI related-information/settings search, OTLP/sqlite otel paths, inline-completions telemetry helpers, and related eslint/i18n wiring that no longer belongs in this product.

### Files touched in this release

| Path | Action |
|------|--------|
| `build/next/index.ts` | Modified (await source-map adjust; entry cleanup) |
| `build/lib/policies/policyGenerator.ts` | Modified (Open VSX-safe localization) |
| `build/lib/nls.ts` | Modified (async SourceMapConsumer) |
| `build/lib/tsb/builder.ts` | Modified (async SourceMapConsumer) |
| `build/package.json` / `build/package-lock.json` | Modified (glob types + dep pins) |
| Telemetry / otel / agentHost-related sources | Removed or cleaned |
| Upstream VS Code 1.132.0 merge surface | Updated |

## [1.131.0] - 2026-08-05

### Fixed

- **HTML Language Server crash on startup**
  The HTML language features server (ESM bundle) died immediately with `ReferenceError: __filename is not defined` because bundled `@typescript/typescript6` still expects CommonJS globals. That produced the UI errors (`-32097`, connection disposed, “crashed 5 times”).
  **Change:** extend the esbuild banner in `extensions/html-language-features/esbuild.mts` to define `__filename` / `__dirname` from `import.meta.url` alongside the existing `createRequire` shim.

- **macOS codesign failures from Apple timestamp flakes**
  Production DMG builds could fail mid-sign with `The timestamp service is not available` when Apple’s timestamp authority flaked under Electron’s many nested signatures.
  **Changes:**
  - Retry transient keychain/timestamp errors in `build/darwin/sign.ts` (up to 5 attempts with backoff).
  - Add `codesign_with_retry` for DMG signing in `build_dmg.sh`.

### Added

- **Knox Lucide icon font pipeline**
  - New generator: `build/lib/generateKnoxLucideFont.ts` (`npm run generate-knox-icons`).
  - Generated assets under `src/vs/workbench/browser/media/knox/lucide/` (`codicon.ttf`, `icon-map.json`).
  - Typings for `oslllo-svg-fixer`; deps: `fantasticon`, `lucide-static`, `oslllo-svg-fixer`.

- **Knox shell style overrides**
  - New stylesheet `src/vs/workbench/contrib/styleOverrides/browser/media/knoxShell.css`, wired into `styleOverrides.contribution.ts`.

### Changed

- Bumped product version to **1.131.0** (`package.json` / related product metadata).
- One Dark Pro dark theme token updates (`extensions/theme-onedark-pro/themes/dark.json`).
- Workbench theme defaults and related contribution tweaks (`workbenchThemeService`, `theme.ts`, `workbench.contribution.ts`, getting-started contribution).
- Build/preLaunch wiring for Knox icon generation and packaging (`build/lib/preLaunch.ts`, `compilation.ts`, `gulpfile.extensions.ts`, `scripts/build-app.sh`, `build/npm/dirs.ts`).
- Minor GitHub authentication experimentation-service / lockfile cleanup.

### Files touched in this commit

| Path | Action |
|------|--------|
| `extensions/html-language-features/esbuild.mts` | Modified |
| `build/darwin/sign.ts` | Modified |
| `build_dmg.sh` | Modified |
| `build/lib/generateKnoxLucideFont.ts` | Added |
| `build/lib/typings/oslllo-svg-fixer.d.ts` | Added |
| `src/vs/workbench/browser/media/knox/lucide/*` | Added |
| `src/vs/workbench/contrib/styleOverrides/browser/media/knoxShell.css` | Added |
| `package.json` / `package-lock.json` | Modified |
| Theme, workbench, and build wiring files listed above | Modified |
