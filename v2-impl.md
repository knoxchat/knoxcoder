# Knox Agent 2.0.0 stable: implementation plan

Scope: the Knox agent (`extensions/knox/**`, `src/vs/workbench/contrib/knox/**`) and
what ships it (CI, packaging, update, docs). The VS Code editor fork itself is out of scope.

Baseline: `2.0.0-beta` (tag `v2.0.0-beta`, commit `732a6cf8`). This list was built from
`CHANGELOG.md`, `extensions/knox/docs/README.md`, the code layout, CI workflows,
`product.json`, and a local run of `npm run test:tsc` and `test:core`.

Legend: **P0** blocks 2.0.0 stable. **P1** should ship in 2.0.0. **P2** may slip to 2.1.
Each item is a checkbox; tick it when merged. Items carry an acceptance criterion ("Done when").

---

## Observed state at time of analysis

- `npm run test:tsc` (core type-check): **passes**.
- `npm run test:core`: 200 files / 1585 tests pass in ~8 s. (An earlier note here claimed a hang;
  that was a piped-reporter artifact, not a real hang.) `test:pkg` (16), `inventory-gate` and the
  Knox GUI/contract tests (445, via `./scripts/test.sh --glob "vs/workbench/contrib/knox/**/*.test.js"`) pass.
- Knox GUI tests (Electron) are not run as a gating CI job (`continue-on-error` in `knox-ci.yml`).
- Knox tests run on Linux, Windows (`windows-2022`), and macOS in `knox-ci.yml` (gates packaging via `build-desktop.yml`).
- Ghost-text inline completion is off by default (prompt-FIM on the chat/edit model, not a dedicated FIM model). Copilot-style next-edit is not built and is out of 2.1.
- Background agents, team bundles and `knox` CLI have no GUI.
- Docs: `README.md` still links the generic VS Code docs; `reportIssueUrl` in `product.json`
  points to `microsoft/vscode`.
- `extensions/knox/package.json` version is `10.0.0` while the product is `2.0.0-beta`.
- Only `en` and `zh` locales exist.

---

## P0: Release blockers

### P0-1 Green, trustworthy test baseline (DONE except CI wiring)
- [x] `startupBudget.test.ts` no longer fails on a leftover unminified dev `dist/extension.js`; the size and
      load budgets apply only to the minified packaged bundle.
- [x] No hanging test found; full core suite finishes in ~8 s. Per-test timeout (30 s) and CI job timeout (30 min) already exist.
- [x] Fixed stale KN-382 contract test (`knoxAgentHostContract.test.ts`): contributed `knoxchat.*` /
      `knox.checkpoints.*` settings match the frozen catalog (`settingIds.ts`; currently 57 after dropping `knoxchat.sandbox`).
- [x] Ran `test:tsc`, `test:core`, `test:pkg`, `inventory-gate`, GUI tests: all green locally.
- [x] Knox GUI/contract tests wired into CI: new `gui` job in `knox-ci.yml` (xvfb + `scripts/test.sh --glob`). It is `continue-on-error` until proven green; then remove that flag so it gates packaging.
- [x] Host checkpoint-migration tests (`npm run test:host`) run on the Knox CI matrix.
- [x] Flaky-test policy: `extensions/knox/docs/testing-policy.md` (no retry masking, quarantine list with owner and issue; none retry today).
- [ ] Three consecutive green CI runs on Linux.

### P0-2 Cross-platform CI for Knox (DONE except packaged-extension smoke)
- [x] Added OS matrix to `.github/workflows/knox-ci.yml` (`ubuntu-22.04`, `windows-2022`, `macos-latest`: tsc, core, pkg, inventory-gate). The separate `knox-ci-cross-platform.yml` was folded in so packaging (`build-desktop.yml` → `workflow_call`) waits on all three OSes.
- [x] Read first results and fixed Windows failures: hook cwd via `fileURLToPath`, worktree test URIs via `localPathToUri`, PTY echo via raw-mode TTY (ConPTY does not flow `stdin.pipe(stdout)`).
- [x] `tools/commandGuard.ts` now detects Windows destructive commands (`del /s`, `rd /s`, `Remove-Item -Recurse`, `format X:`, `reg delete`, `diskpart`, `Format-Volume`), handles backslash paths/`.exe`, and recurses into `cmd /c` and `powershell -Command`. Tests added.
- [x] Run Knox CI (`tsc`, core, pkg, inventory-gate) on `windows-2022` and `macos-latest` as well as Linux.
- [x] Node packaged-extension smoke: `npm run esbuild -- --skip-native && npm run packaged-smoke` (`scripts/packaged-extension-smoke.mts`, `node --check` + 16 MB + 500 ms load budget). Wired on Linux/Windows/macOS. Electron remaining-smoke (`host/test/runner/runRemainingSmokeOnKnoxCoder.ts`) still needs a KnoxCoder build.

Done when: CI matrix is green on Linux/Windows/macOS. (Core/pkg/tsc/inventory-gate is green; all three OSes also build the host bundle and syntax-check it. Full Electron app smoke still open.)

### P0-3 Release pipeline for stable
- [x] Version scheme documented in `extensions/knox/docs/release.md`: product `2.0.0` (no prerelease) when shipping; `build/lib/packageVersion.ts` already maps `2.0.0` unchanged for deb/rpm/Windows numeric. Stay on `2.0.0-beta` until the checklist.
- [x] `extensions/knox/package.json` stays `10.0.0`: it is a VS Code system extension (same dummy version as Git/TypeScript in this tree). Product version is what users see.
- [ ] macOS: add a CI or documented runbook for `build_dmg.sh` (sign, notarize, staple, upload
      `latest-darwin-<arch>.json`). Verify notarization on a clean machine. (Notarization steps noted in `docs/release.md`; still needs a clean-machine run.)
