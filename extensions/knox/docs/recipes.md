# Recipes: reusing verified work

Experimental, off by default. Turn on with `knoxchat.recipes.enabled`.

## What it does

After a chat turn that changed files and passed a check (build, test, or diagnostics), Knox saves a **candidate
recipe**: the list of files it wrote (as checkpoint blob hashes, not copies), the commands it ran, and the check.
A candidate becomes **verified** when you accepted the result, or the same task passed twice.

When you later ask for the same thing, Knox decides before calling the model:

| Mode | What happens |
|---|---|
| exact | Applies the saved files. No model call. |
| adapt | Not applied yet; the recipe is shown to the model as an example. |
| suggest | The recipe is shown to the model as an example. |
| generate | Normal chat. |

`knoxchat.recipes.autoReplay` controls exact replay: `off` (examples only), `ask` (shows a preview card with the
diff; nothing changes until you press Apply), `exact` (applies, then tells you, with Undo).

## Safety

- A pre-replay checkpoint is taken first. Undo restores it.
- Writes and commands go through the normal tool path: permission mode, command guard, `.knoxignore`, path
  boundary and review mode apply. A write held for review counts as not applied and is rolled back.
- The recipe's check runs again after the replay. If it fails, Knox restores the checkpoint and continues with
  the model, telling it what went wrong.
- If you changed a target file since capture, Knox does not overwrite it. Clean 3-way merges are applied; conflicts
  fall back to the model.
- Undoing a replay within 10 minutes counts as a revert. A reverted recipe is quarantined and never replayed again.
- Delete steps, binary files, and commands that use the network or carry secrets are never replayed.
- Verified recipes with at least 3 clean replays can be saved as a skill (`SKILL.md`) in `<workspace>/skills` or
  `~/.knoxcoder/skills`. You choose the destination; existing skills are never overwritten.

## Where to see and control it

- **Settings page, "Reuse verified work":** the three switches (`knoxchat.recipes.enabled`, `knoxchat.recipes.autoReplay`, `knoxchat.selfImprove.enabled`). They are the real VS Code settings, so `settings.json` and the page always agree. Everything is off by default.
- **Memory page, Recipes tab:** each recipe with its status, uses, reverts, failed checks and source checkpoints. **Quarantine** pauses a recipe; **Retire** removes it for good (asks first) and frees the checkpoint data it was holding. Only this project's recipes (and ones you promoted to all projects) are listed.
- **Checkpoint Dashboard, AI Sessions tab:** estimated tokens saved, model calls avoided, and the wrong-reuse rate (replays that failed their check, plus replays you later undid, divided by replays that changed files). Token numbers count output only and are estimates (4 characters per token).

## Self-improvement

With `knoxchat.selfImprove.enabled` (and recipes on), the memory sleep cycle reviews recorded failures: it stores an
`error_fix` memory for failures seen 3 or more times, quarantines failing recipes, and merges duplicate recipes.
Reports and issue drafts are drafts for you to approve; nothing is posted anywhere automatically.

## Privacy

Recipes are stored in the local Memory Brain database. Text is redacted before storing, and file contents stay in
checkpoint blobs. A recipe leaves the machine only if you share a checkpoint bundle that includes it; recipes in an
imported bundle start as `candidate` and are never replayed until verified locally.

Design rules for contributors: [recipes README](../src/core/context/memory/recipes/README.md).
