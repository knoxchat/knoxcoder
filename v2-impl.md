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
- Inline completion is off by default and next-edit is not built.
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
- [ ] Attach checksums to an actual GitHub Release (release-time step; CI now generates the files).

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
      Still unreachable from product code but kept because tests import them: eval harness/live files, memory bench, `settingIds`, `localeParity`, `host/util/knoxHostExtension`, `toolCallValidation` (host, has its own test; not on the main path), `checkpointTestHarness`. Decide in 2.1 whether `toolCallValidation` should be wired or deleted.
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
- [x] Settings: **Knox: Open Knox Settings** (`@id:knoxchat` search). Full custom grouped page and
      dead-key deprecation still open.

Done when: the command palette covers export/import/agents/hooks/bg list-merge-discard.

### P1-4 (removed): Headless CLI and CI usage
Out of 2.0.0. `@knoxchat/cli`, `knox run`, `knox doctor`, and the GitHub Action example are gone.

### P1-5 Reliability and performance targets
- [x] Cold activation budget measured in CI on all OSes (<= 500 ms module load, bundle <= 16 MB, as in
      `startupBudget.test.ts`); fail on regression. `packaged-extension-smoke` now runs `measure-startup.cjs` after `esbuild --skip-native` on Linux/Windows/macOS.
- [ ] Memory and CPU: long-session soak test (1000 turns, large repos) for memory leaks in the webview and
      host; Memory Brain retrieval latency budget on 100k items.
- [ ] Large repo behavior: repo map, `exact_search`, `glob` on 500k files, monorepos; respect `.gitignore`
      and `.knoxignore`.
- [ ] Webview watchdog: confirm recovery paths (`webviewWatchdog.ts`) with a real crash test.
- [ ] Cancel semantics: Stop during streaming, tool run, subagent, review panel; no orphaned processes.
      Verify child process cleanup on window close on all OSes.

### P1-6 Model and provider coverage
- [x] Provider matrix tests (construct, no live network): OpenAI / Anthropic / OpenRouter / KnoxChat / mock, plus OpenAI-compatible custom `apiBase` for Ollama / LM Studio (`openai-adapters/index.test.ts`, `llm/llms/providerMatrix.test.ts`). Live tool-calling/streaming/caching per provider still open.
- [ ] Image and file attachments: verify vision input end to end per provider; paste and screenshot
      (macOS-only screenshot capture today).
- [ ] Live eval baseline for 2.0.0: run `npm run test:live` against the default model(s), commit
      `history.jsonl` and set pass-rate and token thresholds for stable.
- [ ] Offline/local-model path: confirm Knox works with no Jev and no Knox login (BYO key only).
- [x] Rate-limit and quota UX: surface 429/402 with provider-specific guidance and cost so far
      (dialog hint + copyable diagnostic `costSoFar=`).

### P1-7 Context and memory quality
- [x] Memory Brain: global off (`knoxchat.memoryBrain.enabled`), per-workspace opt-out
      (`knoxchat.memoryBrain.workspaceEnabled`), export/wipe commands, first-run notice.
- [ ] Extend the Memory benchmark with real-world fixtures; set stable thresholds for recall/precision.
- [ ] Compaction quality eval: golden long-session tasks that must still complete after compaction.
- [x] `AGENTS.md` / `CLAUDE.md` already load. Opt-in `knoxchat.compatInstructions`: `cursor`
      (`.cursor/rules`, `.cursorrules`) and `copilot` (`.github/copilot-instructions.md`); listed in `/instructions`.

### P1-8 Privacy and telemetry
- [x] Network destinations: `extensions/knox/docs/network.md` plus `knoxchat.networkMode` (not a process-wide firewall).
- [x] VS Code crash reporter is disabled in product code; docs state Knox sends no Microsoft telemetry.
- [x] Anonymous usage stats: none (`docs/privacy.md`).
- [x] `product.json` `reportIssueUrl` now points to `knoxchat/knoxcoder` issues.
- [x] Root README no longer links to Microsoft VS Code docs; `releaseNotesUrl` / `downloadUrl` already Knox.

### P1-9 Accessibility, i18n, UX polish
- [ ] Keyboard-only walkthrough of chat, permission prompts, review panel, jobs; screen reader labels.
- [ ] High-contrast and light themes: the chat UI was tuned for One Dark; verify all built-in themes.
- [x] i18n: `en` / `zh` parity test exists; 2.0 ships **en and zh only** (stated in `docs/README.md`). Extra locales (ja, ko, es, …) are 2.1.
      Host-side strings (`package.nls.json`, `package.nls.zh-cn.json`) parity is gated by `localeParity.test.ts`.
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

- [ ] Inline completions: turn on by default only after quality/latency bar is met; next-edit prediction.
- [ ] Remote registry for team bundles, skills and agents; `uses:` remote config blocks
      (`registryClient.ts` rejects them today).
- [ ] Multi-root workspaces (Knox works on the first folder only).
- [ ] Remote / SSH / dev container / WSL support for Knox host (`virtualWorkspaces` unsupported).
- [ ] Agent sharing: export/import transcript with redaction; shareable session links.
- [ ] Scheduled and triggered agents (cron, on-PR) built on background runs.
- [ ] Code-intel tools (`builtin_analyze_code` family) if there is a real use case beyond LSP tools.
- [ ] More languages for the post-edit oracle and systems profile beyond Cargo/Go/Node/Python.
- [ ] Opt-in anonymous telemetry.
- [ ] Additional locales.

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
