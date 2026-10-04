# Knox 2.0.0

Everything since **1.138.2**. Full detail is in `CHANGELOG.md`; upgrade steps in [upgrade.md](upgrade.md); caveats in [known-issues.md](known-issues.md).

## Highlights

- **One agent loop** for chat, subagents, eval and `/autonomous`, with retry, backoff and fallback model.
- **Deferred tools** and `builtin_tool_search`; `builtin_fetch_url` with SSRF guards.
- **Safer by default:** Edits mode, a shell command guard (Unix and Windows), secret redaction, path boundary checks, and network policy (`knoxchat.networkMode`).
- **Review before edit**, per-turn undo, checkpoints with quota and pruning.
- **Hooks, custom agents, isolated subagent worktrees,** team bundles, background-agent job list/merge/discard.
- **Data safety:** versioned sessions and Memory Brain, automatic backups before migration, atomic writes, cross-window locking.
- **Privacy:** no usage telemetry, no Microsoft telemetry, documented network destinations ([network](network.md), [privacy](privacy.md)).

## Verification

SHA-256 sums for every asset are in `SHA256SUMS` on the Release page.

On Windows, installers may show SmartScreen until signed: **More info, Run anyway**.
