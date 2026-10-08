import * as assert from "node:assert";

import {
  KNOX_ELECTRON_ABI,
  KNOX_ELECTRON_ABI_BY_VERSION,
  KNOX_ELECTRON_REBUILD_MODULES,
  KNOX_ELECTRON_VERSION,
  KNOX_FORCE_ELECTRON_REBUILD,
  KNOX_SKIP_ELECTRON_REBUILD,
  knoxElectronModulesAbi,
  knoxElectronRebuildOptions,
  readKnoxElectronVersion,
  shouldForceKnoxElectronRebuild,
  shouldSkipKnoxElectronRebuild,
} from "../../../scripts/electronRebuild.mts";

suite("KN-383 Electron ABI rebuild", () => {
  test("this fork's Electron 43.7.7 maps to ABI 148", () => {
    assert.strictEqual(KNOX_ELECTRON_VERSION, "43.7.7");
    assert.strictEqual(KNOX_ELECTRON_ABI, 148);
    assert.strictEqual(KNOX_ELECTRON_ABI_BY_VERSION["43.7.7"], 148);
    assert.strictEqual(knoxElectronModulesAbi("43.7.7"), 148);
    assert.strictEqual(
      knoxElectronModulesAbi("99.0.0"),
      148,
      "unknown Electron still targets this fork's ABI",
    );
  });

  test("KNOX_SKIP_ELECTRON_REBUILD=1 skips; force rebuild is opt-in", () => {
    assert.strictEqual(KNOX_SKIP_ELECTRON_REBUILD, "KNOX_SKIP_ELECTRON_REBUILD");
    assert.strictEqual(KNOX_FORCE_ELECTRON_REBUILD, "KNOX_FORCE_ELECTRON_REBUILD");
    assert.strictEqual(
      shouldSkipKnoxElectronRebuild({ KNOX_SKIP_ELECTRON_REBUILD: "1" }),
      true,
    );
    assert.strictEqual(shouldSkipKnoxElectronRebuild({}), false);
    assert.strictEqual(
      shouldSkipKnoxElectronRebuild({ KNOX_SKIP_ELECTRON_REBUILD: "0" }),
      false,
    );
    assert.strictEqual(
      shouldForceKnoxElectronRebuild({ KNOX_FORCE_ELECTRON_REBUILD: "1" }),
      true,
    );
    assert.strictEqual(shouldForceKnoxElectronRebuild({}), false);
  });

  test("rebuild targets sqlite3 and node-pty for Electron ABI 148", () => {
    assert.deepStrictEqual([...KNOX_ELECTRON_REBUILD_MODULES], ["sqlite3", "node-pty"]);
    const opts = knoxElectronRebuildOptions({
      buildPath: "/ext/knox",
      force: true,
    });
    assert.strictEqual(opts.buildPath, "/ext/knox");
    assert.strictEqual(opts.electronVersion, "43.7.7");
    assert.deepStrictEqual(opts.onlyModules, ["sqlite3", "node-pty"]);
    assert.strictEqual(opts.forceABI, 148);
    assert.strictEqual(opts.force, true);
    assert.deepStrictEqual(opts.types, ["prod", "optional"]);
  });

  test("readKnoxElectronVersion prefers package.json electron, else 43.7.7", () => {
    assert.strictEqual(
      readKnoxElectronVersion({ devDependencies: { electron: "43.7.7" } }),
      "43.7.7",
    );
    assert.strictEqual(
      readKnoxElectronVersion({ dependencies: { electron: "43.7.7" } }),
      "43.7.7",
    );
    assert.strictEqual(readKnoxElectronVersion({}), "43.7.7");
  });
});
