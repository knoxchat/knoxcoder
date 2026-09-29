# Knox

**Notice:** This extension is bundled with KnoxCoder. It can be disabled but not uninstalled.

Knox is the editor's AI coding environment: agent, local memory, and git-independent checkpoints. Product source is this folder (`extensions/knox`: engine, tools, host) plus `src/vs/workbench/contrib/knox` (native chat, memory, and checkpoint UI). Same role as `extensions/git`: a builtin that other extensions can depend on.

License: GPL-3.0-only. See [LICENSE.txt](../../LICENSE.txt) in the repository root. Upstream Visual Studio Code files remain under [MIT](../../LICENSE.vscode.txt).

## Develop

From the repository root:

```sh
    gulp compile-extension:knox
    gulp compile-extension-knox-native
    ./scripts/code.sh
```

`compile-extension:knox` esbuilds the product host from `extensions/knox/src/{host,core,pkg}` into `out/extension.js` and copies sqlite3, ripgrep, tree-sitter wasm, node-pty, bundled skills, and esbuild beside the bundle. `compile-extension-knox-native` refreshes those native addons without a full esbuild. Those two gulp tasks are the only Knox compile path. Chat is the native workbench pane in `src/vs/workbench/contrib/knox`. Launch KnoxCoder itself; do **not** `code --install-extension` a VSIX into KnoxCoder — that would register a second copy of the same view id.

Native addons (`sqlite3`, optional `node-pty`) are rebuilt for this fork's Electron **43.3.0** (`process.versions.modules` / ABI **148**) via `@electron/rebuild` during `gulp compile-extension:knox` and `gulp compile-extension-knox-native`. System Node 24 compiles those packages to ABI 137, which will not `dlopen` in the extension host.

`npm install` at the repository root installs Knox dependencies in `extensions/knox` (listed in `build/npm/dirs.ts`), and gulp spawns the esbuild script from `extensions/knox` (KN-391). Neither points at a checkout of the original product at the repository root; if you keep one there for reference, add it to `.git/info/exclude` so the inventory gate treats it as local.

Set `KNOX_SKIP_ELECTRON_REBUILD=1` to copy whatever bindings `npm install` already built (no compiler / Electron headers). Those binaries may fail to load under Electron 43. Set `KNOX_FORCE_ELECTRON_REBUILD=1` to rebuild even if `@electron/rebuild` thinks the module is current.

## Identity

| | In KnoxCoder | Marketplace VSIX (stock VS Code) |
|---|---|---|
| Extension id | `vscode.knox` | `knoxchat.knoxchat` |
| Source | `extensions/knox` + `src/vs/workbench/contrib/knox` | separate marketplace package |
| Uninstall | hidden (builtin) | normal |

If both are present, the builtin wins and the marketplace activation is skipped. KnoxCoder does not recommend `knoxchat.knoxchat`.

### Global data directory

The builtin Knox stores all global state (config, memory, sessions, checkpoints, rules, prompts, skills, logs, jobs) in **`~/.knoxcoder`**, not `~/.knox`, so it does not conflict with the marketplace extension that owns `~/.knox`. There is no legacy fallback or migration from `~/.knox`. The directory name lives in `src/core/util/globalDirName.ts`; `KNOX_GLOBAL_DIR` overrides the full path (tests / custom installs). Workspace-level files (`.knox/AGENTS.md`, `.knox/prompts`, `.knoxrules`, `.knoxignore`) are unchanged.

## Packaging

Knox is an in-tree **native** extension (`nativeExtensions` in `build/lib/extensions.ts`), packaged per-platform with sqlite3 / ripgrep / node-pty. Gulp compile tasks are only `compile-extension:knox` and `compile-extension-knox-native`. There is no `product.json` `builtInExtensions` marketplace download for Knox (`knoxchat.knoxchat` is out of scope inside KnoxCoder). `.vscodeignore` ignores `/node_modules/**` at the extension root so `dist/node_modules` natives still ship.

## Remote / SSH and web

`extensionKind` is `ui` + `workspace` so the engine can run on the remote file system over SSH. sqlite3, ripgrep, and optional node-pty are copied into the bundle and packaged per-platform (`nativeExtensions` in the product build) so the Remote-SSH copy on the remote has matching addons. Activation probes those files and warns if sqlite3 or ripgrep is missing.

There is no `browser` field; Knox is not a web extension (`gulp vscode-web` skips it; activation refuses `UIKind.Web`).

## API

The Knox extension exposes an API, reachable by any other extension.

1. Copy `src/api/knox.d.ts` to your extension's sources;
2. Include `knox.d.ts` in your extension's compilation.
3. Get a hold of the API with the following snippet:

	```ts
	const knoxExtension = vscode.extensions.getExtension<KnoxExtension>('vscode.knox');
	const knox = knoxExtension?.exports.getAPI(1);
	await knox?.openChat({ prompt: 'explain the selection' });
	```

	**Note:** To ensure that the `vscode.knox` extension is activated before your extension, add `extensionDependencies` ([docs](https://code.visualstudio.com/api/references/extension-manifest)) into the `package.json` of your extension:

	```json
	"extensionDependencies": [
		"vscode.knox"
	]
	```

	Without that dependency, call `await knoxExtension?.activate()` before `getAPI(1)`.

`getAPI(1)` returns `openChat`, `newSession`, `toggleAgentMode`, `executeToolCall`, `handleGuiMessage`, `registerCustomContextProvider`, and agent/GUI events.

`vscode.lm` (KN-362): Knox registers builtin tools (`lm.invokeTool('builtin_read_file', ...)`) and a `vendor: 'knox'` assist provider (`lm.selectAssistModels({ vendor: 'knox' })`). Ghost-text inline completions (KN-363) stay off until `knoxchat.enableInlineCompletions` is enabled.
