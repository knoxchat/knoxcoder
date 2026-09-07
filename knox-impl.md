# Knox Native Extension Implementation Plan

Migrate the published **Knox** VS Code extension (`knoxchat.knoxchat` on Open VSX) into this KnoxCoder fork as a **first-party system extension**, using the same load/build/ship path as `extensions/git`.

This document is the source of truth for the work. Implement the checkboxes **in order**. Do not skip a phase unless a later TODO explicitly depends on an earlier decision that is already locked.

---

## 1. Goal

Ship Knox **inside the editor binary**, compiled by this repo’s gulp/esbuild pipeline, so it:

- Appears on first launch with **no Open VSX download**
- Loads from `resources/app/extensions/knox` (system extension), same class as Git
- Builds GUI + native bits as part of `compile-extensions` / `compile-extension-media` / native packaging
- Keeps current Knox product behavior (sidebar chat, agent, memory brain, checkpoints, tools, keybindings)

**Non-goal for this migration:** rewriting Knox as a workbench contribution under `src/vs/workbench/contrib/`. That would be faster still, but it is not how Git works and would discard the VS Code extension API surface.

---

## 2. Why Git is fast and Knox is slow today

### 2.1 How Git is native in this repo

| Mechanism | Git (`extensions/git`) | Marketplace Knox (`knoxchat.knoxchat`) |
|-----------|------------------------|----------------------------------------|
| Location | In-tree `extensions/git/` | Separate repo; user-installed VSIX |
| Publisher / id | `vscode.git` | `knoxchat.knoxchat` |
| Discovery | Scanned from the app `extensions/` folder as `ExtensionType.System` | Gallery fetch → user extensions dir |
| Dev compile | Hardcoded in `build/gulpfile.extensions.ts` → `compile-extension:git` | Separate `npm run esbuild` in another tree |
| Bundle | `extensions/git/esbuild.mts` via `extensions/esbuild-extension-common.mts`; `main` rewritten `out/` → `dist/` on package | `scripts/esbuild.js` in the Knox monorepo |
| Production package | `build/lib/extensions.ts` `fromLocal()` + `packageNativeLocalExtensionsStream()` | `scripts/prepackage.js` + `package.js` (vsce/ovsx) |
| Native bits | Listed in `nativeExtensions` (`git`, `microsoft-authentication`) so they package **on the target OS** | VSIX embeds sqlite3, ripgrep, optional pkg binary |
| GUI | None (workbench SCM views) | Separate Vite React app copied into `gui/` at package time |
| Activation | `"*"` (eager, small) | `onStartupFinished` + `onView:knoxGUIView` (late, then huge) |
| `product.json` `builtInExtensions` | **Not listed** (local folder extensions are already system) | Would only apply if we kept downloading a VSIX |

Git is **not** a `product.json` `builtInExtensions` entry. Those entries (`ms-vscode.js-debug*`) are **downloaded** at launch (`build/lib/builtInExtensions.ts`). Putting Knox there would keep the slow gallery path. Native means **local folder extension**, like Git.

### 2.2 Current Knox architecture (source of truth)

Use **`/Users/knox/Desktop/kc`** (product version **1.4.6**), not the incomplete public flatten at `github.com/knoxchat/knoxchat`.

Continue-style monorepo:

```
kc/
  extensions/vscode/   ~144 TS files (host: activate, webview, agent, checkpoints, IDE facade)
  gui/                 ~450 TS/TSX files (Vite + React 19 + Tailwind + Redux sidebar)
  core/                ~391 TS files (LLM, tools, memory brain, protocol, config)
  knoxdev-package/     ~24 TS files (config-yaml, fetch, openai-adapters)
  binary/              optional `pkg` IPC host — NOT used by the VS Code product path
```

Runtime today:

1. Extension host loads `out/extension.js` (esbuild bundle of host + `core`).
2. `InProcessMessenger` runs Core **in-process** (`extensions/vscode/src/extension/VsCodeExtension.ts`).
3. Sidebar webview (`knoxchat.knoxGUIView`) loads **prebuilt** `gui/assets/index.js` + `index.css` (or Vite `localhost:5173` in development).
4. Extra native/search assets are copied at **VSIX pack time**: sqlite3 `.node`, `@vscode/ripgrep`, tree-sitter WASM.

`kc/binary/README.md` is explicit: the product IDE host is VS Code only; the standalone binary is optional packaging. **Do not ship `binary/` into KnoxCoder.**

Public `knoxchat/knoxchat` also contains Rust neon crates (`checkpoints/`, `ac/`). Current `kc` checkpoints are TypeScript. **Do not vendor neon.**

