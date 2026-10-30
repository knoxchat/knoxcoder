# Privacy

Knox stores its data under `~/.knoxcoder` (override `KNOX_GLOBAL_DIR`):
config, sessions, Memory Brain sqlite, checkpoints, credentials, job logs.

- Memory Brain: local sqlite. Off: `knoxchat.memoryBrain.enabled` or
  `knoxchat.memoryBrain.workspaceEnabled` (this folder) or `KNOX_BRAIN_ENABLED=0`.
  `builtin_memory` delete / forget and TTL tombstone the row (reversible via
  audit). **Wipe** (`knox.memoryBrain.wipe`) is destructive: it writes
  tombstones, copies a backup under `~/.knoxcoder/memory/backups`, then
  recreates an empty database. Export / wipe from the command palette.
- Checkpoints: byte-exact, not redacted (by design).
- Session files: user messages at rest are not redacted; tool output is.
- Session share links (`knoxcoder://vscode.knox/session/import?path=`) point at a local Markdown file. Knox does not upload transcripts.
- `~/.knoxcoder/auth.json`: Knox OAuth session, mode 0600. The editor uses SecretStorage instead. No `KNOX_API_KEY` and no `.env` API key.
- Recipes (experimental, `knoxchat.recipes.enabled`): local sqlite only, text redacted, file bytes stay in checkpoints. Shared only by an explicit checkpoint bundle; imported recipes start as candidates. Self-improve family drafts stay under `~/.knoxcoder/reports/`. See [recipes.md](recipes.md).
- Telemetry: none from Knox, and none planned (no opt-in usage stats). VS Code crash reporter is disabled. See [network.md](network.md).

Issue reports go to https://github.com/knoxchat/knoxcoder/issues (not Microsoft).
