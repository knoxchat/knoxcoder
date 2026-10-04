# KnoxCoder

KnoxCoder is a code editor based on [Visual Studio Code](https://code.visualstudio.com) open source.

https://github.com/user-attachments/assets/271ed16b-66a2-4eee-a88d-afa4565a2d85

## Knox

Knox (sidebar chat, agent, Memory Brain, checkpoints) is a **system extension** (`vscode.knox`), the same class as Git. Linux and Windows CI package it with `packageNativeLocalExtensionsStream` (host `dist/`, webview `gui/`, platform sqlite). macOS uses `./build_dmg.sh` (no GitHub Actions macOS job). It is in the editor on first launch — **no Open VSX install**.

- **Disable:** Extensions view → Knox → Disable. It cannot be uninstalled.
- **Do not install** `knoxchat.knoxchat` from the marketplace in KnoxCoder. That id is hidden, blocked from install, and disabled if a leftover user copy is present.
- **Vanilla VS Code / Open VSX:** this fork does **not** publish Knox as a store VSIX. Marketplace Knox stays in the separate **kc** product tree (Knox 1.4.6) for vanilla VS Code only.

Command, view, and setting IDs stay `knoxchat.*` so existing keybindings and `settings.json` keep working.

> **Note — global data directory is `~/.knoxcoder`, not `~/.knox`.** Knox in KnoxCoder stores its global config (`config.yaml`, `sharedConfig.json`, `.env`, `.knoxignore`, `.knoxrules`), Memory Brain (`memory/`), sessions, checkpoints, rules, prompts, skills, logs, and job output under `~/.knoxcoder` so it never collides with the external Knox marketplace extension (`knoxchat.knoxchat`), which keeps using `~/.knox`. There is no fallback to or migration from `~/.knox`; copy files over manually if you want to reuse them. `KNOX_GLOBAL_DIR` still overrides the location.

## Documentation

* [What is KnoxCoder](extensions/knox/docs/README.md)
* [Install / CLI](extensions/knox/docs/cli.md)
* [Privacy](extensions/knox/docs/privacy.md)
* [Network](extensions/knox/docs/network.md)
* [Security / threat model](extensions/knox/docs/security/threat-model.md)
* [Release / update](extensions/knox/docs/release.md)
* [How to Contribute](https://github.com/knoxchat/knoxcoder)

## License

Copyright (c) KnoxStudio.

KnoxCoder is licensed under the [GNU GPL-3.0](LICENSE.txt). This repository includes Visual Studio Code source from Microsoft, which remains available under [MIT](LICENSE.vscode.txt).
