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
import { leftoverProductDirectoryExists } from "../../../scripts/inventory-gate.mts";
import {
  SHIPPED_TREE_SITTER_LANGUAGES,
  shouldCopyNodePtyEntry,
  shouldCopySqliteEntry,
  shouldShipTreeSitterWasm,
  treeSitterWasmFileName,
} from "../../../scripts/nativeFilters.mts";

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
    assert.ok(!leftoverProductDirectoryExists(repoRoot), join(repoRoot, leftoverKnoxRootNpmDir()));
  });
});

suite("Installer size", () => {
  function languageNameEnumValues(): string[] {
    const source = readRepo("extensions/knox/src/core/util/treeSitter.ts");
    const body = /export enum LanguageName \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
    return [...body.matchAll(/=\s*"([a-z_]+)"/g)].map((match) => match[1]);
  }

  test("every tree-sitter language the code can load ships a wasm, and nothing else does", () => {
    const enumValues = languageNameEnumValues();
    assert.ok(enumValues.length > 20, "failed to parse the LanguageName enum");
    // A language missing here silently breaks repo-map / symbol extraction in packaged builds.
    assert.deepStrictEqual(
      enumValues.filter((language) => !SHIPPED_TREE_SITTER_LANGUAGES.includes(language)),
      [],
    );
    // Keeps the allowlist from rotting back into shipping unused grammars.
    assert.deepStrictEqual(
      SHIPPED_TREE_SITTER_LANGUAGES.filter((language) => !enumValues.includes(language)),
      [],
    );
    assert.ok(shouldShipTreeSitterWasm(treeSitterWasmFileName("typescript")));
    for (const unused of ["kotlin", "objc", "swift", "tlaplus", "zig", "dart", "vue", "yaml", "scala"]) {
      assert.ok(!shouldShipTreeSitterWasm(treeSitterWasmFileName(unused)), unused);
    }
  });

  test("node-pty keeps only what the target platform can load", () => {
    const mac = { platform: "darwin", arch: "arm64" };
    for (const rel of [
      "",
      "package.json",
      "lib",
      "lib/index.js",
      "lib/worker/conoutSocketWorker.js",
      "build",
      "build/Release",
      "build/Release/pty.node",
      "build/Release/spawn-helper",
      "prebuilds",
      "prebuilds/darwin-arm64",
      "prebuilds/darwin-arm64/pty.node",
      "bin/darwin-arm64-148/node-pty.node",
    ]) {
      assert.ok(shouldCopyNodePtyEntry(rel, mac), `keep ${rel}`);
    }
    for (const rel of [
      "prebuilds/darwin-x64",
      "prebuilds/win32-x64/pty.node",
      "bin/darwin-x64-148/node-pty.node",
      "deps/winpty/misc/SetFont.cc",
      "src/unix/pty.cc",
      "third_party/conpty/1.23/win10-x64/conpty.dll",
      "node-addon-api/node_addon_api.Makefile",
      "binding.gyp",
      "build/Makefile",
      "build/config.gypi",
      "build/Release/obj.target/pty/src/unix/pty.o",
      "build/Release/.deps/Release/pty.node.d",
      "lib/index.js.map",
      "lib/unixTerminal.test.js",
      "lib/testUtils.test.js",
    ]) {
      assert.ok(!shouldCopyNodePtyEntry(rel, mac), `drop ${rel}`);
    }

    const win = { platform: "win32", arch: "x64" };
    assert.ok(shouldCopyNodePtyEntry("prebuilds/win32-x64/conpty.node", win));
    assert.ok(shouldCopyNodePtyEntry("prebuilds/win32-x64/winpty-agent.exe", win));
    assert.ok(shouldCopyNodePtyEntry("prebuilds/win32-x64/conpty/OpenConsole.exe", win));
    assert.ok(shouldCopyNodePtyEntry("prebuilds/win32-x64/conpty/conpty.dll", win));
    // ~28 MB of debug symbols per Windows architecture.
    assert.ok(!shouldCopyNodePtyEntry("prebuilds/win32-x64/pty.pdb", win));
    assert.ok(!shouldCopyNodePtyEntry("prebuilds/win32-arm64/pty.node", win));
    assert.ok(!shouldCopyNodePtyEntry("prebuilds/darwin-arm64/pty.node", win));
  });

  test("sqlite3 keeps only the JS wrapper and the compiled binding", () => {
    for (const rel of [
      "",
      "package.json",
      "LICENSE",
      "lib",
      "lib/sqlite3.js",
      "lib/sqlite3-binding.js",
      "build",
      "build/Release",
      "build/Release/node_sqlite3.node",
    ]) {
      assert.ok(shouldCopySqliteEntry(rel), `keep ${rel}`);
    }
    for (const rel of [
      "deps/sqlite-autoconf-3520000.tar.gz",
      "src/database.cc",
      "binding.gyp",
      "README.md",
      "node_modules/node-addon-api",
      "build/Makefile",
      "build/Release/obj.target/node_sqlite3/src/database.o",
    ]) {
      assert.ok(!shouldCopySqliteEntry(rel), `drop ${rel}`);
    }
  });

  test("copy-native no longer ships esbuild and uses the filters", () => {
    const script = readRepo("extensions/knox/scripts/copy-native.mts");
    assert.ok(!script.includes("copyEsbuild("));
    assert.ok(script.includes("shouldCopyNodePtyEntry"));
    assert.ok(script.includes("shouldCopySqliteEntry"));
    assert.ok(script.includes("SHIPPED_TREE_SITTER_LANGUAGES"));
    assert.ok(!readRepo("extensions/knox/esbuild.mts").includes("'esbuild', './xhr-sync-worker.js'"));
  });

  test("unused foundry-local-sdk (~150 MB of native cores per platform) stays out of the product", () => {
    const pkg = JSON.parse(readRepo("package.json")) as {
      dependencies?: Record<string, string>;
      allowScripts?: Record<string, boolean>;
    };
    assert.ok(!("foundry-local-sdk" in (pkg.dependencies ?? {})));
    assert.ok(!Object.keys(pkg.allowScripts ?? {}).some((key) => key.startsWith("foundry-local-sdk")));
    assert.ok(!readRepo("package-lock.json").includes("foundry-local-sdk"));
  });

  test("mermaid webview bundles are minified", () => {
    const script = readRepo("extensions/mermaid-markdown-features/esbuild.webview.mts");
    assert.ok(!/minify:\s*false/.test(script));
  });

  test("desktop workflow builds deb/rpm/installers only for release-style runs", () => {
    const workflow = readRepo(".github/workflows/build-desktop.yml");
    assert.ok(workflow.includes("all_packages:"));
    assert.ok(/FULL_PACKAGES:.*github\.event_name == 'push'/.test(workflow));
    for (const step of ["Package deb", "Package rpm", "Build installers"]) {
      const block = workflow.slice(workflow.indexOf(`- name: ${step}`)).split("\n      - ")[0];
      assert.ok(block.includes("env.FULL_PACKAGES == 'true'"), step);
    }
  });
});
