# Knox user guide

Knox is the coding agent built into this editor. This guide covers setup,
permissions, project instructions, hooks, memory, checkpoints and
troubleshooting. Setting names are `knoxchat.*` in Settings.

## Setup

1. Open the Knox chat and sign in (or add a model in the config page).
2. Pick a model from the composer. Optionally set `knoxchat.fallbackModel`
   (a model title) to use after repeated transient stream failures.
3. Open a folder. In a multi-root workspace the folder of the active file is the primary root.

## Docs set

- [Network](network.md) — every outbound call and `knoxchat.networkMode`
- [Privacy](privacy.md)
- [Threat model](security/threat-model.md)
- [Release](release.md) — version scheme, checksums, rollback
- [Third-party notices](third-party-notices.md) — Knox bundled production licenses
- [Testing policy](testing-policy.md)
- [Upgrade guide](upgrade.md), [2.0 release notes](release-notes-2.0.md), [Known issues](known-issues.md)

Knox ships **English and Chinese** only (`en` / `zh`, plus `package.nls.json` / `package.nls.zh-cn.json`). Extra locales are out of scope.

## Permission modes

| Mode | Reads | Edits | Shell |
|---|---|---|---|
| Ask | auto | asks | asks |
| Edits | auto | auto | asks |
| Auto (default, YOLO) | auto | auto | auto |

New sessions start in Auto for folders Knox has already used, or whose git
remote is in `knoxchat.trustedGitRemotes`. A **fresh clone** (no prior Knox
sessions, remote not allowlisted) starts in **Ask**, with a one-line notice
on the permission bar. `knoxchat.permissionDefault` (`auto` / `ask` / `edits`)
overrides that heuristic. Saved modes for the folder still win. Switch
Ask / Edits / Auto from the permission bar, or Shift+Tab.

**Plan** is a composer toggle next to those modes, not a fourth permission.
In Plan mode the agent may only read, search, ask, and write a `builtin_plan`
checklist (explore/review children only). Writes, shell, PTY, and QEMU are
refused with “leave Plan mode to execute.” When a plan still has remaining
steps, **Execute plan** switches back to Agent on the same session and runs
it. Ask / Edits / Auto still apply at execute time.

Always, in every mode: destructive commands (`git push --force`,
`git reset --hard`, `git clean -fd`, `chmod -R`, raw device writes, `curl | sh`,
`find -delete`, ...) are blocked unless you allow the command in the agent
policy. Network for fetch_url: `knoxchat.networkMode`.
Team bundles: **Knox: Export/Import Team Bundle**. Background agents: composer
**Run in background**, **Knox: Background Agents: Start**, and the jobs
panel (merge/discard). Composite tools stay off the catalog unless
`knoxchat.enableCompositeTools` is on.
Open the grouped settings search with **Knox: Open Knox Settings**.
**Knox: Import Session Transcript** restores a `/share` or Markdown-export file;
**Knox: Copy Session Share Link** copies a local `knoxcoder://…/session/import?path=` URI that opens that file in Knox (nothing is uploaded).

"Review edits" (mode popover) holds all file edits in memory; you then diff,
apply or discard each file in the review panel. Shell commands still see the
real disk, not staged files.

## Instructions, rules and skills

- `AGENTS.md`, `.knoxcoder/AGENTS.md`, `CLAUDE.md`, and `.knoxrules` are loaded
  from every workspace folder. Nested `AGENTS.md` closer to the open file
  is also loaded. Opt-in extras: `knoxchat.compatInstructions` = `cursor`
  (`.cursor/rules`, `.cursorrules`) and/or `copilot`
  (`.github/copilot-instructions.md`). Rules accept `applyTo` globs.
- Skills live in `skills/` (workspace) and `~/.knoxcoder/skills`. A skill with
  `globs:` frontmatter is only offered while a matching file is open.
- `/instructions` lists everything loaded, in order, with token cost and
  warnings (a file over 2000 tokens, or always-on text over 6000 tokens).
- `/init` writes a starter `AGENTS.md` from the repo (refuses to overwrite
  without `--force`).
- `config.yaml` `uses: owner/package` loads `~/.knoxcoder/registry/owner/package.yaml`
  (or `package@version.yaml`). Remote registries are not supported.

## Hooks

`.knoxcoder/hooks.json` in each workspace folder (re-read on every call; the hook
runs with that folder as `cwd`). The Hooks panel can test a hook;
**Knox: Test Hook** is also on the command palette.

