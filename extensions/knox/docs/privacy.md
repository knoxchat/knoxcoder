# Privacy

Knox stores its data under `~/.knoxcoder` (override `KNOX_GLOBAL_DIR`):
config, sessions, Memory Brain sqlite, checkpoints, credentials, job logs.

- Memory Brain: local sqlite. Off: `knoxchat.memoryBrain.enabled` or
  `knoxchat.memoryBrain.workspaceEnabled` (this folder) or `KNOX_BRAIN_ENABLED=0`.
  Export / wipe from the command palette.
- Checkpoints: byte-exact, not redacted (by design).
- Session files: user messages at rest are not redacted; tool output is.
- `~/.knoxcoder/auth.json`: mode 0600. The editor uses SecretStorage instead.
- Telemetry: none from Knox. VS Code crash reporter is disabled. See [network.md](network.md).

Issue reports go to https://github.com/knoxchat/knoxcoder/issues (not Microsoft).
