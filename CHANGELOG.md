# Changelog

All notable changes to KnoxCoder are documented in this file.

## [1.136.2] - 2026-09-07

### Added

- **Knox Agent (`vscode.knox`)**
  Knox ships inside the editor as a system extension (same class as Git): host `dist/`, webview `gui/`, and platform sqlite3. Linux/Windows CI packages it via `packageNativeLocalExtensionsStream` and verifies those artifacts. macOS uses `./build_dmg.sh` (no GitHub Actions macOS job). Disable it in the Extensions view if you need to; it cannot be uninstalled.

### Changed

- Bumped product version to **1.136.2** (`package.json` / related product metadata).
- Marketplace Knox (`knoxchat.knoxchat`) is not required in KnoxCoder and is hidden/blocked. This fork does **not** publish a KnoxCoder-dependent VSIX to Open VSX. Store Knox for vanilla VS Code remains in the **kc** product tree.

### Removed

- Dropped leftover `onnxruntime-node` embeddings stubs. Memory and code search use BM25 + product ripgrep.
- No Rust neon checkpoint crates; checkpoints stay TypeScript.

## [1.136.1] - 2026-09-06

### Changed

- **Upgrade to VS Code 1.136.1**
  Merged upstream `microsoft/vscode` 1.136.1 while preserving Knox branding, Open VSX gallery, native TypeScript tooling, and Knox-specific customizations.

- Bumped product version to **1.136.1** (`package.json` / related product metadata).

### Removed

- **Chat, Copilot, and agent-host surfaces**
  Dropped upstream Copilot/chat/agent-host/MCP/sessions additions from 1.135–1.136 so KnoxCoder stays a VS Code fork with an isolated AI context.

### Files touched in this release

| Path | Action |
|------|--------|
| Upstream VS Code 1.136.1 merge surface | Updated |
| `package.json` / related product metadata | Modified (version 1.136.1, Knox toolchain preserved) |
| Copilot / chat / agent-host / sessions sources | Removed or not adopted |
| `CHANGELOG.md` | Modified |

## [1.134.0] - 2026-08-21

### Changed

- **Upgrade to VS Code 1.134.0**
  Merged upstream `microsoft/vscode` 1.134.0 while preserving Knox branding, Open VSX gallery, native TypeScript tooling, and Knox-specific customizations (no Copilot/chat/agent-host surfaces).

- Bumped product version to **1.134.0** (`package.json` / related product metadata).

- Adopted VS Code 1.134 Modern UI (`contrib/modernUI`), including Knox shell and scroll-shadow styles previously kept under `styleOverrides`.

- Enabled the 1.134 incremental `build-fast` pipeline, skipping Copilot compile when that extension is not present.

### Files touched in this release

| Path | Action |
|------|--------|
| Upstream VS Code 1.134.0 merge surface | Updated |
| `package.json` / `package-lock.json` | Modified (version 1.134.0, Knox toolchain preserved) |
| `src/vs/workbench/contrib/modernUI/**` | Added/updated (Knox CSS ported from styleOverrides) |
| `src/vs/workbench/contrib/styleOverrides/**` | Removed (renamed upstream to modernUI) |
| `CHANGELOG.md` | Modified |

## [1.132.0] - 2026-08-08

### Changed

- **Upgrade to VS Code 1.132.0**
  Merged upstream `microsoft/vscode` 1.132.0 while preserving Knox branding, Open VSX gallery, native TypeScript tooling, and Knox-specific customizations.

- Bumped product version to **1.132.0** (`package.json` / related product metadata).

### Fixed

- **`core-ci` esbuild bundle crash (`"version" is a required argument`)**
  Minified NLS + mangle-privates builds called async `adjustSourceMap` without `await`, so a Promise was passed into `SourceMapConsumer` and CI failed on Linux/Windows during `esbuild-vscode-reh-min`.
  **Change:** await both mangle and NLS source-map adjustments in `build/next/index.ts`.

- **Policy packaging failure against Open VSX**
  Language-pack fetches used the VS Marketplace `extensionquery` API, which Open VSX does not implement, aborting the whole policy build.
  **Change:** skip failed policy localizations with a warning and continue with English-only policies (`build/lib/policies/policyGenerator.ts`).

