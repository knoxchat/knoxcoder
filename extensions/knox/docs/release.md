# Release pipeline notes (P0-3)

## Version scheme

- Product / npm: root `package.json` version. Today `2.0.0`.
- `build/lib/packageVersion.ts`: `linuxPackageVersion("2.0.0")` is unchanged; `2.0.0-beta` becomes `2.0.0~beta` so Debian/RPM sort the beta before stable.
- Windows VersionInfo uses `numericPackageVersion` (strips `-beta` → `2.0.0`).
- `extensions/knox/package.json` stays `10.0.0` on purpose: it is a VS Code **system extension**, same dummy version as Git, TypeScript, and the other in-tree extensions. The product version is what users see.

Product version is `2.0.0`. Further bumps go through `scripts/ci/release-check.mjs`.

## Cutting the release

```
node scripts/ci/release-check.mjs --bump 2.0.0            # dry run
node scripts/ci/release-check.mjs --bump 2.0.0 --write   # set package.json, promote CHANGELOG [Unreleased]
node scripts/ci/release-check.mjs --tag v2.0.0            # verify: tag == version, CHANGELOG dated,
                                                          # product quality stable, SECURITY.md lists the series
```

Run the last command on the release commit before pushing the `v2.0.0` tag. For a prerelease version (`2.0.0-rc.1`) the stable-only checks are skipped.

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

Code-sign the user and system installers when a cert is available (`signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a KnoxCoderSetup*.exe` and the same for the system installer). Without a signature, Windows shows SmartScreen “Windows protected your PC” / unknown publisher. Users click **More info → Run anyway**. Document that on the GitHub Release notes until a cert ships.

Upgrade check (user and system installers):

1. Install `1.138.2`, open a folder, send one chat turn, quit.
2. Install `2.0.0-beta` over it; confirm `~/.knoxcoder` sessions and Memory Brain still load.
3. Install `2.0.0` over the beta; confirm the same data and that Help → About shows `2.0.0` (no `-beta`).

## Linux

Confirm `2.0.0~beta` upgrades to `2.0.0` for tar.gz, deb, and rpm:

```
# deb
sudo apt install ./KnoxCoder_2.0.0-beta_amd64.deb   # records 2.0.0~beta
sudo apt install ./KnoxCoder_2.0.0_amd64.deb        # must replace the beta
# rpm
sudo rpm -Uvh KnoxCoder-2.0.0-beta*.rpm
sudo rpm -Uvh KnoxCoder-2.0.0-*.rpm
# tar.gz: unpack next to the previous tree and replace the symlink on PATH
```

`dpkg --compare-versions 2.0.0~beta lt 2.0.0` must be true (`build/lib/packageVersion.ts`).

## GitHub auto-update

`scripts/ci/generate-update-metadata.mjs` writes `quality=stable` and `sha256hash` on `latest-*.json`. After tagging `v2.0.0`, run **Build desktop apps** by hand (Actions → Run workflow, tick `publish_release`) — tagging does not start a build:

1. Confirm the draft Release contains installers, `SHA256SUMS`, and the `latest-*.json` files.
2. Publish the Release (not draft) so `latest` points at `2.0.0`.
3. On each OS, run a `2.0.0-beta` install and wait for the update prompt to `2.0.0`.
4. Attach checksums: the draft-release job already uploads `SHA256SUMS`; paste the sums into the Release notes.
