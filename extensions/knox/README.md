# Knox

**Notice:** This extension is bundled with KnoxCoder. It can be disabled but not uninstalled.

Knox is the in-editor AI agent, local Memory Brain, and git-independent checkpoints. Command, view, and setting IDs stay `knoxchat.*` so existing keybindings and `settings.json` keep working. The system extension id is `vscode.knox`.

Product behavior is ported from Knox 1.4.6 (`kc` SHA `af32aaa3cbf0aed8eee1fec8d37d3f6d274a5fbe`). See `knox-impl.md` in the repository root for the system-extension migration, and `knox-gui-native.md` for the native sidebar rewrite.

## Features

- Sidebar chat (`knoxchat.knoxGUIView`) — native workbench widgets on the Secondary Side Bar (`src/vs/workbench/contrib/knox`)
- Agent mode, tools, and vertical diffs
- Local Memory Brain
- Checkpoints (explorer view + chat restore)

The VS Code host (activate, Core, agent, checkpoints, `VsCodeIde`) runs Core **in-process** via `InProcessMessenger`. The sidebar view is registered by `src/vs/workbench/contrib/knox` as a native `ViewPane`. Core talks to that pane through the `nativeGui` export on `vscode.knox`. There is no webview fallback and no Vite GUI in the packaged extension.

## Native bits

Knox is a **native** in-tree extension (`nativeExtensions` includes `knox`), same class as Git:

- **Ripgrep** comes from the KnoxCoder product (`vscode.env.appRoot` → `@vscode/ripgrep-universal`, then `@vscode/ripgrep`). It is not vendored inside this extension.
- **Search / Memory** use BM25 (SQLite FTS5 + MiniSearch) and product ripgrep.
- **Checkpoints** are TypeScript. There are no Rust neon crates.
- **node-pty** is the editor’s ABI-matched module from `appRoot`. This extension does not copy pty into `out/node_modules`.
- **sqlite3** is rebuilt for Electron’s Node ABI (`npm run rebuild-native` in this folder, also run from `compile-native-extensions-build`). `node_sqlite3.node` is placed next to `dist/` (`dist/build/Release/` and `build/Release/`). Memory Brain needs this binary.
- **tree-sitter** language WASMs and query files are copied into `dist/` at compile time (no runtime download).
- Do not vendor `kc/binary` (`pkg`).

Linux and Windows CI pack Knox with `packageNativeLocalExtensionsStream`. macOS uses `./build_dmg.sh` on a Darwin machine (no GitHub Actions macOS job); sqlite is rebuilt there.

## Workspace trust

Agent tools write files and run commands, so this extension matches Git on untrusted workspaces: `untrustedWorkspaces.supported` is `false`. Virtual workspaces are also `false` (the agent and checkpoints need a real filesystem). Open a trusted local folder to use Knox.

## Marketplace Knox (`knoxchat.knoxchat`)

KnoxCoder ships this extension as `vscode.knox`. Do **not** install `knoxchat.knoxchat` from Open VSX in KnoxCoder — it is hidden from the marketplace, blocked from install, and disabled if a leftover user copy is present.

This fork does **not** publish `vscode.knox` (or any KnoxCoder-dependent VSIX) to Open VSX. The store extension remains for vanilla VS Code only and lives in the upstream **kc** product tree (Knox 1.4.6). After KnoxCoder ships native Knox, continue to land store/vanilla VS Code changes in `kc` first, then vendor into `extensions/knox` as needed.

## Tests

Host and Core unit tests use the same Mocha TDD runner as Git (`extensions/git/src/test`). They compile with `gulp compile-extension:knox` and do **not** add Mocha or Vitest as a runtime dependency of the shipped extension.

```sh
gulp compile-extension:knox
npm test --prefix extensions/knox
```

Native pane tests live under `src/vs/workbench/contrib/knox/test`.

Smoke: `./scripts/code.sh`, open the Knox sidebar, Command Palette → **Knox: New Conversation**.
