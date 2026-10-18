# Knox 2.2.0

Full detail is in `CHANGELOG.md`; upgrade steps in [upgrade.md](upgrade.md); caveats in [known-issues.md](known-issues.md).

## Highlights

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