```json
{ "hooks": { "PreToolUse": [
  { "matcher": "run_terminal_command|edit_file", "command": "./check.sh", "timeoutMs": 5000 }
] } }
```

Events: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`,
`SessionStart`. The hook receives JSON on stdin
(`{event, cwd, toolName?, args?, result?, prompt?}`).

- Exit 2: deny (`PreToolUse`, `UserPromptSubmit`); stderr is the reason.
- Exit 0 with JSON `{decision, reason, updatedArgs, additionalContext}`, or
  plain text, which becomes extra context.
- Any other exit code, a crash or a timeout (default 10 s) never blocks; it is
  written to the console log.

Hooks of one event run in file order and `PreToolUse` argument changes chain.
Context from `SessionStart` and `UserPromptSubmit` is added to your message in
a `<hook_context>` block.

## Custom subagents

`.knoxcoder/agents/*.md` in each workspace folder, plus `~/.knoxcoder/agents`.
Frontmatter `name`,
`description`, `tools` (allowlist), `readonly`, `model`. **Knox: Create Custom
Agent** writes a template to `.knoxcoder/agents` in the primary folder. The `task`
tool can run up to 8 children. Writing children are isolated in git worktrees
and their patches are merged back, with conflicts reported rather than
half-applied.

## Memory

Memory Brain stores facts from your sessions locally and injects the relevant
ones (hard cap 8000 tokens per turn; `KNOX_MEMORY_INJECT_CAP` overrides). Open
it with "Knox: View Memory" to see what was used, pin or remove items.
First-run chat shows what is stored. Off: `knoxchat.memoryBrain.enabled` (user)
or `knoxchat.memoryBrain.workspaceEnabled` (this folder). Export / wipe from
the command palette. Size cap: `knoxchat.memoryBrain.maxBytes`.

Experimental, off by default: `knoxchat.recipes.enabled` lets Memory Brain keep
verified work as local recipes, and `knoxchat.recipes.autoReplay` (`off`, `ask`,
`exact`, `adapt`) controls reuse. Sending the same chat twice is not enough — Knox must
edit files and a check must pass. Stay off until you want it; the default is not
silent auto-replay. `knoxchat.selfImprove.enabled` allows local
analysis that proposes fixes and issue drafts for you to approve. Design rules:
[recipes README](../src/core/context/memory/recipes/README.md).
How to use it: [recipes.md](recipes.md). Threat model: [security/threat-model.md](security/threat-model.md).

Run `npm run mc:self-improve` from `extensions/knox` to analyze this repo
(hot files, TODO density, bench baseline, optional threshold sweep from
`--history file.json`). It writes a dated report to
[`docs/self-improve/`](self-improve/) and sends nothing anywhere. Threshold
proposals are never applied automatically.

## Checkpoints

Before a turn changes files, Knox takes a checkpoint. Use the restore view to
roll back. Checkpoints are stored locally.
Each turn checkpoint records the redacted request that caused it and gets a
short summary label (for example "Add JWT middleware · 3 files in src/auth")
shown in the Checkpoint Graph and used by checkpoint search.

**Stash** parks dirty files (not a checkpoint, not a branch) and restores the
current line’s head, like `git stash`. Pop applies the latest stash with a
three-way merge against the live tree; overlapping edits stop and leave the
workspace unchanged. Palette: Stash Working Tree / Pop Stash / Show Stash.
The graph shows an “N stashed” chip when the stack is not empty.

**Switch branch** now checks out that line’s head, like `git switch`. Dirty
files are stashed first (`knox.checkpoints.autoStashOnCheckout`, default on).
If auto-stash is off and the tree is dirty, the switch is refused. Checking
out a graph node that is not a branch head leaves a detached pointer
(`detachedFrom` in the workspace index) so later captures do not move the
previous line. Palette: Switch Checkpoint Branch / Check Out Checkpoint.

**Rename and copy detection** treats `mv a.ts b.ts` as one renamed file, not
a delete plus an add. Capture records `renamedFrom` / `copiedFrom` on the
child snapshot (same hash is a sure match; similar text above ~60% also
counts). Diff shows status `renamed` or `copied` with the old path. File
history follows the old name, so versions of `b.ts` include earlier `a.ts`
turns. The `workspaceCheckpoint` tool action `file_history` is readonly.

**Cherry-pick** applies one checkpoint’s delta (vs its first parent) onto the
current line, like `git cherry-pick`. Non-overlapping files land as a new
checkpoint tagged `cherry-pick`; already-present changes are a no-op.
Overlapping edits write conflict markers, leave HEAD unchanged, and wait for
continue or abort. Graph node menu: Cherry-pick onto current. Palette:
Cherry-pick Checkpoint. Agent tool action `cherry_pick` always asks.

**Revert** writes a new checkpoint that undoes one turn and keeps later work,
like `git revert`. Restore still rewinds the tree. Revert of B after C keeps
C’s unique files and restores B’s preimage on overlapping files. Merge
checkpoints need an explicit `mainline` (`1` is the first parent). Graph: Revert this
checkpoint. Palette: Revert Checkpoint. Agent tool action `revert` always
asks. The original checkpoint stays in history.

**Merge conflicts** no longer abort the whole operation. Overlapping hashes
try a line-level three-way merge first; remaining paths get standard
`<<<<<<<` markers and a merge-in-progress record. Auto-merged files are
applied immediately. Continue writes the merge (or cherry-pick / revert)
node once markers are gone; abort restores the pre-merge tree. Graph banner:
Continue / Abort. Palette: Continue Merge / Abort Merge. Agent actions
`merge_continue` and `merge_abort` always ask.

**Blame** attributes each current line to the newest checkpoint that introduced
it, following renames (same walk as file history). Binary files are
unsupported; missing blobs stay “unknown” and do not throw. Palette: Blame
File / Hide Blame. Editor gutter and hover show the short id and label;
click opens that checkpoint on the graph. Setting `knox.checkpoints.blame`
(default on) also annotates the active file when the checkpoint graph opens.
Agent tool action `blame` is readonly.

**Worktrees** reconstruct a checkpoint into an isolated folder
(`~/.knoxcoder/worktrees/…`) so you can compare or test without touching the
main workspace. Destinations inside the project are refused. At most four
worktrees stay registered. Graph: Open in worktree. Palette: Open Checkpoint
in Worktree / Remove Checkpoint Worktree. Agent actions `materialize_worktree`
and `remove_worktree` always ask; `list_worktrees` is readonly.

**Bisect** binary-searches the ancestor line between a known-good and
known-bad checkpoint. Each probe is materialized in an isolated worktree, so
the main workspace is not rewritten. Graph banner: Good / Bad / Skip / Reset.
Palette: Bisect Start and the mark/reset commands. Agent actions
`bisect_start`, `bisect_good`, `bisect_bad`, `bisect_skip`, `bisect_reset`,
and `bisect_run` always ask. `bisect_run` uses exit 0 = good, 1–127 = bad,
125 = skip.

**Patches** export one checkpoint’s delta as a portable unified diff
(`From` / `Date` / `Subject` plus `X-Knox-Checkpoint`). Apply uses the same
three-way merge as cherry-pick onto the live tree and creates a checkpoint
tagged `patch`. Binary files are skipped on export. A conflict or malformed
patch writes nothing. Graph: Export patch. Palette: Export Checkpoint Patch /
Apply Checkpoint Patch. Agent `export_patch` is readonly; `apply_patch`
always asks. Bundles still clone a full reconstructable tree.

## Jev (network calls)

Jev routing and gates call `api.knoxstudio.ai` or, when the selected model is
OpenRouter, `openrouter.ai/api/v1/systemone` (`typesafe/jev-1.14`). Only the
user message and tool names are sent, never file contents. Every call has a
hard time budget and a circuit breaker (3 failures, 5 minutes off). Disable
with `knoxchat.jev.enabled`; see calls in "Knox: Show Jev Log" and the status
bar (`knoxchat.jev.showStatusBar`).

## Tool loading

`knoxchat.deferTools` sends a small core tool set (read/edit/shell/search plus
`builtin_git_status` and `builtin_git_diff`). `builtin_lsp` joins that set on
classified workspaces (node/python/go/cargo/editor/cmake) and systems. The
model finds the rest through `builtin_tool_search`, cutting per-turn schema
tokens by half. Agent chat always runs on the shared agent loop.

## Troubleshooting

- "Connection problem, retrying (n/4)": transient stream failure; the round is
  restarted, and the fallback model is used after 2 failures.
- Rate limit / bad key / model not found: the error dialog offers Retry and
  Open settings.
- Agent keeps repeating: the doom-loop guard stops it; use "Change strategy".
- Context nearly full: the composer shows `NN%`; Knox compacts at about 75%.
- Hooks not firing: check `.knoxcoder/hooks.json` is valid JSON and read the log.
- Startup: `npm run measure-startup` in `extensions/knox` prints load time.
