# Upgrading to Knox 2.1

Applies to upgrades from `1.138.x`, `2.0.0-beta`, `2.0.0`, `2.0.1` and `2.1.0`. From 2.0.x and 2.1.0 there are no data migrations: your `~/.knoxcoder` data is used as is.

2.1 notes: workspace hooks, agents and prompts are read from `.knoxcoder/` only; `knoxchat.sandbox` and `knoxchat.sharedLoop` remain deprecated no-ops; model lists were refreshed (existing models keep working). 2.1.1 upgrades the editor host to VS Code 1.141.0 (Electron 43.7.7) without Copilot or Azure Pipelines.

## Your data

Everything lives in `~/.knoxcoder`. Upgrading keeps it:

- **Sessions** (`sessions/`): files gain `schemaVersion: 1`. An older file is copied once to `<file>.v<N>.bak` before it is rewritten. `sessions.json` stays a bare array, so a downgrade still reads it.
- **Memory Brain** (`brain.sqlite`): stamped with `PRAGMA user_version`. An unversioned database is copied to `backups/` (newest 3 kept) before migrating. A corrupt database is moved aside as `*.corrupt-<ts>` and recreated.
- **Checkpoints**: the index is backed up once (`index.json.v<N>.bak`) before being rewritten.
- **`config.yaml`**: never rewritten on upgrade. Editing it from the GUI keeps a one-time `config.yaml.vpre-edit.bak`.

To roll back, install the previous version and restore the `.bak` files you need.

## Behavior changes since 1.138

- New sessions start in **Edits** mode (shell asks). Saved modes are not changed.
- Destructive shell commands are denied in every mode, including Auto, unless allowlisted.
- Agent chat runs on the shared agent loop; `knoxchat.sharedLoop` is gone (the key remains as a deprecated no-op so old settings.json still loads).
- Tools are deferred by default (`knoxchat.deferTools`). Old `builtin_memory_*` names still route to `builtin_memory`.
- OS command sandbox (`knoxchat.sandbox`) and the headless `@knoxchat/cli` (`knox run`) are not in 2.0.0. `knoxchat.sandbox` is a deprecated no-op.
- Removed commands: `knox.analyzeTask`, `knoxchat.analyzeTask`, `knox.structuredSolve`, `knox.performTaskAnalysis`.

## Linux packages

`2.0.0~beta` sorts before `2.0.0`, so `apt`/`rpm` upgrade from the beta in place.

## Windows

Installers may be unsigned; SmartScreen shows "unknown publisher". Choose **More info, Run anyway**.
