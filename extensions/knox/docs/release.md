# Release pipeline notes (P0-3)

## Version scheme

- Product / npm: root `package.json` version. Today `2.0.0-beta`. Stable is `2.0.0` (no prerelease).
- `build/lib/packageVersion.ts`: `linuxPackageVersion("2.0.0")` is unchanged; `2.0.0-beta` becomes `2.0.0~beta` so Debian/RPM sort the beta before stable.
- Windows VersionInfo uses `numericPackageVersion` (strips `-beta` → `2.0.0`).
- `extensions/knox/package.json` stays `10.0.0` on purpose: it is a VS Code **system extension**, same dummy version as Git, TypeScript, and the other in-tree extensions. The product version is what users see.

Do not bump the product to `2.0.0` until the release checklist in `v2-impl.md` is done.

## Checksums

Publish SHA-256 next to every GitHub Release asset. `scripts/ci/generate-update-metadata.mjs` writes `SHA256SUMS` and puts `sha256hash` on each `latest-*.json` (Windows update service verifies it). The draft-release job uploads the whole `release/` folder, so checksums ship with the assets.

```
shasum -a 256 KnoxCoder-* > SHA256SUMS
```

Paste the sums into the release notes. `scripts/ci/generate-update-metadata.mjs` should keep `quality=stable` for a stable tag.

## Rollback

1. Mark the GitHub Release as a draft (or delete it) so `latest` no longer points at it.
2. Re-point `latest-darwin-*.json` / Windows / Linux update feeds at the previous good tag.
3. Do not delete the git tag until the feed is updated; a client that already downloaded the bad build should still be able to fetch the previous one by version.

## macOS notarization

`./build_dmg.sh` signs, notarizes, staples, and uploads `latest-darwin-<arch>.json`. Verify on a clean Mac that Gatekeeper opens the app.

## Windows SmartScreen

Code-sign the user and system installers when a cert is available. Without a signature, document the SmartScreen “unknown publisher” prompt. Verify upgrade from `1.138.2` and `2.0.0-beta`.

## Linux

Confirm `2.0.0~beta` upgrades to `2.0.0` for tar.gz, deb, and rpm.
