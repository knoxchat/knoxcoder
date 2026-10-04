/**
 * Bundle `src/core/cli/main.ts` into `cli/dist/knox.js` for the installable
 * `@knoxchat/cli` package (P1-4).
 *
 *   node ./scripts/knox-cli-esbuild.mts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../../esbuild-extension-common.mts";
import { copyKnoxCliAssets } from "./copy-native.mts";
import {
  copyXhrSyncWorker,
  knoxBundlePlugins,
  knoxNodeModuleDirs,
} from "./knox-esbuild-plugins.mts";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knoxCoreDir = path.join(extensionDir, "src", "core");
const knoxPkgDir = path.join(extensionDir, "src", "pkg");
const cliEntry = path.join(knoxCoreDir, "cli", "main.ts");
const importMetaUrlShim = path.join(extensionDir, "scripts", "importMetaUrl.js");
const coreShim = path.join(extensionDir, "scripts", "core-package-shim.js");
const outDir = path.join(extensionDir, "cli", "dist");

if (!fs.existsSync(cliEntry)) {
  throw new Error(`Knox CLI entry missing: ${cliEntry}`);
}

await run(
  {
    platform: "node",
    entryPoints: { knox: cliEntry },
    srcDir: knoxCoreDir,
    outdir: outDir,
    additionalOptions: {
      absWorkingDir: extensionDir,
      nodePaths: knoxNodeModuleDirs(extensionDir),
      external: ["sqlite3", "node-pty", "./xhr-sync-worker.js"],
      loader: { ".node": "file", ".json": "json" },
      inject: fs.existsSync(importMetaUrlShim) ? [importMetaUrlShim] : undefined,
      define: {
        "import.meta.url": "importMetaUrl",
      },
      banner: { js: "#!/usr/bin/env node\n" },
      minify: true,
      sourcemap: true,
      plugins: knoxBundlePlugins({ knoxCoreDir, knoxPkgDir, coreShim }),
    },
    beforeBuild: () => {
      fs.mkdirSync(outDir, { recursive: true });
      copyXhrSyncWorker(extensionDir, outDir);
    },
  },
  process.argv,
  async (builtDir) => {
    copyXhrSyncWorker(extensionDir, builtDir);
    copyKnoxCliAssets(builtDir);
    const bundle = path.join(builtDir, "knox.js");
    if (!fs.existsSync(bundle)) {
      throw new Error(`Knox CLI esbuild did not produce ${bundle}`);
    }
    fs.chmodSync(bundle, 0o755);
    console.log(`Knox CLI bundle: ${bundle}`);
  },
);
