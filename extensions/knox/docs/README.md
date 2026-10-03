# Knox user guide

Knox is the coding agent built into this editor. This guide covers setup,
permissions, project instructions, hooks, memory, checkpoints and
troubleshooting. Setting names are `knoxchat.*` in Settings.

## Setup

1. Open the Knox chat and sign in (or add a model in the config page).
2. Pick a model from the composer. Optionally set `knoxchat.fallbackModel`
   (a model title) to use after repeated transient stream failures.
3. Open a folder. Knox works on the first workspace folder.

Headless use (CI, scripts): from `extensions/knox/src/core`, run
`knox login` once, then `npm run knox -- run "<task>" --json`. Flags:
`--dir`, `--permission`, `--max-steps`, `--model`. Exit codes: 0 completed,
1 error, 2 step/doom-loop stop,
130 aborted, 64 usage. Anything that would need approval is denied and listed.

## Permission modes

| Mode | Reads | Edits | Shell |
|---|---|---|---|
| Ask | auto | asks | asks |
| Edits (default) | auto | auto | asks |
| Auto | auto | auto | auto |

Always, in every mode: destructive commands (`git push --force`,
`git reset --hard`, `git clean -fd`, `chmod -R`, raw device writes, `curl | sh`,
`find -delete`, ...) are blocked unless you allow the command in the agent
policy. Reading `.env*`, `*.pem` and `id_*` always asks. Secrets in tool output
are redacted before they reach the transcript, memory, checkpoints or logs.

"Review edits" (mode popover) holds all file edits in memory; you then diff,
apply or discard each file in the review panel. Shell commands still see the
real disk, not staged files.

## Instructions, rules and skills

- `AGENTS.md` and `.knoxrules` are loaded into every turn. Rules accept
  `applyTo` globs.
- Skills live in `.knox/skills` and `~/.knoxcoder/skills`. A skill with
  `globs:` frontmatter is only offered while a matching file is open.
- `/instructions` lists everything loaded, in order, with token cost and
  warnings (a file over 2000 tokens, or always-on text over 6000 tokens).
- `/init` writes a starter `AGENTS.md` from the repo (refuses to overwrite
  without `--force`).

## Hooks

`.knox/hooks.json` in the workspace root (re-read on every call):

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
(allowlist), `readonly`, `model`. The `task` tool can run up to 8 children;
writers are isolated in git worktrees and their patches are merged back, with
conflicts reported rather than half-applied.

## Memory

Memory Brain stores facts from your sessions locally and injects the relevant
ones (hard cap 8000 tokens per turn; `KNOX_MEMORY_INJECT_CAP` overrides). Open
it with "Knox: View Memory" to see what was used, pin or remove items.

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