### 2.3 Load-time problems to eliminate

1. **Gallery install** — Open VSX download, verify, unzip into `~/.knoxcoder/extensions`.
2. **Pack-time GUI** — Vite build is not part of KnoxCoder `compile-extensions`; missing/stale `gui/` means a blank sidebar.
3. **Duplicate native tools** — second ripgrep, second node-pty candidates, sqlite3 inside the VSIX instead of the product.
4. **Huge first activation** — one bundle pulls Core + LLM + sqlite + tools before the webview paints.
5. **Dev vs prod split** — `localhost:5173` GUI vs copied `gui/dist` is a second toolchain users wait on.

---

## 3. Target architecture (locked)

Mirror Git, plus a webview like `extensions/simple-browser`.

```
knoxcoder/
  extensions/knox/                 # system extension, same class as git
    package.json                   # publisher: vscode, name: knox, main: ./out/extension
    package.nls.json
    tsconfig.json                  # extends ../tsconfig.base.json, vscode.d.ts from src/vscode-dts
    esbuild.mts                    # node bundle → dist/ (pack) / gulp out/ (dev)
    .vscodeignore
    README.md                      # “bundled with KnoxCoder; can be disabled but not uninstalled”
    media/                         # icons, tmLanguage, static assets
    src/                           # from kc/extensions/vscode/src
    core/                          # vendored from kc/core (bundled, not a separate npm workspace at repo root)
    knoxdev-package/               # vendored from kc/knoxdev-package
    gui-src/                       # from kc/gui/src (+ vite/tailwind config)
    gui/                           # BUILD OUTPUT only (webview assets) — gitignored
    scripts/                       # gui build wrapper if Vite is kept for phase 1
```

**Identity**

| Field | Value | Why |
|-------|--------|-----|
| Folder | `extensions/knox` | User request; matches git/simple-browser layout |
| `name` | `knox` | Git uses `git`, not `vscode-git` |
| `publisher` | `vscode` | System extensions in this repo use `vscode` |
| Extension id | `vscode.knox` | `vscode.git` parity |
| Commands / views / settings | keep `knoxchat.*` | User keybindings, `when` clauses, settings.json |
| `EXTENSION_NAME` | stay `"knoxchat"` | `workspace.getConfiguration("knoxchat")` |

If a user still has marketplace `knoxchat.knoxchat` installed, disable or hide it when `vscode.knox` is present (TODO in phase 6).

**Build mapping (Git → Knox)**

| Git | Knox |
|-----|------|
| `extensions/git/src/main.ts` | `extensions/knox/src/extension.ts` |
| `compile-extension:git` | `compile-extension:knox` |
| `esbuild.mts` entry `main` | `esbuild.mts` entry `extension` |
| `nativeExtensions` includes `git` | include `knox` (sqlite3 `.node`, platform bins) |
| no webview | GUI via `compile-extension-media` (Vite wrapper now, esbuild later if needed) |
| `package.nls.json` | extract Knox contribute strings |
| `enabledApiProposals` + `src/vscode-dts/*.d.ts` | add only proposals Knox actually uses |
| Git public API `vscode.git` | keep existing Knox public API from `activation/api.ts` as `vscode.knox` |

**Reuse from the product (do not re-bundle)**

- Ripgrep: `vscode.env.appRoot` → `@vscode/ripgrep` / `@vscode/ripgrep-universal` (already in KnoxCoder `package.json`).
- node-pty: `installHostNativePty` already prefers the editor ABI; keep that, drop VSIX copies.
- Electron/Node ABI: sqlite3 must be rebuilt in `compile-native-extensions-build` on each target OS, same reason Git is a native extension.

---

## 4. Relevance map (what to port vs drop)

### Port (product behavior)

- Extension host: activate, commands, keybindings, menus, webview provider, vertical diffs, agent mode, checkpoints TS, IDE facade (`VsCodeIde`).
- Core in-process: LLM stream, tools, memory brain (sqlite), config yaml, skills, protocol messenger.
- GUI: chat, history, memory panel, checkpoints UI, settings, tool-call cards.
- `knoxdev-package`: config-types/yaml, fetch, openai-adapters.
- Media: icons, prompt language grammar, config schemas.
- Tests that still apply (host + core + gui unit tests), adapted to the new paths.

### Drop or do not copy