- **Stale `agentHost` esbuild entry points**
  Removed deleted `agentHostMain` / `diffWorkerMain` bundle entries so `core-ci` can bundle again after those mains were dropped.

- **Build TypeScript / source-map 0.8 compatibility**
  - Pin `@types/glob` to 7.x and `@types/minimatch` to 5.x (stub v9/v6 resolved against modern package types and broke default imports).
  - Add explicit `glob` dependency for the build package.
  - Update `build/lib/nls.ts` and `build/lib/tsb/builder.ts` for async `SourceMapConsumer`.
  - Type empty `webOnlyEntryPoints` as `string[]`.

### Removed

- **Telemetry / AI relevance plumbing**
  Dropped orphaned telemetry senders, AI related-information/settings search, OTLP/sqlite otel paths, inline-completions telemetry helpers, and related eslint/i18n wiring that no longer belongs in this product.

### Files touched in this release

| Path | Action |
|------|--------|
| `build/next/index.ts` | Modified (await source-map adjust; entry cleanup) |
| `build/lib/policies/policyGenerator.ts` | Modified (Open VSX-safe localization) |
| `build/lib/nls.ts` | Modified (async SourceMapConsumer) |
| `build/lib/tsb/builder.ts` | Modified (async SourceMapConsumer) |
| `build/package.json` / `build/package-lock.json` | Modified (glob types + dep pins) |
| Telemetry / otel / agentHost-related sources | Removed or cleaned |
| Upstream VS Code 1.132.0 merge surface | Updated |

## [1.131.0] - 2026-08-05

### Fixed

- **HTML Language Server crash on startup**
  The HTML language features server (ESM bundle) died immediately with `ReferenceError: __filename is not defined` because bundled `@typescript/typescript6` still expects CommonJS globals. That produced the UI errors (`-32097`, connection disposed, “crashed 5 times”).
  **Change:** extend the esbuild banner in `extensions/html-language-features/esbuild.mts` to define `__filename` / `__dirname` from `import.meta.url` alongside the existing `createRequire` shim.

- **macOS codesign failures from Apple timestamp flakes**
  Production DMG builds could fail mid-sign with `The timestamp service is not available` when Apple’s timestamp authority flaked under Electron’s many nested signatures.
  **Changes:**
  - Retry transient keychain/timestamp errors in `build/darwin/sign.ts` (up to 5 attempts with backoff).
  - Add `codesign_with_retry` for DMG signing in `build_dmg.sh`.

### Added

- **Knox Lucide icon font pipeline**
  - New generator: `build/lib/generateKnoxLucideFont.ts` (`npm run generate-knox-icons`).
  - Generated assets under `src/vs/workbench/browser/media/knox/lucide/` (`codicon.ttf`, `icon-map.json`).
  - Typings for `oslllo-svg-fixer`; deps: `fantasticon`, `lucide-static`, `oslllo-svg-fixer`.

- **Knox shell style overrides**
  - New stylesheet `src/vs/workbench/contrib/styleOverrides/browser/media/knoxShell.css`, wired into `styleOverrides.contribution.ts`.

### Changed

- Bumped product version to **1.131.0** (`package.json` / related product metadata).
- One Dark Pro dark theme token updates (`extensions/theme-onedark-pro/themes/dark.json`).
- Workbench theme defaults and related contribution tweaks (`workbenchThemeService`, `theme.ts`, `workbench.contribution.ts`, getting-started contribution).
- Build/preLaunch wiring for Knox icon generation and packaging (`build/lib/preLaunch.ts`, `compilation.ts`, `gulpfile.extensions.ts`, `scripts/build-app.sh`, `build/npm/dirs.ts`).
- Minor GitHub authentication experimentation-service / lockfile cleanup.

### Files touched in this commit

| Path | Action |
|------|--------|
| `extensions/html-language-features/esbuild.mts` | Modified |
| `build/darwin/sign.ts` | Modified |
| `build_dmg.sh` | Modified |
| `build/lib/generateKnoxLucideFont.ts` | Added |
| `build/lib/typings/oslllo-svg-fixer.d.ts` | Added |
| `src/vs/workbench/browser/media/knox/lucide/*` | Added |
| `src/vs/workbench/contrib/styleOverrides/browser/media/knoxShell.css` | Added |
| `package.json` / `package-lock.json` | Modified |
| Theme, workbench, and build wiring files listed above | Modified |
