# Upgrading to Knox 2.0

Applies to upgrades from `1.138.x` and `2.0.0-beta`.

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
- Agent chat runs on the shared agent loop; `knoxchat.sharedLoop` is gone.
- Tools are deferred by default (`knoxchat.deferTools`). Old `builtin_memory_*` names still route to `builtin_memory`.
- OS command sandbox (`knoxchat.sandbox`) and the headless `@knoxchat/cli` (`knox run`) are not in 2.0.0.
- Removed commands: `knox.analyzeTask`, `knoxchat.analyzeTask`, `knox.structuredSolve`, `knox.performTaskAnalysis`.

## Linux packages

`2.0.0~beta` sorts before `2.0.0`, so `apt`/`rpm` upgrade from the beta in place.

## Windows

Installers may be unsigned; SmartScreen shows "unknown publisher". Choose **More info, Run anyway**.
