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
| Edits (default) | auto | auto | asks |
| Auto | auto | auto | auto |

Always, in every mode: destructive commands (`git push --force`,
`git reset --hard`, `git clean -fd`, `chmod -R`, raw device writes, `curl | sh`,
`find -delete`, ...) are blocked unless you allow the command in the agent
policy. Network for fetch_url: `knoxchat.networkMode`.
Team bundles: **Knox: Export/Import Team Bundle**. Background agents: jobs
panel (merge/discard leftover jobs) and **Knox: Background Agents: List**.
Open the grouped settings search with **Knox: Open Knox Settings**.
**Knox: Import Session Transcript** restores a `/share` or Markdown-export file;
**Knox: Copy Session Share Link** copies a local `knoxcoder://…/session/import?path=` URI that opens that file in Knox (nothing is uploaded).

"Review edits" (mode popover) holds all file edits in memory; you then diff,
apply or discard each file in the review panel. Shell commands still see the
real disk, not staged files.

## Instructions, rules and skills

- `AGENTS.md`, `.knox/AGENTS.md`, `CLAUDE.md`, and `.knoxrules` are loaded
  from every workspace folder. Nested `AGENTS.md` closer to the open file
  is also loaded. Opt-in extras: `knoxchat.compatInstructions` = `cursor`
  (`.cursor/rules`, `.cursorrules`) and/or `copilot`
  (`.github/copilot-instructions.md`). Rules accept `applyTo` globs.
- Skills live in `.knox/skills` and `~/.knoxcoder/skills`. A skill with
  `globs:` frontmatter is only offered while a matching file is open.
- `/instructions` lists everything loaded, in order, with token cost and
  warnings (a file over 2000 tokens, or always-on text over 6000 tokens).
- `/init` writes a starter `AGENTS.md` from the repo (refuses to overwrite
  without `--force`).
- `config.yaml` `uses: owner/package` loads `~/.knoxcoder/registry/owner/package.yaml`
  (or `package@version.yaml`). Remote registries are not supported.

## Hooks

`.knox/hooks.json` in each workspace folder (re-read on every call; the hook
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

`.knox/agents/*.md` in each workspace folder, with frontmatter `name`,
`description`, `tools` (allowlist), `readonly`, `model`. **Knox: Create Custom
Agent** writes a template in the primary folder. The `task` tool can run up to
8 children.
writers are isolated in git worktrees and their patches are merged back, with
conflicts reported rather than half-applied.

## Memory

Memory Brain stores facts from your sessions locally and injects the relevant
ones (hard cap 8000 tokens per turn; `KNOX_MEMORY_INJECT_CAP` overrides). Open
it with "Knox: View Memory" to see what was used, pin or remove items.
First-run chat shows what is stored. Off: `knoxchat.memoryBrain.enabled` (user)
or `knoxchat.memoryBrain.workspaceEnabled` (this folder). Export / wipe from
the command palette. Size cap: `knoxchat.memoryBrain.maxBytes`.

## Checkpoints

Before a turn changes files, Knox takes a checkpoint. Use "undo turn" in the
turn summary or the restore view to roll back. Checkpoints are stored locally.

## Jev (network calls)

Jev routing and gates call `api.knoxstudio.ai`. Only the user message and tool
names are sent, never file contents. Every call has a hard time budget and a
circuit breaker (3 failures, 5 minutes off). Disable with `knoxchat.jev.enabled`;
see calls in "Knox: Show Jev Log" and the status bar (`knoxchat.jev.showStatusBar`).

## Tool loading

`knoxchat.deferTools` sends a small core tool set and lets the model find the
rest through `builtin_tool_search`, cutting per-turn schema tokens by half.
Agent chat always runs on the shared agent loop.

## Troubleshooting

- "Connection problem, retrying (n/4)": transient stream failure; the round is
  restarted, and the fallback model is used after 2 failures.
- Rate limit / bad key / model not found: the error dialog offers Retry and
  Open settings.
- Agent keeps repeating: the doom-loop guard stops it; use "Change strategy".
- Context nearly full: the composer shows `NN%`; Knox compacts at about 75%.
- Hooks not firing: check `.knox/hooks.json` is valid JSON and read the log.
- Startup: `npm run measure-startup` in `extensions/knox` prints load time.
