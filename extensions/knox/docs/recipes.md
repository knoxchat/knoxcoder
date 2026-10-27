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
| Reuse a recipe on a repeat task | `knoxchat.recipes.autoReplay` | **Automatic** (`exact`) for a byte-identical match; **Ask** to preview first; **Adapt** to plan a small patch on close matches; Off only injects a hint |
| Let Knox review its own history | `knoxchat.selfImprove.enabled` | Optional |

They are the real VS Code settings, so this page and `settings.json` stay in sync. You can also search `knoxchat.recipes` in VS Code Settings.

### 2. Run a task that can be saved

In chat, ask Knox to **change code in this project**. A turn is saved only when all of these are true:

1. Knox actually wrote, patched, or deleted files (`builtin_edit_file`, `builtin_write_file`, `builtin_delete_file`, `builtin_apply_patch`, and similar).
2. A **check passed** afterwards: LSP diagnostics ("no diagnostics"), a build, or tests. If verification is skipped
   (C/asm without `knoxchat.verifyCommand`, rust-analyzer not ready, or `knoxchat.verifyMode` off), nothing is saved.
3. A checkpoint exists for the turn, the diff is not empty, and the files do not look like secrets.
   Lockfiles, `dist/`, and other generated churn are ignored so they do not swallow the recipe. A long
   turn still saves if a check passed — Knox diffs against the checkpoint taken when the turn started.
   `.env` and other secret files are never saved, even if you accept the diff.

Typical first recipe: "add a lint script to package.json" or "fix the failing test in Foo.test.ts", then wait until
the edit lands **and** the check is green. Executing an approved Plan counts the same way once the files land
and the check is green.

After that turn, open **Memory → Recipes**. You should see a **Candidate** (or a line explaining why it was not
saved: "did not edit files", "no passing check", and so on). Refresh if you were already on the tab.
**Save as recipe** records the last checkpoint (you are accepting that work). **Don't save** retires a candidate
you do not want remembered.

### 3. Get it to Verified

A candidate is not replayed. It becomes **Verified** when:

- you accepted the result (Accept on the diff, or **Verify** on the Recipes tab), or
- the **same task** (same intent) passed a check a second time.

Automatic reuse only looks at verified recipes.

### 4. Send the same task again

