import * as assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  KNOX_FORK_NPM_DIR,
  KNOX_GULP_COMPILE_TASKS,
  KNOX_GULP_FORBIDDEN_TASKS,
  KNOX_NATIVE_EXTENSION_NAME,
  assertNoKnoxMarketplaceBuiltins,
  assertNoLeftoverKnoxBuildPointers,
  gulpCompilationsExcludesKnoxTsconfig,
  gulpDefinesForbiddenKnoxTasks,
  gulpFileHasKnoxPackagingTasks,
  gulpJoinsLeftoverKnoxRoot,
  gulpSpawnsFromForkKnox,
  isKnoxMarketplaceBuiltinName,
  leftoverKnoxNpmDirNames,
  leftoverKnoxRootNpmDir,
  nativeExtensionsIncludesKnox,
  nativeExtensionsSourceIncludesKnox,
  npmDirEntriesPointAtLeftoverKnox,
  npmDirsExcludeLeftoverKnox,
  parseQuotedNpmDirs,
  shouldSkipGenericTsgoForExtension,
  vscodeIgnoreAllowsPackagedNatives,
} from "../../../scripts/packaging.mts";

const repoRoot = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (
      existsSync(join(dir, "product.json")) &&
      existsSync(join(dir, "extensions", "knox", "package.json"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../../");
})();

function readRepo(...parts: string[]): string {
  return readFileSync(join(repoRoot, ...parts), "utf8");
}

suite("KN-384 packaging", () => {
  test("nativeExtensions includes knox; gulp compile tasks are knox + native only", () => {
    assert.strictEqual(KNOX_NATIVE_EXTENSION_NAME, "knox");
    assert.deepStrictEqual([...KNOX_GULP_COMPILE_TASKS], [
      "compile-extension:knox",
      "compile-extension-knox-native",
    ]);
    assert.ok(nativeExtensionsIncludesKnox(["git", "knox", "microsoft-authentication"]));
    assert.ok(!nativeExtensionsIncludesKnox(["git", "microsoft-authentication"]));
    assert.ok(shouldSkipGenericTsgoForExtension("knox"));
    assert.ok(!shouldSkipGenericTsgoForExtension("git"));

    const gulp = readRepo("build/gulpfile.extensions.ts");
    const buildExt = readRepo("build/lib/extensions.ts");
    const knoxPkg = JSON.parse(readRepo("extensions/knox/package.json")) as {
      scripts?: { compile?: string; "compile-native"?: string };
    };

    assert.ok(gulpFileHasKnoxPackagingTasks(gulp));
    assert.ok(gulpCompilationsExcludesKnoxTsconfig(gulp));
    assert.ok(nativeExtensionsSourceIncludesKnox(buildExt));
    assert.ok(buildExt.includes("assertNoKnoxMarketplaceBuiltin"));
    assert.ok(buildExt.includes("skipGenericTypecheck"));
    assert.ok(buildExt.includes("KN-384"));
    assert.ok(gulp.includes("KN-384"));
    assert.ok(knoxPkg.scripts?.compile?.includes("compile-extension:knox"));
    assert.ok(
      knoxPkg.scripts?.["compile-native"]?.includes("compile-extension-knox-native"),
    );
    for (const forbidden of KNOX_GULP_FORBIDDEN_TASKS) {
      assert.ok(!gulp.includes(`task.define('${forbidden}'`), forbidden);
    }
  });

  test("product.json has no knox marketplace builtInExtensions entry", () => {
    assert.strictEqual(isKnoxMarketplaceBuiltinName("knox"), true);
    assert.strictEqual(isKnoxMarketplaceBuiltinName("vscode.knox"), true);
    assert.strictEqual(isKnoxMarketplaceBuiltinName("knoxchat.knoxchat"), true);
    assert.strictEqual(isKnoxMarketplaceBuiltinName("ms-vscode.js-debug"), false);

    const product = JSON.parse(readRepo("product.json")) as {
      builtInExtensions?: Array<{ name?: string }>;
      webBuiltInExtensions?: Array<{ name?: string }>;
    };
    assertNoKnoxMarketplaceBuiltins(product);
    assert.throws(
      () =>
        assertNoKnoxMarketplaceBuiltins({
          builtInExtensions: [{ name: "knoxchat.knoxchat" }],
        }),
      /KN-384/,
    );
  });

  test("vscodeignore packages dist/node_modules natives", () => {
    assert.strictEqual(
      vscodeIgnoreAllowsPackagedNatives("node_modules/**\n"),
      false,
    );
    assert.strictEqual(
      vscodeIgnoreAllowsPackagedNatives("/node_modules/**\n"),
      true,
    );
    assert.strictEqual(
      vscodeIgnoreAllowsPackagedNatives("node_modules/**\n!dist/node_modules/**\n"),
      true,
    );
    const ignore = readRepo("extensions/knox/.vscodeignore");
    assert.ok(vscodeIgnoreAllowsPackagedNatives(ignore));
    assert.ok(ignore.includes("/node_modules/**"));
    assert.ok(ignore.includes("KN-384"));
  });
});

suite("KN-391 gulp and npm leftover pointers", () => {
  test("npm dirs install extensions/knox and never the leftover product tree", () => {
    assert.strictEqual(KNOX_FORK_NPM_DIR, "extensions/knox");
    assert.strictEqual(leftoverKnoxRootNpmDir(), "knox");
    assert.ok(leftoverKnoxNpmDirNames().includes("knox"));
    assert.ok(leftoverKnoxNpmDirNames().includes(["knox", "core"].join("/")));
    assert.deepStrictEqual(
      npmDirEntriesPointAtLeftoverKnox(["extensions/knox", "extensions/git"]),
      [],
    );
    assert.deepStrictEqual(npmDirEntriesPointAtLeftoverKnox(["knox", "build"]), ["knox"]);
    assert.deepStrictEqual(
      npmDirEntriesPointAtLeftoverKnox([["knox", "core"].join("/")]),
      [["knox", "core"].join("/")],
    );

    const dirs = readRepo("build/npm/dirs.ts");
    assert.ok(dirs.includes("KN-391"));
    assert.ok(npmDirsExcludeLeftoverKnox(dirs));
    assert.ok(parseQuotedNpmDirs(dirs).includes(KNOX_FORK_NPM_DIR));
    assert.deepStrictEqual(npmDirEntriesPointAtLeftoverKnox(parseQuotedNpmDirs(dirs)), []);
    assert.ok(!npmDirsExcludeLeftoverKnox("export const dirs = ['knox'];"));
  });

  test("gulp compiles from extensions/knox and does not join leftover ./knox", () => {
    const gulp = readRepo("build/gulpfile.extensions.ts");
    assert.ok(gulp.includes("KN-391"));
    assert.ok(gulpSpawnsFromForkKnox(gulp));
    assert.ok(!gulpJoinsLeftoverKnoxRoot(gulp));
    assert.ok(!gulpDefinesForbiddenKnoxTasks(gulp));
    assertNoLeftoverKnoxBuildPointers({ dirsSource: readRepo("build/npm/dirs.ts"), gulpSources: [gulp] });
    assert.throws(
      () =>
        assertNoLeftoverKnoxBuildPointers({
          dirsSource: "export const dirs = ['knox'];",
          gulpSources: [gulp],
        }),
      /KN-391/,
    );
    assert.throws(
      () =>
        assertNoLeftoverKnoxBuildPointers({
          dirsSource: "export const dirs = ['extensions/knox'];",
          gulpSources: ["path.join(root, 'knox', 'core')"],
        }),
      /KN-391/,
    );
  });
});

suite("KN-392 leftover product directory", () => {
  test("repo root leftover product directory is gone", () => {
    assert.ok(!existsSync(join(repoRoot, leftoverKnoxRootNpmDir())));
  });
});