- [ ] Windows: code-sign installers (or document SmartScreen behavior); verify user and system installers
      upgrade from `1.138.2` and `2.0.0-beta`. SmartScreen / upgrade runbook is in `docs/release.md`; still needs a signed cert and a clean-machine run.
- [ ] Linux: verify tar.gz/deb/rpm install and upgrade, and that `2.0.0~beta` upgrades to `2.0.0`.
      Commands are in `docs/release.md`; still needs a real-machine run.
- [ ] Verify GitHub auto-update from `2.0.0-beta` to `2.0.0` on all three OSes, including
      `quality=stable` metadata (`scripts/ci/generate-update-metadata.mjs`) and the draft-release flow.
      Runbook is in `docs/release.md`.
- [x] Checksum and rollback runbook: `extensions/knox/docs/release.md` (SHA-256 next to assets; draft/delete a bad Release and retarget the update feed). `generate-update-metadata.mjs` now writes `sha256hash` on each `latest-*.json` and a `SHA256SUMS` file into the draft-release folder.
- [x] Attach checksums to an actual GitHub Release (done for `v2.0.1`; CI generates `SHA256SUMS` / `sha256hash` at draft time).

Done when: a release candidate is installed and updated on all three OSes from the previous beta.

### P0-4 Security review of the agent surface (DONE except two items needing a built app / release step)
- [x] Threat-model document: `extensions/knox/docs/security/threat-model.md` (vectors, controls, known limits, accepted risks).
- [x] `commandGuard` bypass corpus (`commandGuard.bypass.test.ts`, ~120 cases + benign corpus + adversarial/random-input robustness). Closed: wrapper options with values (`nice -n 5`, `sudo -u x`), here-strings into shells, `find -execdir/-ok` and nested dangerous `-exec`, `rm -r -f` / `--recursive --force`, base64/xxd payloads piped to a shell, downloads piped to python/node/perl/ruby/pwsh, git config keys that run programs (`core.sshCommand`, `alias.x=!`, ...), more destructive git (`checkout -f`, `branch -D`, `stash clear`, `reflog expire`, `filter-branch`, delete/mirror push, `reset --merge`), PowerShell `-EncodedCommand` and `iex` of downloads.
      Known limits (documented): variable indirection (`X=rm; $X -rf /`), interpreter running a script written earlier; stay in Edits or Ask for untrusted work. `git push --force-with-lease` stays allowed on purpose.
- [x] Path boundary: `isPathOutsideWorkspace` and the `~/.ssh` hard-deny now resolve symlinks (existing, not-yet-created and dangling) (`pathBoundary.test.ts`); worktree merge-back rejects `..`, absolute and symlinked paths (`isSafeWorktreeApplyPath`). Staged-edit apply now re-checks every file at write time (`checkStagedApplyTarget`: hard-deny paths and a directory swapped for a symlink out of the workspace are refused and stay staged; tests in `pathBoundary.test.ts`). Accepted: the file tools write through `IDE.writeFile` with no boundary check of their own (the policy layer is the single gate; paths the user approved outside the workspace must stay writable). Documented rather than duplicated in the host.
- [x] Hooks: editor is gated by VS Code Workspace Trust (`untrustedWorkspaces.supported: false`; hooks are read per turn, never on open). Team bundle import already skips hooks without `--allow-hooks`.
      Still open: verify in a real KnoxCoder build that an untrusted folder does not activate the extension.
- [x] Secret redaction: format corpus (`redactSecrets.formats.test.ts`: AWS, GCP, GitHub, Stripe, Slack, npm, JWT, PEM/OpenSSH, DB/Redis/Mongo URLs, `Authorization` any scheme, `x-api-key`, idempotence, benign text). Added rules for Stripe, `ya29.`, `Authorization: Token ...`, API-key headers, empty-user URLs; fixed a quadratic ReDoS in the `KEY=value` rules (200 KB input took 38 s). Exported Markdown sessions are now redacted (`knoxGuiRedact.ts`, a copy of the reference rules; its Electron test has not been run yet). Sinks table is in the threat model. Not redacted by design: checkpoints (byte-exact) and user messages at rest in the session file.
- [x] `~/.knoxcoder/auth.json`: atomic write with mode 0600 from creation (no window with default perms), permissions tightened on load if group/other-readable, test that credential sources never log key/token. The editor uses SecretStorage.
- [x] Security-review pass over the uncommitted diff: 0 high/critical, 1 medium (glued `git -calias.x=!cmd` bypassed the git exec-config guard in fullAuto). Fixed (`-cKEY=...`, `--config=`), with corpus cases.
- [x] Dependency audit (`npm audit --omit=dev` in `extensions/knox`): 3 high, all `node-forge` via `mac-ca`/`win-ca` (RSA signature verification, not used: only system root certs are read). No fix exists; recorded as an accepted risk. Root package (`npm audit --omit=dev`): 3 high/moderate fixable in range (`axios` 1.18.1 to 1.20.0 via dev-tunnels, `undici` 7.29 to 7.30, `ip-address` 10.5 to 10.7.3); lockfile updated with `npm audit fix --package-lock-only` (re-run `npm ci` and a build before release). Remaining 2 moderate: `uuid@3` under `@microsoft/dev-tunnels-connections`, no fix upstream (tunnels feature is not used by Knox). License check of the extension's installed packages: no GPL/AGPL/unlicensed; `node-forge` is `BSD-3-Clause OR GPL-2.0` (we take BSD-3); MPL-2.0 x2 are unmodified. `ThirdPartyNotices.txt` stays the VS Code editor inventory. Knox production deps: `extensions/knox/docs/third-party-notices.md` (`npm run notices`).

Done when: written threat model plus no open high/critical findings.

