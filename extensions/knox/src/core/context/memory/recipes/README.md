# Recipes (verified, replayable work)

Status: **experimental, off by default** (`knoxchat.recipes.enabled`).

A recipe is a unit of work Knox did before, that a check passed on, and that can be traced to the checkpoint blobs
holding its bytes. Knox can reuse it instead of asking the model to generate the same thing again.

## Rules (every change here must keep these)

1. **Verified only.** A recipe is replayable only after an oracle passed (build, test, LSP, or user accept).
2. **Bytes live in checkpoints.** A recipe stores blob hashes and checkpoint ids, never copies of file contents.
3. **Checkpoint first.** Replay takes a pre-replay checkpoint so one click restores.
4. **Normal tool path.** Replay writes and deletes through `callTool` and middleware, so permissions, command guard, `.knoxignore`,
   path boundary, and review mode all apply. No raw `fs` writes.
5. **Roll back on failure.** If post-replay verification fails, restore and fall back to the normal model loop.
6. **Local by default.** Secrets are redacted before storing. A recipe leaves the machine only through an explicit,
   HMAC-signed bundle, and imported recipes start as `candidate`.
7. **No silent network.** Self-improvement output (reports, issue drafts) is a draft the user approves.

## Product surface (K-092 / MC-90)

Finish, do not expand. Recipes stay **off** by default (`knoxchat.recipes.enabled`). The product path is **exact** replay plus **ask** preview. `knoxchat.recipes.autoReplay` is `off | ask | exact | adapt`. Automatic still auto-applies only a byte-identical clean replay; parameterized slots, clean merges, and adapt always ask. Adapt is opt-in (`adapt`, or `ask` as a fallback): one model call plans a patch, then the same ask preview applies it. Extra files in that patch are listed and never written unless the user checks them. Matching is lexical (intent fingerprint + fusion hits + file/buffer overlap). Do not add embeddings, a vector store, or neural rerank. A short recipe stub is pinned in the turn inject so suggest/adapt still has a title and paths when the full hint is dropped.

The ask preview listing is ~1 ms (local blobs + current files). Apply runs the normal `callTool` path and the recorded oracle, which can take seconds — the preview card says so. Cross-project recipe ids are refused (MC-82): a project-scope recipe only applies in the workspace it was captured in. Two similar verified captures become one family with slots; parameterized exact substitutes safe identifier/path/package tokens into paths and file text, then the same exact replay path runs. Duplicate merge only retires byte-and-path identical recipes, so variants are kept. Capture ignores lockfiles and build output, can split a huge turn down to the files named in the request, and still diffs against the turn-start checkpoint when soul history is truncated. Command-only recipes (a passing check, no file writes) are opt-in and always ask before run. `.env`, other secret files, binary files, and oversized text (512 KB per file / 2 MB per recipe) never become a recipe, including manual save. Two disjoint verified recipes may compose in sequence, each with its own checkpoint and oracle, after the user sees the plan. An adapt replay forks a `what-if/*` branch so undo is visible on the Checkpoint Graph. The agent can list/preview/apply through `builtin_recipe` (apply still uses this replayer and confirm=true; no raw fs). `@recipe` attaches a procedure. Imported skills start as `candidate`. Compaction keeps recipe id and title in development-loop state. Sleep records user corrections, boosts linked memories on ok replay, drafts unmerged families for approval, and caps each family at 8 live variants so blob pins cannot grow without bound. Recipes stay **off** by default after the P7 security review; `ask` is the candidate default later, never silent exact.

## Replay modes

`exact` (no model call) → `adapt` (model returns only the delta) → `suggest` (recipe injected as an example) → `generate`.
