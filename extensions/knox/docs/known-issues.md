# Known issues in 2.0.0

- **Command guard limits.** Variable indirection (`X=rm; $X -rf /`) and an interpreter running a script written earlier are not detected. Stay in Edits or Ask mode for untrusted work. See the [threat model](security/threat-model.md).
- **Unsigned installers** may trigger SmartScreen (Windows) until a certificate is available.
- **Ghost-text inline completion stays off** (no fill-in-the-middle model). Copilot-style next-edit is not planned. In-editor assist is ⌘I, Apply from chat, and review-before-edit; 2.1 adds comment/stub CodeLens and a next related edit after Accept.
- **Multi-root workspaces:** Knox uses the first folder only.
- **Remote / SSH / dev container / WSL** are not supported for the Knox host.
- **Background agents:** the GUI lists, merges and discards leftover jobs. Starting a new background job is not in 2.0.0.
- **Locales:** English and Chinese only.
- **Dependencies:** `node-forge` (via `mac-ca`/`win-ca`) has an unfixed advisory in signature verification, which Knox does not use (only system root certs are read). `uuid@3` under dev-tunnels has no upstream fix; tunnels are unused.
- **Not yet measured:** 1000-turn soak, 500k-file repositories, and live-provider vision/caching per provider.
- **Accessibility:** a full keyboard-only and screen-reader pass, and all built-in themes (the chat UI was tuned for One Dark), are not verified.
