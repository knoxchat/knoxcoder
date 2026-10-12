# Recipes (verified, replayable work)

Status: **experimental, off by default** (`knoxchat.recipes.enabled`).

A recipe is a unit of work Knox did before, that a check passed on, and that can be traced to the checkpoint blobs
holding its bytes. Knox can reuse it instead of asking the model to generate the same thing again.

## Rules (every change here must keep these)

1. **Verified only.** A recipe is replayable only after an oracle passed (build, test, LSP, or user accept).
2. **Bytes live in checkpoints.** A recipe stores blob hashes and checkpoint ids, never copies of file contents.
3. **Checkpoint first.** Replay takes a pre-replay checkpoint so one click restores.
4. **Normal tool path.** Replay writes through `callTool` and middleware, so permissions, command guard, `.knoxignore`,
   path boundary, and review mode all apply. No raw `fs` writes.
5. **Roll back on failure.** If post-replay verification fails, restore and fall back to the normal model loop.
6. **Local by default.** Secrets are redacted before storing. A recipe leaves the machine only through an explicit,
   HMAC-signed bundle, and imported recipes start as `candidate`.
7. **No silent network.** Self-improvement output (reports, issue drafts) is a draft the user approves.

## Replay modes

`exact` (no model call) → `adapt` (model returns only the delta) → `suggest` (recipe injected as an example) → `generate`.
