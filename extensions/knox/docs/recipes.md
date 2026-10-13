# Recipes: reusing verified work

Experimental, off by default. Turn on with `knoxchat.recipes.enabled`.

## How to use it

Settings being on is not enough. **Sending the same chat message twice does not create a recipe.** Recipes
record *verified file-changing work*, then replay that work. Repeating a question, a review, or a chat that
only reads files will leave the Recipes tab at 0.

### 1. Turn the feature on

Open **Memory → Settings**. The first card is **Reuse verified work (experimental)**. Agent Settings (the chat gear) stays for global agent knobs only.

| Control | Setting | What to pick |
|---|---|---|
| Remember verified work | `knoxchat.recipes.enabled` | On |
| Reuse a recipe on a repeat task | `knoxchat.recipes.autoReplay` | **Automatic** (`exact`) to apply without a model call; **Ask** to preview first; Off only injects a hint |
| Let Knox review its own history | `knoxchat.selfImprove.enabled` | Optional |

They are the real VS Code settings, so this page and `settings.json` stay in sync. You can also search `knoxchat.recipes` in VS Code Settings.

### 2. Run a task that can be saved

In chat, ask Knox to **change code in this project**. A turn is saved only when all of these are true:

1. Knox actually wrote or patched files (`builtin_edit_file`, `builtin_write_file`, `builtin_apply_patch`, and similar).
2. A **check passed** afterwards: LSP diagnostics ("no diagnostics"), a build, or tests. If verification is skipped
   (C/asm without `knoxchat.verifyCommand`, rust-analyzer not ready, or `knoxchat.verifyMode` off), nothing is saved.
3. A checkpoint exists for the turn, the diff is not empty, and the files do not look like secrets.

Typical first recipe: "add a lint script to package.json" or "fix the failing test in Foo.test.ts", then wait until
the edit lands **and** the check is green.

After that turn, open **Memory → Recipes**. You should see a **Candidate** (or a line explaining why it was not
saved: "did not edit files", "no passing check", and so on). Refresh if you were already on the tab.

### 3. Get it to Verified

A candidate is not replayed. It becomes **Verified** when:

- you accepted the result, or
- the **same task** (same intent) passed a check a second time.

Automatic reuse only looks at verified recipes.

### 4. Send the same task again

Now send the same (or very similar) request. With **Automatic**:

- Knox applies the saved files **without a model call**, tells you in chat, and offers Undo.
- The check runs again. If it fails, Knox restores a pre-replay checkpoint and continues with the model.

With **Ask**, you get a preview card (Apply / Skip). With **Off**, the recipe is only shown to the model as an example.

If the target files changed since capture, Knox will not overwrite them blindly: clean 3-way merges apply; conflicts
fall back to the model.

### What you will not see a recipe for

- Questions, explanations, reviews, or any turn that did not mutate files
- Edits whose diagnostics/build/tests failed or never ran
- Turns with secrets, too many files (over 50), or no checkpoint
- A second identical **chat** before a first candidate exists — there is nothing to reuse yet

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

- **Memory → Settings, "Reuse verified work":** the three switches (`knoxchat.recipes.enabled`, `knoxchat.recipes.autoReplay`, `knoxchat.selfImprove.enabled`). They are the real VS Code settings, so `settings.json` and this page always agree. Everything is off by default. Agent Settings does not list these.
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
