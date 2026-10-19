# Knox 2.2

Full detail is in `CHANGELOG.md`; upgrade steps in [upgrade.md](upgrade.md); caveats in [known-issues.md](known-issues.md).

## 2.2.1

- Tool ports for file/shell/search/git/terminal/composite (K-084 stretch). Core still takes IDE for diagnostics, DAP, checkpoints, secrets, LSP, and repo map.
- Skip-to-composer, landmarks, named permission/jobs/checkpoint/recipe chrome, and built-in theme contrast checks (K-102). VoiceOver/NVDA still a human check.
- 1000-turn headless host soak plus a 40-turn GUI DOM fold (K-101). Not a real VS Code window soak.
- Recipe preview card shows on an empty transcript (MC-90).
- Auto-update reads `latest-*.json` from GitHub Releases, compares versions, and downloads that package (not the releases HTML page).

## 2.2.0 highlights

- **One product path.** Sidebar Agent uses the same loop as eval: oracle-hold after a red verify, auto-context on submit, a workspace card for Node/Python/Go/CMake (not only kernel/Cargo), and a Turn Context block.
- **Plan mode.** Composer toggle: read-only explore until **Execute plan**. Ask / Edits / Auto still apply at execute time.
- **Background start.** Composer **Run in background** and **Knox: Background Agents: Start** run `runChatTurn` in a seeded worktree (cap 2).
- **LSP when it matters.** Git status/diff stay in the deferred core set. `builtin_lsp` is promoted on classified workspaces and systems, not on unknown trees.
- **Chinese memory search.** sqlite FTS overlapping bigrams; no vector embeddings.
- **Live eval (manual).** After Knox OAuth, `cd extensions/knox && npm run test:live`. No `KNOX_API_KEY`. Nightly CI stays scripted.

## Not in 2.2

MCP, vector embeddings, env API keys, and P4 extras (browser, headless CLI).

## Verification

SHA-256 sums for every asset are in `SHA256SUMS` on the Release page.
