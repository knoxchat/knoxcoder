# Knox CLI

Headless Knox for CI and scripts.

```
npm i -g @knoxchat/cli
knox --version
knox doctor
knox login
knox run "<task>" --json
```

Until `@knoxchat/cli` is on the public registry, install from this repository:

```
cd extensions/knox
npm run build:cli
npm i -g ./cli
```

From source without packaging: `npm run knox -- --version` in `extensions/knox/src/core`.

`--version` prints the product version (root `package.json`, currently `2.0.0-beta`). `doctor` checks Node, git, sqlite3, ripgrep, auth, config.yaml, and whether an OS sandbox binary is present. It never prints keys.

## Auth

- Interactive: `knox login` (OAuth, session in `~/.knoxcoder/auth.json`, mode 0600).
- CI: set `KNOX_API_KEY`. It wins over `auth.json`. Do not pass keys on the command line.

## `knox run`

| Flag | Meaning |
|---|---|
| `--dir <path>` | Workspace (default: cwd) |
| `--permission default\|acceptEdits\|fullAuto` | Headless: anything that would ask is denied. Default `acceptEdits`. |
| `--profile default\|systems` | Extra kernel/firmware tools |
| `--max-steps <n>` | Cap tool rounds |
| `--model <id>` | Model id (default: first `config.yaml` model, else `qwen/qwen3-coder`) |
| `--continue` | Resume the newest session in this workspace |
| `--resume <sessionId>` | Resume a specific session |
| `--trust-hooks` | Run repo `.knox/hooks.json` (off by default; also `KNOX_TRUST_WORKSPACE_HOOKS=1`) |
| `--json` | One JSON object on stdout |
| `--stream-json` | One JSON event per line |

Exit codes: `0` completed, `1` error, `2` step/doom-loop, `130` aborted, `64` usage.

## JSON contract (`schemaVersion`: 1)

`--json` result:

```json
{
  "schemaVersion": 1,
  "stoppedReason": "completed",
  "exitCode": 0,
  "steps": 3,
  "summary": "...",
  "tools": [{ "name": "builtin_read_file", "args": {}, "ok": true, "output": "..." }],
  "denied": [],
  "usage": { "promptTokens": 0, "completionTokens": 0 }
}
```

`--stream-json` events (one per line): `{ schemaVersion, type: "text"|"tool"|"denied"|"result", ... }`. The final line is `type: "result"` with the same fields as `--json`. `--json` also includes `sessionId` when the run was persisted (CLI always persists).

## Resume

Every `knox run` writes a session under `~/.knoxcoder/sessions`. Then:

```
knox run "do the next thing" --continue
knox run "same thread" --resume <sessionId>
```

`--continue` and `--resume` cannot be combined. The session id is in the `--json` result.

## GitHub Action

See [ci/knox-run.yml](ci/knox-run.yml) for a copy-paste workflow. It is an example, not a live job in this repository.

## Installable CLI

The npm package is `@knoxchat/cli`; the binary on PATH is `knox`. Native add-ons (`sqlite3`, `@vscode/ripgrep`) install with the package so each OS gets matching binaries. `npm run build:cli` in `extensions/knox` produces `cli/dist/knox.js`; `npm run packaged-cli-smoke` checks `--version`, `doctor`, and `--help`.
