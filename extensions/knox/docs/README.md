# Knox user guide

Knox is the coding agent built into this editor. This guide covers setup,
permissions, project instructions, hooks, memory, checkpoints and
troubleshooting. Setting names are `knoxchat.*` in Settings.

## Setup

1. Open the Knox chat and sign in (or add a model in the config page).
2. Pick a model from the composer. Optionally set `knoxchat.fallbackModel`
   (a model title) to use after repeated transient stream failures.
3. Open a folder. Knox works on the first workspace folder.

Headless use (CI, scripts): see [cli.md](cli.md). Install `@knoxchat/cli` (`knox doctor`, `knox run "<task>" --json`) or from this tree `npm run knox -- doctor` in `extensions/knox/src/core`. Exit codes: 0 completed, 1 error, 2 step/doom-loop, 130 aborted, 64 usage.

## Docs set

- [CLI](cli.md) — installable `@knoxchat/cli`, version, doctor, JSON schema, `--continue` / `--resume`
- [Network](network.md) — every outbound call and `knoxchat.networkMode`
- [Privacy](privacy.md)
- [Sandbox](security/sandbox.md) — `knoxchat.sandbox`
- [Threat model](security/threat-model.md)
- [Release](release.md) — version scheme, checksums, rollback
- [Third-party notices](third-party-notices.md) — Knox bundled production licenses
- [Testing policy](testing-policy.md)
- [GitHub Action example](ci/knox-run.yml)

Knox 2.0 ships **English and Chinese** only (`en` / `zh`, plus `package.nls.json` / `package.nls.zh-cn.json`). Extra locales are 2.1.

## Permission modes

| Mode | Reads | Edits | Shell |
|---|---|---|---|
| Ask | auto | asks | asks |
| Edits (default) | auto | auto | asks |
| Auto | auto | auto | auto |

Always, in every mode: destructive commands (`git push --force`,
`git reset --hard`, `git clean -fd`, `chmod -R`, raw device writes, `curl | sh`,
`find -delete`, ...) are blocked unless you allow the command in the agent
policy. Optional OS sandbox: `knoxchat.sandbox` = `workspace-write` or
`read-only` (macOS `sandbox-exec`, Linux `bwrap`; Windows has no wrapper).
Network for fetch_url and the sandbox: `knoxchat.networkMode`.
Team bundles: **Knox: Export/Import Team Bundle**. Background agents: jobs
panel (merge/discard) and **Knox: Background Agents: List**.
Open the grouped settings search with **Knox: Open Knox Settings**.

"Review edits" (mode popover) holds all file edits in memory; you then diff,
apply or discard each file in the review panel. Shell commands still see the
real disk, not staged files.

## Instructions, rules and skills

- `AGENTS.md`, `.knox/AGENTS.md`, `CLAUDE.md`, and `.knoxrules` are loaded
  into every turn. Opt-in extras: `knoxchat.compatInstructions` = `cursor`
  (`.cursor/rules`, `.cursorrules`) and/or `copilot`
  (`.github/copilot-instructions.md`). Rules accept `applyTo` globs.
- Skills live in `.knox/skills` and `~/.knoxcoder/skills`. A skill with
  `globs:` frontmatter is only offered while a matching file is open.
- `/instructions` lists everything loaded, in order, with token cost and
  warnings (a file over 2000 tokens, or always-on text over 6000 tokens).
- `/init` writes a starter `AGENTS.md` from the repo (refuses to overwrite
  without `--force`).

## Hooks

`.knox/hooks.json` in the workspace root (re-read on every call). The Hooks
panel can test a hook; **Knox: Test Hook** is also on the command palette.
Headless runs ignore repo hooks unless `--trust-hooks`.

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

`.knox/agents/*.md` with frontmatter `name`, `description`, `tools`
(allowlist), `readonly`, `model`. **Knox: Create Custom Agent** writes a
template. The `task` tool can run up to 8 children.
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