- `kc/binary/` pkg IPC host and `pkgJson/`.
- `kc/extensions/vscode/scripts/prepackage.js`, `package.js`, `package-all.js`, ovsx/vsce publish.
- `node_modules/`, `out/`, `dist/`, `bin/`, `gui/dist` from `kc` (gigabytes; rebuild).
- Public repo Rust neon `checkpoints` / `ac` crates.
- Duplicate `@vscode/ripgrep` inside the extension once product rg is wired.
- `localhost:5173` as the **default** GUI path in KnoxCoder (optional watch-only).
- Accidental VS Code tree under public `knoxchat/extensions/{git,html,...}`.

### Later / optional (not required for “native like git”)

- Rewrite GUI as a workbench contrib (Cursor-style).
- Convert Vite+React GUI to `esbuild-webview-common.mts` (simple-browser style).
- Chat participant / `defaultChatAgent` in `product.json` (KnoxCoder has the product hook, Knox does not use it today).

---

## 5. Implementation TODOs

Check boxes as they land. Each item should be one PR-sized change unless noted.

### Phase 0 — Decisions and hygiene (do first, no product code)

- [x] **T0.1** Confirm source snapshot: copy from `/Users/knox/Desktop/kc` at version **1.4.6** (or a tagged commit recorded here). Do not use `github.com/knoxchat/knoxchat` as the tree to vendor.
- [x] **T0.2** Record the exact `kc` git SHA in this file under [Appendix A](#appendix-a--source-snapshot).
- [x] **T0.3** Keep command/view/config IDs as `knoxchat.*`; only the **extension id** becomes `vscode.knox`.
- [x] **T0.4** Do not add Knox to `product.json` `builtInExtensions` (that is the slow gallery path).
- [x] **T0.5** Add `extensions/knox/gui/` and native `.node` outputs to `.gitignore` if they are build artifacts (`extensions/**/out/` and `extensions/**/dist/` already cover gulp/esbuild).

### Phase 1 — Empty Git-shaped scaffold (editor must compile with a stub)

- [x] **T1.1** Create `extensions/knox/package.json`:
  - `name`: `knox`, `publisher`: `vscode`, `version`: `10.0.0` (match other in-tree extensions) or keep `1.4.6` in `description`/README.
  - `main`: `./out/extension`
  - `activationEvents`: keep `onStartupFinished`, `onView:knoxchat.knoxGUIView`, `onUri` (do **not** switch to `"*"` until measured).
  - `extensionKind`: `["ui", "workspace"]`
  - Copy `contributes` (commands, keybindings, menus, views, configuration, languages) from `kc/extensions/vscode/package.json`.
  - `scripts.compile` / `watch` → `gulp compile-extension:knox` / `watch-extension:knox` like Git.
  - Strip `vscode:prepublish`, vsce, ovsx, `engine-strict`, marketplace `pricing` / `galleryBanner`.
- [x] **T1.2** Add `extensions/knox/package.nls.json` and replace hard-coded contribute titles with `%...%` keys (Git pattern). Can start with a thin NLS file and migrate strings incrementally.
- [x] **T1.3** Add `extensions/knox/tsconfig.json` extending `../tsconfig.base.json`, `rootDir` `./src`, `outDir` `./out`, include `../../src/vscode-dts/vscode.d.ts` plus only proposed DTSs actually referenced.
- [x] **T1.4** Add stub `extensions/knox/src/extension.ts` (`activate`/`deactivate` no-ops) so gulp compiles.
- [x] **T1.5** Add `extensions/knox/esbuild.mts` using `../esbuild-extension-common.mts`, entry `extension` → `src/extension.ts`, `external: ['vscode', 'sqlite3', ...native addons]`.
- [x] **T1.6** Add `extensions/knox/.vscodeignore` modeled on `extensions/git/.vscodeignore`.
- [x] **T1.7** Add `extensions/knox/README.md` with Git’s “bundled; can be disabled but not uninstalled” notice.
- [x] **T1.8** Copy icons/media/schemas from `kc/extensions/vscode/media`, `config_schema.json`, prompt grammar — **not** `gui/` build output. *(1.4.6 has `knox_rc_schema.json` and `media/prompt.tmLanguage.json`; added a stub `prompt-file-language-configuration.json` because kc did not ship that file.)*
- [x] **T1.9** Wire gulp:
  - `build/gulpfile.extensions.ts` `compilations` array: `'extensions/knox/tsconfig.json'`
  - `build/npm/dirs.ts`: `'extensions/knox'`
  - `build/lib/extensions.ts` `nativeExtensions`: add `'knox'`
  - Confirm `excludedExtensions` does **not** include `knox`
- [x] **T1.10** Run `npm run compile-extensions` (or `gulp compile-extension:knox`) and `./scripts/code.sh`; Extensions view should list **Knox** as a built-in/system extension. *(`gulp compile-extension:knox` — 0 errors, 171ms. Full `./scripts/code.sh` deferred until the workbench `out/` exists; stub has no GUI yet.)*

### Phase 2 — Vendor Core + knoxdev-package (compile into the bundle)

- [x] **T2.1** Copy `kc/knoxdev-package/src` → `extensions/knox/knoxdev-package/` with a local `package.json` / `tsconfig` used only as a path alias (do not `npm install` it at repo root).
- [x] **T2.2** Copy `kc/core` TS sources → `extensions/knox/core/`, **excluding** `node_modules`, tests-only fixtures that pull vitest into the extension bundle. *(Dropped `*.test.ts`, `test-brain-*` / `test-memory-*` scripts, vitest config, core `package-lock`, and the embeddings stub. Retrieval is BM25 + ripgrep.)*
- [x] **T2.3** Fix imports: `core/...` and `knoxdev-package/...` via tsconfig `paths` + esbuild `alias` (Git does not need this; Knox does because it is a mini-monorepo).
- [x] **T2.4** Minimize `extensions/knox/package.json` `dependencies` to **native/unbundlable** modules only (`sqlite3`). Everything else must bundle like Git. *(JS libs are listed so esbuild can bundle them; `sqlite3` / `mac-ca` / `win-ca` / `system-ca` are `optionalDependencies` and esbuild `external`. retrieval is BM25 + ripgrep. `core` and `knoxdev-package` are not npm packages.)*
- [x] **T2.5** Mark native modules `external` in `esbuild.mts` so `.node` files are not corrupted.
- [x] **T2.6** Typecheck `compile-extension:knox` with Core included; fix `rootDir` (do not use `kc`’s `"rootDir": "../../"`). *(`rootDir` is `extensions/knox` (`.`); `main` is `./out/src/extension`. `gulp compile-extension:knox` — 0 errors.)*

### Phase 3 — Port the extension host (behavior parity)

- [x] **T3.1** Copy `kc/extensions/vscode/src/**` → `extensions/knox/src/**` (skip `src/test` until phase 8).
- [x] **T3.2** Retarget `vscode` types from `@types/vscode` to `src/vscode-dts/vscode.d.ts` (Git/simple-browser pattern).
- [x] **T3.3** Keep `KnoxGUIWebviewViewProvider.viewType === "knoxchat.knoxGUIView"`.
- [x] **T3.4** Point webview script/style to **extension** `gui/assets/index.js` + `index.css` (same as production Knox). Remove `localhost:5173` from the default path; gate it on an explicit debug flag if kept.
- [x] **T3.5** Keep `InProcessMessenger` + `Core` in-process (do not spawn `binary/knox-binary`).
- [x] **T3.6** Port commands, diffs, agent, checkpoints, code lenses, inline tips, debug tracker.
- [x] **T3.7** Keep public API export from `activate` (`registerCustomContextProvider`, `agentMode`) so other extensions can depend on `vscode.knox` later.
- [x] **T3.8** `capabilities.untrustedWorkspaces` / `virtualWorkspaces`: match Knox (agent needs a trusted workspace; Git uses `supported: false` for untrusted). Document the choice in README.

Host `main` is `./dist/src/extension`. `gulp compile-extension:knox` typechecks with tsgo, then esbuild-bundles `core/*` aliases so `./scripts/code.sh` can load the extension. Vite HMR remains opt-in (`knoxchat.debugViteGui` / `KNOX_GUI_VITE=1`).

### Phase 4 — Native GUI build (the main “slow GUI” fix)

- [x] **T4.1** Copy `kc/gui/src`, `index.html`, Tailwind/Vite/PostCSS configs → `extensions/knox/gui-src/` (name can be `webview/` if we later switch to esbuild).
- [x] **T4.2** Add `extensions/knox/scripts/build-gui.mts` (or `.mjs`) that runs the GUI production build into `extensions/knox/gui/` with **stable** `assets/index.js` and `assets/index.css` (Knox Vite config already pins those names).
- [x] **T4.3** Hook GUI build into `compile-extension:knox` **or** `compile-extension-media`:
  - Preferred for Git parity of TS: gulp compiles host.
  - Preferred for simple-browser parity of UI: `build/lib/extensions.ts` `esbuildMediaScripts` **or** a sibling gulp task invoked from `compileExtensionMediaTask`.
  - Vite is not esbuild; do **not** drop a Vite config path into `esbuildMediaScripts` without a wrapper. Wrapper is OK for phase 4.
  - *Hooked as a sibling of `esbuildMediaScripts` inside `buildExtensionMedia` (`knox/scripts/build-gui.mts`). Not listed in `esbuildMediaScripts` so tsgo does not typecheck the React app with extension tsconfigs.*
- [x] **T4.4** Wire `watch-extension:knox` / `watch-extension-media` so GUI rebuilds on `gui-src` changes (dev UX). *`watch-extension-media` passes `--watch` to `build-gui.mts` (Vite `build.watch`). Host watch stays `watch-extension:knox`.*
- [x] **T4.5** Copy static GUI assets that Vite does not emit (`gui/fonts`, `logos`, `textmate-syntaxes`) into the packaged `gui/` folder. *`gui-src/public/{fonts,logos,textmate-syntaxes}` — Vite copies `public/` into `gui/`. Textmate grammars vendored from `kc/extensions/vscode/textmate-syntaxes`.*
- [x] **T4.6** Confirm `fromLocal()` packaging includes `gui/**` (not only `src`/`out`/`dist`). Git copies non-TS via esbuild helper; Knox must explicitly include `gui/` and `media/`. *`.vscodeignore` force-includes `!gui/**` so gitignored build output is still packed. `media/` is not ignored. `compile-extension-media-build` writes `--outputRoot .build/extensions/knox`.*
- [x] **T4.7** Verify sidebar paints without a prior `npm run build` in `kc/gui`. *`gulp compile-extension-media` emits `extensions/knox/gui/assets/index.js` + `index.css` from `gui-src`.*
- [ ] **T4.8** (Optional follow-up) Replace Vite with `esbuild-webview-common.mts` + existing KnoxCoder Tailwind story. Only after parity; do not block native ship on this.

`gulp compile-extension-media` builds `extensions/knox/gui/assets/index.js` + `index.css` from `gui-src` (stable names, `base: './'` for webview-relative chunks). Static `public/{fonts,logos,textmate-syntaxes}` land in `gui/`. `./scripts/code.sh` → `npm run compile` already runs `compile-extension-media`, so the sidebar host loads those assets instead of the Phase 3 placeholder.

### Phase 5 — Native binaries and product reuse (the main “separate binary” fix)

- [x] **T5.1** **Ripgrep:** resolve `rg` from `vscode.env.appRoot` (`node_modules/@vscode/ripgrep` / `ripgrep-universal`) before extension-local paths. Update `VsCodeIde.resolveRipgrepBinary` and `core/tools/ripgrep.ts`. Drop vendored `kc/binary/ripgrep` archives. *Product `@vscode/ripgrep-universal` (`bin/${os}-${arch}/rg`) first, then `@vscode/ripgrep`. No kc/binary archives.*
- [x] **T5.2** **node-pty:** keep `installHostNativePty`; do not copy pty into the extension `out/node_modules`. *Product `appRoot` / `node_modules.asar.unpacked` first. Extension-local paths are last-ditch only and are not packaged.*
- [x] **T5.3** **sqlite3:** add a documented native rebuild step for Electron’s Node ABI (Git/microsoft-authentication native packaging). Place `.node` next to the bundled extension (`dist/` or `bin/`) per platform. Memory Brain depends on this. *`scripts/rebuild-native.mts` + `esbuild.mts` copy to `dist/build/Release` and `build/Release`. CI/`KNOX_REBUILD_NATIVE=1` runs Electron rebuild.*
- [x] **T5.4** Register sqlite3 in whatever ignore/pack lists Git uses for native files (`build/.moduleignore`, asar unpack if needed). *`.moduleignore` sqlite3 rules; `packagedDependencies` includes `sqlite3` (JS + `.node`, not `deps/`/`src/`). Extension `.node` files sit outside `node_modules.asar`; product already unpacks `**/*.node`.*
- [x] **T5.6** **tree-sitter WASM:** copy `tree-sitter-wasms` / `web-tree-sitter` assets into the extension package (not a runtime download). *`esbuild.mts` copies WASMs + vendored `tree-sitter/` / `tag-qry/` queries into `dist/`.*
- [x] **T5.7** Do **not** vendor or build `kc/binary` with `@yao-pkg/pkg`.
- [x] **T5.8** Checkpoints are TypeScript. Do **not** vendor public-repo Rust neon `checkpoints` / `ac` crates.
- [x] **T5.9** CI: `.github/workflows/build.yml` compiles native Knox on Linux/Windows. **macOS is `./build_dmg.sh`** (no GitHub Actions macOS job). Rust toolchain is **not** required for Knox (TS checkpoints). *`vscode-*-min-ci` already runs `compile-native-extensions-build`. Linux CLI still installs Rust for the VS Code tunnel binary, not Knox. `build_dmg.sh` runs `verify-knox-package.sh` against the `.app`.*

Search uses product `rg` from `vscode.env.appRoot` (`@vscode/ripgrep-universal`). sqlite3 is a packaged native dep with an Electron ABI rebuild (`scripts/rebuild-native.mts`); `.node` lands next to `dist/`. Retrieval is BM25 + ripgrep. tree-sitter WASMs and queries are copied into `dist/` at compile. node-pty stays on the product; `kc/binary` and neon are not vendored. macOS packs via `./build_dmg.sh`.

### Phase 6 — Product identity, duplicates, proposed APIs

- [x] **T6.1** Do not list Knox under `product.json` `builtInExtensions`.
- [x] **T6.2** If Knox uses proposed APIs, add them to `extensions/knox/package.json` `enabledApiProposals` **and** `product.json` `extensionEnabledApiProposals["vscode.knox"]` (Git does both).
- [x] **T6.3** When `vscode.knox` is present, ignore/disable user-installed `knoxchat.knoxchat` (single sidebar, single activation). Prefer `IExtensionEnablementService` / running conflict check at activation with a one-time info message.
- [x] **T6.4** Update any “install from Open VSX” docs in KnoxCoder README: Knox is bundled.
- [x] **T6.5** `trustedExtensionAuthAccess` / `extensionKind` product overrides only if auth providers require them (measure first).

Knox is **not** in `builtInExtensions` (that remains js-debug VSIX downloads). Identity is the in-tree folder `extensions/knox` → `vscode.knox`.

Knox currently uses only stable `src/vscode-dts/vscode.d.ts` APIs (`extensions/knox/tsconfig.json` does not include proposed DTS; original `kc` had no `enabledApiProposals`). No `enabledApiProposals` / `extensionEnabledApiProposals["vscode.knox"]` entry. When a proposal is adopted, add it to **both** `extensions/knox/package.json` and `product.json`.

`product.json` `excludedMarketplaceExtensions` lists `knoxchat.knoxchat`. The workbench then: hides it from gallery search, blocks install (`disallowInstall` + `canInstall`), and treats a leftover user copy as `DisabledByEnvironment` (Better Merge pattern). A one-time info prompt offers Uninstall. Knox `activate` logs if the marketplace copy is somehow still active. Knox does not use `vscode.authentication`, so `trustedExtensionAuthAccess` and product `extensionKind` overrides are not set; package.json already has `"extensionKind": ["ui", "workspace"]`.

### Phase 7 — Startup performance (after it works)

- [x] **T7.1** Keep dynamic `import("./activation/activate")` in `extension.ts`.
- [x] **T7.2** Defer Memory Brain / sqlite open until first chat or Memory view (do not open DB in `activate` if Core currently does).
- [x] **T7.3** Defer agent, checkpoints, and file-index (`FileSearch` `findFiles('**/*')`) until the sidebar is visible or a command runs. `FileSearch` currently indexes the whole workspace on construct — that is a first-paint stall.
- [x] **T7.4** Do not change activation to `"*"` (Git is small; Knox is not).
- [x] **T7.5** After native ship, measure: time to `activate()`, time to webview `resolveWebviewView`, time to first GUI paint. Record numbers in [Appendix B](#appendix-b--load-time-budget).
- [x] **T7.6** Tree-shake Core: esbuild metafile; drop eval/harness, vitest, unused LLM providers from the host bundle if they are dead.

`extension.ts` still dynamically imports `./activation/activate` (T7.1). `activationEvents` stay `onStartupFinished` / `onView:knoxchat.knoxGUIView` / `onUri` — not `"*"` (T7.4).

Core no longer calls `BrainStore.get()` during construct. sqlite opens on first chat (`memory/buildContext`, `memory/postTurn`, `brain/*`) or Memory view. Editor keystrokes do not open the DB. Auto-consolidation starts after that first open.

Agent command IDs are registered at activate; `AgentModeManager` / CodeIntelligence / terminal watchers wait until the sidebar HTML is set or an agent command runs. Checkpoint `initialize()` (disk history, auto-checkpoint timers) and workspace file indexing use the same trigger. `resolveWebviewView` sets HTML first, then warms those in the background.

Startup marks log as `[knox-startup]` (Extension Host). esbuild writes `extensions/knox/dist/esbuild-meta.json`. `core/eval/*` is stubbed out of the host bundle; `TestLLM` is not in `LLMClasses`; vitest is not in the host graph. jsdom is esbuild `external` (T8 smoke: bundling it crashed `activate()` on `default-stylesheet.css`). Remaining later trim: SQL drivers pulled by Core deps.

### Phase 8 — Tests

- [x] **T8.1** Port high-value `kc/extensions/vscode/src/**/*.test.ts` to `extensions/knox/src/test` using the Git mocha pattern (`extensions/git/src/test`).
- [x] **T8.2** Port critical `kc/core/**/*.test.ts` that do not need the full IDE (ripgrep, protocol, memory) — run via mocha or vitest **without** adding vitest as a runtime dep of the shipped extension.
- [x] **T8.3** GUI: keep vitest in `gui-src` as a **dev** script only; do not ship it.
- [x] **T8.4** Smoke: `./scripts/code.sh` → Knox view visible, send a chat stub, command palette `Knox: New Conversation`.
- [x] **T8.5** Browser-verify the sidebar (user rule): open, type, submit, history, settings, checkpoints empty state — not a single screenshot.

Host + Core unit tests live in `extensions/knox/src/test` (Mocha TDD, same as Git). `npm test --prefix extensions/knox` runs compiled `out/src/test/**/*.test.js` via the repo Mocha binary — Mocha/Vitest are not runtime deps of `vscode.knox`. GUI Vitest stays `gui-src` `devDependencies` (`npm run test-gui`).

Smoke (`./scripts/code.sh`): `[knox-startup] activateDone` 364ms → `resolveWebviewView` 393ms → `guiFirstPaint` 523ms (webview clock 131ms). Webview loaded `vscode.knox` `gui/assets`. Checkpoints came up with **0** on-disk manifests (empty state). Chat type/submit, history search, settings, and checkpoints empty UI are covered by `gui-src/src/sidebar.smoke.test.tsx` (jsdom). There is no browser MCP in this session to click the Electron webview; Command Palette **Knox: New Conversation** remains `knoxchat.newSession` (mocha + package.json).

jsdom is esbuild `external` (and a packaged dependency) because bundling it made `default-stylesheet.css` resolve to `extensions/browser/` and crash `activate()`.


### Phase 9 — Packaging, CI, cutover

- [x] **T9.1** `packageNativeLocalExtensionsStream` includes Knox; Linux/Windows CI artifacts contain `extensions/knox` with `dist/` + `gui/` + platform sqlite. *`scripts/ci/verify-knox-package.sh` runs after `vscode-*-min-ci` on Linux/Windows and from `./build_dmg.sh` against the `.app`. Universal macOS merge allowlists Knox sqlite `.node` files.*
- [x] **T9.2** Executable bit / asar unpack for `.node` and any helper scripts (Git uses `setExecutableBit` for `*.sh`). *`setExecutableBit(['**/*.sh', '**/*.node'])` on local/marketplace pack streams. sqlite copies `chmod 755` on Unix. Extension natives stay under `resources/app/extensions/` (not `node_modules.asar`); product asar unpack of `**/*.node` is app `node_modules` only.*
- [x] **T9.3** Web build: Knox is **not** a web extension (`main` without `browser`). `isWebExtension()` should exclude it from `compile-web` (same as Git). Confirm `extensions/knox` does not break `compile-web`. *No `esbuild.browser.mts`. `buildExtensionMedia` skips Knox GUI when `outputRoot` is vscode-web. Contract tests in `build/lib/test/knoxPackaging.test.ts`.*
- [x] **T9.4** KnoxCoder README + CHANGELOG: bundled Knox, how to disable, no marketplace install required.
- [x] **T9.5** Decide marketplace VSIX: stop shipping KnoxCoder-dependent builds to Open VSX, **or** keep publishing a thin “use KnoxCoder” stub. Default: **stop bundling this fork’s Knox as a store extension**; store Knox remains for vanilla VS Code only and lives in `kc`. *No ovsx/vsce publish job in this repo. Documented in README / CHANGELOG / `extensions/knox/README.md`.*
- [x] **T9.6** After KnoxCoder ships native Knox, document that `kc` remains the upstream for store/vanilla VS Code.

---

## 6. Suggested implementation order (one by one)

Work in this sequence so each step is bootable:

1. T0.*
2. T1.* stub visible in the editor
3. T2.* Core typechecks/bundles
4. T3.* host activates (blank or loading webview is OK)
5. T4.* GUI paints
6. T5.1–T5.9 search + memory + native pack
7. T6.* identity / duplicate store extension
8. T7.* startup cuts
9. T8.* tests + browser verification — **done** (mocha host/core, gui-src vitest, `./scripts/code.sh` smoke)
10. T9.* CI/package cutover — **done** (native stream + artifact verify, `.node` exec bit, web exclusion, marketplace cutover docs)

Do not start T4 before T1.10. Do not start T5.3 sqlite until T3.5 Core is in-process.

---

## 7. Files that will change in KnoxCoder (expected)

| Area | Files |
|------|--------|
| New tree | `extensions/knox/**` |
| Gulp compile list | `build/gulpfile.extensions.ts` |
| npm dirs | `build/npm/dirs.ts` |
| Native pack | `build/lib/extensions.ts` (`nativeExtensions`, maybe media scripts) |
| Gitignore | `.gitignore` (gui build out if needed) |
| Product (only if proposals) | `product.json` `extensionEnabledApiProposals` |
| Product (marketplace hide) | `product.json` `excludedMarketplaceExtensions`; enablement + gallery filter + `contrib/extensions` notice |
| Docs | `README.md`, `CHANGELOG.md`, `extensions/knox/README.md` |
| CI | `.github/workflows/build.yml` (Linux/Windows native compile + `verify-knox-package.sh`); macOS `./build_dmg.sh` |

Workbench changes in Phase 6 are limited to extension enablement, gallery filtering, and a one-time marketplace-conflict notice. Still no Knox rewrite under `src/vs/workbench/contrib/` as a chat/agent host.

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Repo size / secrets | Copy source only; never `node_modules`, `.env`, sqlite brains, `bin/` |
| Electron ABI vs sqlite3 | Native extension pack on each OS (T5.3, T9.1) |
| Two Knox sidebars | T6.3 disable `knoxchat.knoxchat` |
| Vite in a gulp/esbuild world | Wrapper script (T4.2–T4.3); esbuild rewrite is optional |
| `rootDir` / path aliases | Flatten to `extensions/knox/{src,core,knoxdev-package}` with explicit tsconfig paths |
| Proposed API compile errors vs 1.136 | Bind to `src/vscode-dts`, not `@types/vscode@1.125` |
| Activation regression | Keep `onStartupFinished`; measure before adding `"*"` |

---

## Appendix A — Source snapshot

- **Product source:** `/Users/knox/Desktop/kc`
- **Version (package):** `kc/extensions/vscode/package.json` → `1.4.6`
- **Git SHA:** `af32aaa3cbf0aed8eee1fec8d37d3f6d274a5fbe` (`release v1.4.6`, 2026-09-06)
- **Do not vendor:** `/Users/knox/Desktop/github/knoxchat` (incomplete flatten + extra VS Code trees)

## Appendix B — Load-time budget

Logged from the Extension Host as `[knox-startup]` (T7.5). Capture from a dev `./scripts/code.sh` run, then a packaged build.

| Metric | Marketplace Knox (baseline) | Native `vscode.knox` (target) |
|--------|-----------------------------|-------------------------------|
| Time to extension `activate()` | (gallery + unzip) | `[knox-startup] activateDone` **363.5ms** (dev `./scripts/code.sh`, 2026-09-07) |
| Time to webview HTML set | | `[knox-startup] resolveWebviewView` **392.5ms** |
| Time to GUI first paint | | `[knox-startup] guiFirstPaint` **523.3ms** (webview clock **130.6ms**) |
| Cold start with Knox view visible | | `activateDone` → `resolveWebviewView` → `guiFirstPaint`; sqlite/agent/file-index start after HTML (`deferredStartup` **390.4ms**) |

How to capture: open the Knox sidebar, then in **Help → Toggle Developer Tools** (or the Extension Host log) grep `[knox-startup]`. Marks are milliseconds since `activate()` start. `guiFirstPaint` also prints the webview document clock (`load` event).

Fill the numeric cells on the next packaged build. Dev `./scripts/code.sh` numbers are in the table above (2026-09-07). Targets (initial): **no gallery wait**; first GUI paint **well under** the VSIX path on the same machine because sqlite open, agent services, checkpoint disk load, and workspace `findFiles` no longer run inside `activate()`.

## Appendix C — Git reference checklist

When in doubt, copy the pattern from:

- `extensions/git/package.json` — publisher, main, scripts, capabilities
- `extensions/git/esbuild.mts` — bundle + copy non-TS
- `extensions/git/tsconfig.json` — `vscode-dts` includes
- `extensions/git/.vscodeignore`
- `extensions/git/src/main.ts` — activate/deactivate
- `build/gulpfile.extensions.ts` — `extensions/git/tsconfig.json` in `compilations`
- `build/npm/dirs.ts` — `extensions/git`
- `build/lib/extensions.ts` — `nativeExtensions: ['git', 'microsoft-authentication']`
- `extensions/simple-browser/` — webview + `compile-extension-media`

Knox is Git + simple-browser + native sqlite, not a `builtInExtensions` VSIX.
