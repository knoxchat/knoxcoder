# Known issues in 2.1.0

- **Command guard limits.** Variable indirection (`X=rm; $X -rf /`) and an interpreter running a script written earlier are not detected. Stay in Edits or Ask mode for untrusted work. See the [threat model](security/threat-model.md).
- **Unsigned installers** may trigger SmartScreen (Windows) until a certificate is available.
- **Ghost-text inline completion stays off** (no fill-in-the-middle model). Copilot-style next-edit is not planned. In-editor assist is ⌘I, Apply from chat, and review-before-edit; 2.1 adds comment/stub CodeLens and a next related edit after Accept.
- **Multi-root workspaces:** the folder of the active editor file is the primary root (shell, git, builds, relative paths); search, glob, instruction files, hooks and custom agents cover all roots. Nested `.knoxignore` is honored. Checkpoints are stored per folder.
- **Remote / SSH / dev container / WSL** are not supported for the Knox host.
- **Remote package registry and scheduled agents** are not in 2.1. Local `uses: owner/package` loads `~/.knoxcoder/registry/…`; remote fetch is refused.
- **Background agents:** the GUI lists, merges and discards leftover jobs. Starting a new background job is not in 2.1.0.
- **Locales:** English and Chinese only (by design; extra languages are not planned).
- **Dependencies:** `node-forge` (via `mac-ca`/`win-ca`) has an unfixed advisory in signature verification, which Knox does not use (only system root certs are read). `uuid@3` under dev-tunnels has no upstream fix; tunnels are unused.
- **Not yet measured:** 1000-turn soak, 500k-file repositories, and live-provider vision/caching per provider.
- **Accessibility:** a full keyboard-only and screen-reader pass, and all built-in themes (the chat UI was tuned for One Dark), are not verified.