Now send the same (or very similar) request. After two similar successes (for example "create a Button
component" then "create a Card component"), Knox stores **one family** with slots (`componentName`) instead of
two unrelated snapshots. The next request can reuse that procedure with a new name or path.

With **Automatic**:

- Knox applies a **byte-identical** match **without a model call**, tells you in chat, and offers Undo.
- If the new request fills slots (a different component name, path, or package), it substitutes those values
  into the saved files, still with no model call, then **asks** before writing. Unsafe values (`../`, absolute
  paths, `$TOKEN`) are refused.
- If a slot is missing, you get a small card to fill it (guessed from the focused file or an example). Nothing
  is written until every slot has a value.
- If the target files changed but a clean 3-way merge exists, you see the merged diff and confirm.
- Close matches do **not** spend a model call unless you pick **Adapt**.
- The check runs again. If it fails, Knox restores a pre-replay checkpoint and continues with the model.

With **Ask**, you get a preview card (Apply / Skip), including slot fields, file checkboxes, and extra-file
approval when they apply. Close matches may be adapted, still with a preview. With **Adapt**, close or drifted
matches plan a small patch (one model call) and always ask; files the recipe did not write stay unchecked until
you approve them. With **Off**, the recipe is only shown to the model as an example.

If two disjoint recipes both match (for example a component and its test), the preview lists them in sequence.
Each keeps its own checkpoint and check; a failure stops the rest. Uncheck files on the card for a one-off
partial apply — the stored recipe is not rewritten.

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

When you later ask for the same thing, Knox decides before calling the model. Matching is lexical: the request's intent fingerprint, linked workflow memories, and overlap with files you mentioned or have open. If two recipes both look replayable, Knox asks instead of picking silently. A close miss (similar but not reused) is explained on the Recipes tab. A global recipe that does not fit this workspace is refused with the missing check (for example "framework react not detected"), not treated as "no match."

| Mode | What happens |
|---|---|
| exact | Applies the saved files. No model call. |
| adapt | One model call plans a small patch against the saved files. You always see a preview before anything is written. If planning fails, the recipe is shown to the model as an example. |
| suggest | The recipe is shown to the model as an example. |
| generate | Normal chat. |

`knoxchat.recipes.autoReplay` is `off` (examples only), `ask` (preview everything, including a possible adapt),
`exact` (auto-apply only a byte-identical clean replay; slotted, merged, and adapted work still ask), or
`adapt` (like Automatic, and also plan a small patch when the match is close or files conflict). The preview
listing is instant; Apply runs the real tools and the recorded check, which can take seconds. Adapt always asks
before writing. Extra files in an adapt patch are listed and stay off until you check them. An adapt replay
forks a `what-if/*` checkpoint branch so Undo is obvious on the Checkpoint Graph.

## Safety

- A pre-replay checkpoint is taken first. Undo restores it.
- Writes, deletes, and commands go through the normal tool path: permission mode, command guard, `.knoxignore`, path
  boundary and review mode apply. A write or delete held for review counts as not applied and is rolled back.
- The recipe's check runs again after the replay. If it fails, Knox restores the checkpoint and continues with
  the model, telling it what went wrong.
- If you changed a target file since capture, Knox does not overwrite it. Clean 3-way merges are previewed, then
  applied if you approve; conflicts fall back to the model (or to an adapt preview when Adapt/Ask is on).
- Undoing a replay within 10 minutes counts as a revert. A reverted recipe is quarantined and never replayed again.
- Delete steps go through `builtin_delete_file` (one workspace file, never a directory, never a secret file).
  Binary files, oversized files (over 512 KB each or 2 MB per recipe), and commands that use the
  network or carry secrets are never replayed.
- Verified recipes with at least 3 clean replays can be saved as a skill (`SKILL.md`) in `<workspace>/skills` or
  `~/.knoxcoder/skills`. You choose the destination; existing skills are never overwritten. A user-written skill that
  lists files and a verify command can be imported as a **candidate** recipe (`builtin_recipe` `import_skill`); it is
  never replayed until you verify it locally.

## Where to see and control it

- **Memory → Settings, "Reuse verified work":** remember, reuse (`off` / `ask` / `exact` / `adapt`), and self-improve (`knoxchat.recipes.enabled`, `knoxchat.recipes.autoReplay`, `knoxchat.selfImprove.enabled`). They are the real VS Code settings, so `settings.json` and this page always agree. Everything is off by default. Agent Settings does not list these.
- **Memory page, Recipes tab:** search, filter, and sort the library; variants of the same procedure are grouped. Click a row for the detail pane: intent, fingerprint, slots, preconditions, steps, the linked memory, and an inline preview of what replay would change. Rename, pin, or add a note. Add a slot or a file/dependency check if you want to turn a snapshot into a procedure without waiting for a second capture. **Use in all projects** (consent + those checks) and **This project only** change scope. The tab also explains the last capture skip and the last match skip (for example a 62% near-miss that was not reused). **Save as recipe** records the last checkpoint (you accept that work). **Don't save** on a new candidate forgets it. Chat toasts and checkpoint cards offer the same Save / Don't save. **Preview** / **Replay** apply a verified recipe (ask card + Undo). **Verify** accepts a candidate that already has a passing check. **Restore** moves a quarantined recipe back to candidate. **Save as project/global skill** is offered after three clean replays. Source checkpoint chips open that snapshot on the Checkpoint Graph; **Open memory** opens the linked workflow. **Quarantine** pauses a recipe; **Retire** removes it for good (asks first) and frees the checkpoint data it was holding. Only this project's recipes (and ones you promoted to all projects) are listed.
- **Checkpoint Dashboard, AI Sessions tab:** estimated tokens saved, model calls avoided, and the wrong-reuse rate (replays that failed their check, plus replays you later undid, divided by replays that changed files). Also capture skips, matcher near-misses, slotted replays, and how many recipes are this-project vs all-projects. Token numbers count output only and are estimates (4 characters per token).
- **Chat:** every turn with recipes on shows a compact card: reused, previewed, hinted, or skipped, with Undo when a replay applied. `@recipe` attaches a procedure to the turn. The agent can `builtin_recipe` list / preview / apply (apply still uses the ask card and the same replayer; it cannot write files itself).

## Self-improvement

With `knoxchat.selfImprove.enabled` (and recipes on), the memory sleep cycle reviews recorded failures: it stores an
`error_fix` memory for failures seen 3 or more times, quarantines failing recipes, and merges duplicate recipes
that are byte-and-path identical. Rejected diffs, Skip / Don't save, and edits of a replayed file are
`user_correction` events — three of the same signature can quarantine that recipe too. A successful replay
strengthens the linked workflow memory; a revert demotes it. Variants that look like one procedure but have no
slots yet are written as a local draft under `~/.knoxcoder/reports/` (nothing is merged until you approve).
Reports and issue drafts are drafts for you to approve; nothing is posted anywhere automatically.

Live eval of the generate side of typical recipe work (lint script, failing test, create a component):
`npm run test:live:recipes` from `extensions/knox` after Knox OAuth sign-in. No `KNOX_API_KEY`. To measure
match / replay / wrong-reuse in the editor, turn recipes on, use **Ask**, and run those three tasks twice.

## Privacy

Recipes are stored in the local Memory Brain database. Text is redacted before storing, and file contents stay in
checkpoint blobs. A recipe leaves the machine only if you share a checkpoint bundle that includes it; recipes in an
imported bundle start as `candidate` and are never replayed until verified locally.

Design rules for contributors: [recipes README](../src/core/context/memory/recipes/README.md).