### P0-5 Data safety and migration
- [ ] Define and test upgrade from `1.138.x` and `2.0.0-beta` data in `~/.knoxcoder`
      (sessions, Memory Brain sqlite, checkpoints, config.yaml). Add a schema version and an
      automatic backup before any migration.
      PARTIAL: fixtures from tags `v1.138.2` and `v2.0.0-beta` (`src/core/test/fixtures/migration/`, regenerated by `scripts/gen-migration-fixtures.mjs`, Brain DB built by each tag's own `createTables`) are exercised by `util/migration.fixtures.test.ts`: Brain backup + migrate + version stamp + row preservation, no second backup on reopen, sessions list/load/save/delete (legacy `session_id` entry preserved), and config.yaml left untouched. Memory Brain now has `PRAGMA user_version` (v1), an automatic `backups/` copy (newest 3) before migrating an unversioned DB, and a legacy-shape migration test (`brain/store/dbSafety.ts`). Explicit schema versions now exist (`util/schemaVersions.ts`): session files carry `schemaVersion: 1` (`sessions.json` stays a bare array so a downgrade still reads it); an unversioned or newer session file is copied once to `<file>.v<N>.bak` before it is rewritten, and newer files load best-effort with a warning. Checkpoints already had `schemaVersion: 2` per manifest and `indexVersion: 1`; the index is now backed up once (`index.json.v<N>.bak`) before being rewritten from an older/newer format. `config.yaml` keeps its `schema: v1` key: an unknown value is reported as a non-fatal config error, and `editConfigFile` (which drops comments) keeps a one-time `config.yaml.vpre-edit.bak` and writes atomically. Tests in `migration.fixtures.test.ts`. Checkpoint store upgrade is now tested without Electron (`npm run test:host`, `src/host/vitest.config.mts` with a stub `vscode`; `checkpoints/manager/persistence.migration.vitest.ts`): schema-1 inline manifests plus an unversioned index load, restore exact bytes, back the index up once and rewrite it as `indexVersion` 1; a missing index is rebuilt; schema-2 saves round-trip a 2 MB text file, a binary file and a deleted file; two windows writing concurrently keep all checkpoints and a delete is not resurrected. Still open: fixtures captured from real user installs rather than generated.
- [x] Memory Brain: (corruption recovery DONE: a corrupt DB is moved aside as `*.corrupt-<ts>` and recreated; busy DBs are never touched). WAL/size DONE (`dbSafety.ts`): pragmas `synchronous=NORMAL`, `wal_autocheckpoint=1000`, `journal_size_limit=64MB`; orphan `-wal`/`-shm` without a main DB are deleted, a WAL left by a crash is replayed by SQLite on open and folded in with `wal_checkpoint(TRUNCATE)` (tested with a copied live WAL); size cap `KNOX_BRAIN_MAX_BYTES` (default 256 MB, `0` disables) enforced on open **and** on each auto-consolidation tick. User-visible cap: `knoxchat.memoryBrain.maxBytes` (VS Code) overlays `MemoryConfig.max_bytes`; env still wins. Curated semantic facts, entities and procedures are never pruned (tested). Concurrent windows were covered by the init lock plus WAL + busy_timeout.
- [x] Checkpoints: disk-usage cap and pruning policy. `maxCheckpoints` and `maxStorageBytes` evict oldest-first, never pinned or the sole baseline, folding unique bytes into the successor first (already tested). New: quota enforcement first GCs orphan blobs before evicting, and records a `quota_exceeded` health issue when only pinned checkpoints remain.
      Still open: verify restore for large, binary and deleted files (fixtures).
- [x] Session store: session and `sessions.json` writes are now atomic (temp + fsync + rename, `util/atomicWrite.ts`), tested.
- [ ] Multi-window safety: two KnoxCoder windows on the same workspace.
      DONE for the checkpoint store: `core/util/fileLock.ts` (mkdir lock, owner PID + heartbeat, stale takeover, re-entrant, tested) guards manifest+blob writes, index writes, blob GC, delete and retention (`store/storeLock.ts`). Index saves merge checkpoints created by the other window and never resurrect ones this window deleted.
      Also done: Memory Brain open/backup/migrate runs under `brain.sqlite.init.lock` (steady-state access stays on SQLite WAL + busy_timeout); `sessions.json` read-modify-write (save/delete) uses `withFileLockSync`, and session files are written atomically. A real multi-process test (`fileLock.crossProcess.test.ts`: 4 child processes, async + sync lock, an unlocked control that loses updates, and a SIGKILLed holder) passes.
      Background-agent jobs store (`~/.knoxcoder/bg/<id>/job.json`): each save/load runs under `job.json.lock` and writes atomically (temp + fsync + rename), so two windows cannot tear the file.
      Still open: The Electron "multi-window safety" suite in `checkpointBaseline.test.ts` has not been run; the same behaviour is covered by `test:host`.

Done when: migration tests pass from fixtures of 1.138.2 and 2.0.0-beta data directories.

### P0-6 Honesty and dead code gate (DONE except two manual checks)
- [x] `unimplementedAdvancedTools` deleted (9 definition-only tools); honesty/routing/contract tests and docs updated.
- [x] Quarantined code resolved. `SmartToolRouter` was already gone (honesty gate pins it). `ReasoningEngine` deleted with its four unadvertised commands (`knox.analyzeTask`, `knoxchat.analyzeTask`, `knox.structuredSolve`, `knox.performTaskAnalysis`); a test pins that it stays gone. `RefactoringService` is kept: it backs four contributed commands (`knox.renameSymbol`, `extractMethod`, `moveFile`, `extractInterface`) with contract tests. Also removed a fabricated `contextSize: Math.random()` from context gathering.
- [x] Dead-code sweep: import graph from `src/extension.ts`, then files with zero importers anywhere (source, tests, GUI contracts) were deleted: 30 modules plus four legacy memory tool definitions. Kept on purpose: `CustomLLM` (contract KN-254, custom-provider path), `protocol/util.ts` (contract KN-230), anything a test imports.
      Still unreachable from product code but kept because tests import them: eval harness/live files, memory bench, `settingIds`, `localeParity`, `host/util/knoxHostExtension`, `checkpointTestHarness`. `toolCallValidation` deleted in 2.1 (core `tools/middleware.ts` already fail-closes missing required args).
- [x] `CHANGELOG.md` audit of `2.0.0-beta`, each claim checked against code (symbol/constant/command exists) and tests; findings:
      Verified present: shared `runAgentLoop`; `sharedLoop` removed; `builtin_tool_search`, deferred tools default; legacy memory tools hidden and routed to `builtin_memory`; `builtin_fetch_url` with `KNOX_FETCH_URL_ALLOW_PRIVATE`; hooks events; `KNOX_SUBAGENT_CONCURRENCY`; `.knox/agents`; staged edits; `/instructions` and the 2000/6000 token warnings; CLI exit codes; `knox bg`; Edits default; `commandGuard`; `redactSecrets`; Jev guard; compaction at 75%; `modelPricing.json`; prompt cache; oracle detection; memory bench + `KNOX_MEMORY_INJECT_CAP`; live eval env + results files; nightly and Knox CI workflows; team bundle limits; inline completion stats command and model setting; session size cap and search; startup budget script; `edit_file` atomic edits; shared truncation; packaging fixes (`2.0.0~beta`, AppX guard).
      Corrections to make in the 2.0.0 notes: (1) "Knox CI ... blocks packaging" is true for core/pkg/tsc/inventory-gate/`test:host` on Linux/Windows/macOS; GUI/contract tests still `continue-on-error` (see P0-1). (2) "Jev budget", "Review before edit", "background agents" are covered by core unit tests but their GUI parts (review panel, jobs panel, queue chip, turn summary card, donut meter) are only covered by the Electron contract tests, which CI does not gate; they need the manual QA script. (3) "Background agents ... no GUI yet" is accurate and remains P1-3. (4) No committed `history.jsonl` baseline exists yet (P1-6).
- [x] Manual check on a built app: Review-before-edit flow, queue chip persistence, turn summary undo, jobs panel cancel-one-child (GUI paths without CI coverage).
- [x] After the deletions `esbuild.mts --outputRoot` produced `extension.js` cleanly (resolves every import). Host type-check project: `extensions/knox/src/host/tsconfig.json` + `npm run test:host-tsc`. Packaged-extension node smoke: P0-2.
      `test:host-tsc` still reports existing unused locals / missing `knoxdev-package/fetch` types; it is not CI-gated yet.

---

## P1: Should ship in 2.0.0

### P1-1 (removed): Knox does not use MCP
Knox deliberately has no MCP client; nothing to build here.

### P1-2 (removed): Command execution sandbox
Out of 2.0.0. OS wrappers (`sandbox-exec` / `bwrap`), `knoxchat.sandbox`, and the composer chip
are gone. Network policy for `builtin_fetch_url` stays (`knoxchat.networkMode`,
`knoxchat.networkAllowlist`). Shell safety is command guard + permission prompts.

### P1-3 GUI for features that were CLI-only
- [x] Background agents: list/merge/discard in the jobs panel (`kind: bg`) plus command palette
      (`knox.bg.list|merge|discard`). Starting a new background job is not in 2.0.0.
- [x] Team bundles: **Knox: Export/Import Team Bundle** with dry-run / overwrite and an allow-hooks prompt.
- [x] Custom agents: **Knox: List/Create Custom Agent** (template + validation). A dedicated sidebar
      panel is still 2.1.
- [x] Hooks: "Test" on the hooks panel (`agent/hooks` action `test`) and **Knox: Test Hook**.
- [x] Settings: **Knox: Open Knox Settings** (`@id:knoxchat` search). Grouped picker
      over the native Settings UI (2.1). Dead keys `knoxchat.sandbox` and
      `knoxchat.sharedLoop` are contributed with deprecation messages (ignored).

Done when: the command palette covers export/import/agents/hooks/bg list-merge-discard.

### P1-4 (removed): Headless CLI and CI usage
Out of 2.0.0. `@knoxchat/cli`, `knox run`, `knox doctor`, and the GitHub Action example are gone.

### P1-5 Reliability and performance targets
- [x] Cold activation budget measured in CI on all OSes (<= 500 ms module load, bundle <= 16 MB, as in
      `startupBudget.test.ts`); fail on regression. `packaged-extension-smoke` now runs `measure-startup.cjs` after `esbuild --skip-native` on Linux/Windows/macOS.
- [ ] Memory and CPU: long-session soak test (1000 turns, large repos) for memory leaks in the webview and
      host; Memory Brain retrieval latency budget on 100k items.
      PARTIAL (Node, no hardware, both in `test:core`): `agent/loop.soak.test.ts` runs 1000 real `runAgentLoop` turns with
      the default compactor and a scripted model: history capped at 112 messages, heap after forced GC grew 0.3 MB from turn 200 to 1000 (budget 25 MB).
      `context/memory/bench/brainScale.test.ts` seeds 100k rows (20 real needles + generated filler with overlapping vocabulary; 64 MB DB, seed ~7 s).
      First run found two scale defects, both fixed: (1) the trigram candidate pool and `searchSemantic` took LIKE matches ordered by importance, so common
      words in filler crowded out the relevant memory (q-log lost its memory, the LIKE fallback injected filler) and every query paid a full-table scan;
      they now take candidates from FTS5 in BM25 order, and the LIKE scan only runs for FTS-less builds or brains of <= 5000 rows (where a zero-hit FTS query is retried with substring LIKE).
      Before -> after at 100k: pre-turn p50 271 -> 68 ms, p95 365 -> 142 ms; `searchSemantic` p95 441 -> 75 ms; needle recall 0.867 -> 0.933.
      Budgets in the test: pre-turn p95 < 750 ms, max < 1.5 s, recall >= 0.9. Known remaining miss: a 7-term OR query (`q-multi`) where the needle matches one term while
      random filler matches several is outranked by BM25. 2.1 follow-up: tried reserving per-term FTS slots for long OR queries; it did not help (the needle
      matches only "database", a word in ~30% of the filler, so it is not in any single term's top hits either) and was reverted. It stays a documented synthetic limit.
      2.1 follow-up (episodic + graph): the bench now seeds episodic rows (N/3) and times `searchEpisodic`. This found a much bigger defect than the LIKE scans:
      the FTS5 episodic query (`fts5SearchEpisodic`, used by every pre-turn) with a session filter made SQLite walk the session index and probe FTS once per row
      (30k items: episodic p95 6.6 s, pre-turn p95 4.9 s). The MATCH now runs first in a CTE: 30k -> episodic 5 ms, pre-turn p95 35 ms; 100k -> episodic p95 14 ms,
      pre-turn p95 104 ms. `searchEpisodic` takes FTS5 candidates above 5000 rows (LIKE below), and graph expansion's per-neighbour memory lookup uses an FTS5 phrase
      query above 5000 rows (the whole-name post-filter is unchanged). Budget added: episodic p95 < 750 ms. Graph expansion at scale is not benchmarked (the bench has no
      entities). Still open: webview heap soak (needs Electron), real large-repo CPU profile.
- [ ] Large repo behavior: repo map, `exact_search`, `glob` on 500k files, monorepos; respect `.gitignore`
      and `.knoxignore`.
      PARTIAL: `glob` already honors both (including nested `.knoxignore`) and has a 100k walk cap; with `target_directory: "."` it walks every workspace root. `exact_search` honors `.gitignore` and `.knoxignore` at the search root and nested `.knoxignore` (patterns prefixed to cwd; tests incl. a 20k-file tree), with timeout and output cap.
      500k-file run DONE (2026-10-07, macOS, `tools/largeRepo.test.ts`, opt in with `KNOX_LARGE_REPO_FILES=500000`; synthetic monorepo of 500 packages plus a gitignored `build/` and a `node_modules/` per package, no git repo): seed 27 s; `exact_search` for one needle 11 s (60 s budget); `glob` with a narrow `target_directory` 15 ms; `glob` over the whole workspace stops at the 100k walk cap in 0.7 s and says so (98.5k of 500k `.ts` files are reported, so a whole-workspace glob is incomplete on a repo this size by design). Found and fixed: `exact_search` did not skip `node_modules` when no `.gitignore` listed it (the 500k run returned only vendored hits); it now skips `node_modules` by default like `glob`, unless the path or `fileGlob` targets it. Repo map timing DONE (same test): cold paths-only 1.5 s, cold with signatures 1.2 s (tree-sitter runs on the 80 hottest files only), cached 1.1 s (walk + stat still run), zoom into one package 25 ms. The map covers the first 100k files the walk returns (`walkDir` cap), so large repos need `path` to reach the rest. Found and fixed: `pruneLinesFromTop/Bottom` (`llm/countTokens.ts`) drifted over budget (100k lines pruned to 50k tokens returned 88k; the repo map was 13% over its half-context budget); they now binary-search and re-count (`llm/pruneLines.test.ts`). Still open: Windows/network disks and a real (non-synthetic) 500k monorepo.
- [ ] Webview watchdog: confirm recovery paths (`webviewWatchdog.ts`) with a real crash test.
      NOT DONE in 2.1 (2026-10-07): it needs a built KnoxCoder window with a renderer that really stops sending heartbeats (DevTools `Page.crash` or a blocked webview thread), driven over remote debugging. That cannot run headless in CI or in this environment and was not faked. Manual recipe: launch with `--remote-debugging-port=9222`, open the Knox chat, run `Page.crash` on the webview target, expect up to 2 automatic reloads then the crash placeholder with a Reload button; hidden or unfocused windows must never reload.
      PARTIAL: `host/webviewWatchdog.driver.vitest.ts` drives the real provider loop with fake timers (dead renderer: 2 reloads, then crash placeholder, stable, Reload button recovers; hidden/unfocused never count as crashes; healthy never reloads). Still open: kill a real renderer in Electron.
- [ ] Cancel semantics: Stop during streaming, tool run, subagent, review panel; no orphaned processes.
      DONE (core): foreground shell abort and hook timeouts kill the whole process tree (test: no orphaned grandchild); `deactivate` kills all shell jobs and child agents. Stop during streaming: `host/extension/sharedChatTurn.stop.vitest.ts` (mid-stream, before first chunk, provider ignoring the signal, tool-call round, retry backoff, running tool, no-op); it found and fixed Stop ending as an error / hanging. Still open: verify on Windows/macOS with a real window close; review panel Stop.

### P1-6 Model and provider coverage
- [x] Provider matrix tests (construct, no live network): OpenAI / Anthropic / OpenRouter / KnoxChat / mock, plus OpenAI-compatible custom `apiBase` for Ollama / LM Studio (`openai-adapters/index.test.ts`, `llm/llms/providerMatrix.test.ts`). Live tool-calling/streaming/caching per provider still open.
- [ ] Image and file attachments: verify vision input end to end per provider; paste and screenshot
      (macOS-only screenshot capture today).
      PARTIAL (2026-10-07, `llm/imageSupport.test.ts`, no live network): request shapes are verified for the OpenAI format (`image_url`, text-only fallback for servers without vision) and Anthropic. Found and fixed a bug: both Anthropic paths (`core/llm/llms/Anthropic.ts`, `pkg/openai-adapters/apis/Anthropic.ts`) labelled every image `image/jpeg`, but screenshots are PNG, so Anthropic would reject them (media type now comes from the data URI; http(s) URLs pass as `url` sources). Still open: a live call per provider with a real image, screenshot capture on Windows/Linux, OpenRouter/KnoxChat per-model catalog flags.
- [ ] Live eval baseline for 2.0.0: run `npm run test:live` against the default model(s), commit
      `history.jsonl` and set pass-rate and token thresholds for stable.
- [x] Offline/local-model path: confirm Knox works with no Jev and no Knox login (BYO key only).
      `agent/offlineByoKey.test.ts` runs a full tool turn (`runAgentLoop` plus a real OpenAI-compatible client) against a local HTTP server with Knox/Jev keys unset and `fetch` and sockets blocked for every non-loopback host: it completes, the BYO key is the only credential sent, and nothing leaves loopback. Not covered: the GUI first-run and the Memory Brain LLM extraction path with no model reachable.
- [x] Rate-limit and quota UX: surface 429/402 with provider-specific guidance and cost so far
      (dialog hint + copyable diagnostic `costSoFar=`).

### P1-7 Context and memory quality
- [x] Memory Brain: global off (`knoxchat.memoryBrain.enabled`), per-workspace opt-out
      (`knoxchat.memoryBrain.workspaceEnabled`), export/wipe commands, first-run notice.
- [x] Extend the Memory benchmark with real-world fixtures; set stable thresholds for recall/precision.
      `bench/fixturesRealWorld.ts`: 22 terse, typo-laden, near-duplicate, superseded and Chinese memories and 19 conversational queries (hand-written, not captured user data). Absolute floors in `memoryBench.test.ts`: recall >= 0.7, precision >= 0.5, false-inject <= 0.1, plus nine must-hit queries. Measured: recall 0.75, precision 0.545, false-inject 0. Known misses are recorded in the test: three semantic gaps (invoice total vs integer cents, icon-only button vs a11y, settings card vs design system; need embeddings) and **Chinese queries retrieve nothing** (the query cleaner drops CJK and FTS5 `unicode61` indexes a CJK run as one token; needs a CJK-aware tokenizer or bigram index plus a migration, not done: a `contentWords`-only change did not help). Fixtures from real user memories are still open.
- [x] Compaction quality eval: `eval/compactionQuality.test.ts` — a long scripted
      session is compacted (file path + intent survive) and `runAgentEval` still
      lands the original `src/add.ts` edit. Live-LLM golden sessions are not in 2.1.
- [x] `AGENTS.md` / `CLAUDE.md` already load. Opt-in `knoxchat.compatInstructions`: `cursor`
      (`.cursor/rules`, `.cursorrules`) and `copilot` (`.github/copilot-instructions.md`); listed in `/instructions`.

### P1-8 Privacy and telemetry
- [x] Network destinations: `extensions/knox/docs/network.md` plus `knoxchat.networkMode` (not a process-wide firewall).
- [x] VS Code crash reporter is disabled in product code; docs state Knox sends no Microsoft telemetry.
- [x] Anonymous usage stats: none (`docs/privacy.md`). Opt-in telemetry is **out of scope** — do not add collectors, events, or settings.
- [x] `product.json` `reportIssueUrl` now points to `knoxchat/knoxcoder` issues.
- [x] Root README no longer links to Microsoft VS Code docs; `releaseNotesUrl` / `downloadUrl` already Knox.

### P1-9 Accessibility, i18n, UX polish
- [ ] Keyboard-only walkthrough of chat, permission prompts, review panel, jobs; screen reader labels.
      PARTIAL (2026-10-07, static audit of `browser/gui/widget/**`, no screen reader run): found five mouse-only click targets (activity step row, input code-block head, job title, search-result line, analysis group card). They now go through `widget/a11y.ts` `makeKnoxGuiActivatable` (focusable, `role=button`, Enter/Space, `aria-expanded` on disclosure headers). The other flagged rows already contain real buttons. Every `outline: none` rule has a visible replacement (border or shadow) except container/programmatic-focus cases. Still open: a real keyboard-only and VoiceOver/NVDA pass, focus order in dialogs, live-region announcements for streaming and permission prompts.
- [ ] High-contrast and light themes: the chat UI was tuned for One Dark; verify all built-in themes.
      PARTIAL (2026-10-07, contrast audit, not a visual check): 85 text uses of the brand teal `#159994` (3.5:1 on white) bypassed `--knox-accent`; they now use it, so Light themes get `#0f7a76` (5.2:1). 41 status text colours tuned for dark themes (e.g. `#f87171` 2.8:1, `#22c55e` 2.3:1) had no light override; a "Light-theme text contrast" block at the end of `knoxGui.css` darkens them to >= 4.5:1, and `.knox-gui-tree-notice.is-light` went from 3.2:1 to 5.7:1. `util/guiThemeContrast.test.ts` fails on any new low-contrast `color:` literal without a light override. Still open: background/border contrast and icon colours, Solarized/Monokai and High Contrast screenshots by eye, forced-colors mode.
- [x] i18n: `en` / `zh` parity test exists; Knox ships **en and zh only** (stated in `docs/README.md`).
      Extra locales (ja, ko, es, …) are **out of scope** — do not add catalogs. Host-side strings
      (`package.nls.json`, `package.nls.zh-cn.json`) parity is gated by `localeParity.test.ts`.
- [x] First-run experience: empty chat offers KnoxStudio sign-in vs add-model (BYO key), permission/memory notices, and sample prompts when a model exists.
- [x] Error taxonomy: stream failures have a `kind` (rate-limit, quota/402, unauthorized, not-found, overloaded, generic), a localized hint, and **Copy diagnostic**.

### P1-10 Documentation
- [x] Root `README.md` links Knox docs (privacy, network, security, release).
- [x] `extensions/knox/docs/README.md` is a docs set (quickstart, network, privacy, release).
- [x] Security and privacy pages (threat-model, network, privacy, `SECURITY.md`).
- [x] Release notes for 2.0.0 (draft `docs/release-notes-2.0.md`; collapse beta notes at tag time) and an [upgrade guide](extensions/knox/docs/upgrade.md).
- [x] `SECURITY.md`: KnoxStudio reporting address and supported versions table.

---

## P2: Can slip to 2.1

- [x] In-editor assist without FIM (2.1): CodeLens + ⌘I scoping + one next related edit after
      Accept. Ghost-text stays off by default; not a product surface.
- [x] Local `uses:` registry: `RegistryClient` loads `~/.knoxcoder/registry/<owner>/<package>.yaml`
      (or `<package>@<version>.yaml`). Unsafe slugs are refused. Remote HTTP fetch is still
      rejected (missing local file is an error, not a download). Remote/team registry remains 2.2.
- [x] Multi-root workspaces: active-file folder is the primary root (`host/util/workspaceRoots.ts`, `primaryWorkspace.ts`), roots named in the system prompt, tests in `workspaceRoots.vitest.ts` and `systemPrompt.test.ts`. Per-root `.knoxignore` (search/glob/walk), instruction files (`discoverRules` already looped dirs; nested `AGENTS.md` walks the open file's URI), hooks (merged from every root with per-root `cwd`), custom agents (`.knox/agents` in every root), glob default, and post-edit oracle detection. Command-palette team/agent/hook actions use `primaryWorkspaceFsPath()`. Still open: a manual check in a real multi-root window.
- [ ] Remote / SSH / dev container / WSL support for Knox host (`virtualWorkspaces` unsupported).
- [x] Agent sharing: GUI export redacts; `/share` redacts; **Import Session Transcript** restores
      a file; **Copy Session Share Link** / `/share` emit `knoxcoder://vscode.knox/session/import?path=`
      (local file only; URI handler imports it). No hosted shareable URLs.
- [ ] Scheduled and triggered agents (cron, on-PR) built on background runs.
- [ ] Code-intel tools (`builtin_analyze_code` family) if there is a real use case beyond LSP tools.
- [x] More languages for the post-edit oracle: Maven (`pom.xml`), Gradle (`build.gradle` / wrapper), Zig (`build.zig`), .NET (`*.csproj`/`*.sln`) in `oracleDetect.ts`, plus detection across every workspace root (not only `[0]`). Systems profile (Cargo/Go/Node/Python + C/Make) unchanged.
- [x] Opt-in anonymous telemetry: **out of scope**. Knox sends no usage telemetry; do not implement collectors, events, or an opt-in setting.
- [x] Additional locales: **out of scope**. Product stays English and Chinese only; do not translate further catalogs.

---

## Release checklist (final gate for 2.0.0)

- [ ] All P0 items closed; every P1 item closed or explicitly moved to 2.1 with a note here.
- [ ] CI green on Linux/Windows/macOS for the release commit; live eval run recorded.
- [ ] Manual QA script run on each OS: install, sign-in, BYO key, chat, edit with review, shell approval,
      destructive command denial, checkpoint undo, Memory Brain, subagent worktree, hooks,
      update from `2.0.0-beta`.
- [ ] Clean-machine install test (no `~/.knoxcoder`) and upgrade test (existing data).
- [x] Version bumped to `2.0.0` everywhere; `CHANGELOG.md` finalized; tag `v2.0.0`. Assets, checksums
      and update metadata are a GitHub Release step after the tag is pushed.
- [x] Known-issues list written: `extensions/knox/docs/known-issues.md` (also wrote `upgrade.md` and `release-notes-2.0.md`, which earlier notes referenced but were missing).

Local gate re-run (2026-10-05): `test:tsc`, `test:core` (214 files / 1850 tests), and GUI/contract tests (448) all pass.
Release tooling (2026-10-05): `scripts/ci/release-check.mjs` bumps the version / promotes the CHANGELOG (`--bump 2.0.0 --write`) and
verifies the release commit (`--tag v2.0.0`: version == tag, dated CHANGELOG, `quality: stable`, SECURITY.md series); unit-tested in Knox CI. `test:host-tsc` reports ~340 errors (missing `knoxdev-package/*` path mappings,
missing `override`, unused params, a stale `core/protocol/messenger` import in `host/webviewProtocol.ts`, undefined `VsCodeWebviewProtocol` in
`host/commands.ts`); the shipped bundle builds with esbuild, so this is 2.1 cleanup, but the last two look like real dead references to check.
2.1 progress: `test:host-tsc` now reports 0 errors and is a Knox CI step; the two suspected dead references (`host/webviewProtocol.ts`, `host/commands.ts`) were false alarms caused by missing path mappings. Real bugs found and fixed: undisposable status-bar subscriptions and the dead `initImmediate` i18next option (now `initAsync: false`).
Version bump and tag `v2.0.0` are done. Remaining after the tag are human/hardware steps: 3 green CI runs, drop
`continue-on-error` on the `gui` job, clean-machine install/upgrade/update runs on all three OSes, notarization
and signing, live eval baseline, then attach assets and `SHA256SUMS` to the GitHub Release.

---

## Suggested order

1. P0-1 (green baseline), then P0-2 (CI matrix): everything else depends on trustworthy tests.
2. P0-6 (remove dead code and verify changelog claims), P0-5 (data migration).
3. P0-4 (security).
4. P1-3, P1-6, P1-7 (product completeness).
5. P1-5, P1-8, P1-9, P1-10 (hardening, docs).
6. P0-3 (release pipeline rehearsal) with a `2.0.0-rc.1`, then the final checklist.

---

## 2.0.1 patch release

Scope: everything committed after `v2.0.0` (stop/orphan fixes, Marketplace `vscodeVersion` fix, Memory Brain and `exact_search` scale work, `test:host-tsc` clean, manual-only packaging).

- [x] Local gate (2026-10-06): `test:tsc`, `test:core` (210 files / 1819 tests), `test:host-tsc`, `test:host`, `test:pkg` green.
- [x] Version bumped to `2.0.1`, `CHANGELOG.md` promoted and tidied (`release-check.mjs --bump 2.0.1`); `release-check.mjs` passes.
- [x] Commit and tag `v2.0.1` (`e7a12d43`, 2026-10-06).
- [x] Run `Build desktop apps` manually on the tag; macOS: `build_dmg.sh`, notarize, staple.
- [x] GitHub Release `v2.0.1` published with assets, `SHA256SUMS`, `latest-*.json` (`quality=stable`).
- [ ] Verify auto-update 2.0.0 -> 2.0.1 on macOS, Windows, Linux.
- [ ] Verify a VS Code Marketplace extension installs in the built app.
- [ ] Built app: Stop mid-stream and window close with a running shell leave no orphans.
- [ ] Clean-machine install and upgrade with existing `~/.knoxcoder`.

Shipped. Remaining 2.0.1 rows are post-release QA (auto-update, Marketplace, orphans, clean-machine). Everything still open in P0/P1 above carries over to 2.1.

---

## 2.1 (in progress)

`v2.0.1` is tagged and published. This section is the next product slice (no 2.1 version bump yet). Post-release QA still listed under 2.0.1.

- [x] Nested `.knoxignore` for `exact_search` (prefixed `--ignore-file`; `ripgrep.test.ts`).
- [x] Per-root hooks: merge every workspace `.knox/hooks.json` / `.knox/config.yaml` with per-root `cwd`.
- [x] Per-root instruction files tested; nested `AGENTS.md` walks the open file's URI (not the relative path joined to every root).
- [x] Glob default walks every workspace root; custom agents load `.knox/agents` from every root; oracle detection scans every root; command palette uses the primary (active-file) folder.
- [x] `/share` redacts secrets (`share.test.ts`). GUI Markdown export already redacted. Shareable
      local links: `knoxcoder://vscode.knox/session/import?path=` from `/share` and
      **Knox: Copy Session Share Link**; the URI handler imports the file. Hosted links are out of 2.1.
- [x] Post-edit oracle: Maven, Gradle, Zig, .NET (`oracleDetect.test.ts`).
- [x] Deleted unused host `toolCallValidation` (core middleware already validates).
- [x] Local gate (2026-10-07): `test:tsc`, `test:core` (216 files / 1855 tests), `test:host-tsc`, `test:host` green.
- [x] In-editor assist (no FIM model): `core/edit/assist/editAssist.ts` finds empty files, stub functions (empty / `pass` / not-implemented / `todo!()`) and TODO/FIXME comments; `EditAssistCodeLensProvider` shows **Knox: Generate this file / Implement / Do this TODO / Fix this error** (errors from diagnostics, max 5). Each lens runs the edit model through the vertical diff (`knox.editAssist.run`). ⌘I with an empty selection inside one of these scopes the edit range to it. After Accept, one notification offers "Show one edit" (a single related change as a reviewable diff, never chained, never while typing). Settings: `knoxchat.editAssist.codeLens`, `knoxchat.editAssist.nextEdit` (catalog is now 61 including two deprecated keys). Tests: `edit/assist/editAssist.test.ts`. Not verified in a running editor yet; ⌘I does not prefill the composer text (the GUI protocol has no prefill message), so the lens carries the canned prompt.
- [x] Custom agents sidebar: **Custom Agents** view in the Knox container (`CustomAgentsTreeProvider`: list across roots, file watcher, create/refresh in the title bar, open/delete inline).
- [x] Transcript import: **Knox: Import Session Transcript** reads a `/share` or Markdown-export file (`core/util/transcriptImport.ts`, text only, redacted, 5 MB / 2000 message caps) into a new session and focuses it. Accepts a file path argument from the share URI.
- [x] Grouped Knox settings: **Knox: Open Knox Settings** now shows a group picker (Editor assist, Agent and models, Verification, Memory and instructions, Network and privacy, Checkpoints, Deprecated, All) and opens the Settings UI filtered to that group's ids (`core/config/settingGroups.ts`). `settingGroups.test.ts` fails if a contributed setting has no group. This is a picker over the native Settings UI, not a custom webview page.
- [x] Dead-key deprecation: `knoxchat.sandbox` and `knoxchat.sharedLoop` remain in the catalog with deprecation messages and are ignored (Settings Sync / old settings.json).
- [x] Compaction quality eval: `eval/compactionQuality.test.ts` (scripted; no live LLM).
- [x] Local `uses:` registry: `~/.knoxcoder/registry/<owner>/<package>.yaml`. Remote HTTP registry, SSH/WSL, and scheduled agents are **not** in 2.1 (need a trust model / remote extension host / scheduler).
- [x] Locales: **en and zh only** (core, host, GUI, `package.nls`). Extra languages (ja, ko, es, …) are out of scope for 2.1 and later until explicitly requested; do not add translated catalogs.
- [x] Telemetry: **out of scope**. Do not add opt-in anonymous usage stats or any Knox telemetry (privacy docs stay "none").
- [ ] 2.0.1 hardware steps that still block a 2.1 tag: signing, notarization, clean-machine update runs on macOS/Windows/Linux (see 2.0.1 section). Live eval baseline and three consecutive green CI runs remain release-process items, not product code.

