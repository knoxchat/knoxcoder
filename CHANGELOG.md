# Changelog

All notable changes to KnoxCoder are documented in this file.

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
