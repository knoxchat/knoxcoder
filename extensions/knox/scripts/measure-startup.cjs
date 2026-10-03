/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * K-038: measures how long it takes to evaluate the packaged host bundle
 * (`dist/extension.js`) with a stub `vscode` module. This is the module-load part
 * of activation (parsing + top-level code). It excludes `activate()` itself and
 * the real VS Code API cost, so use it as a regression signal, not an absolute.
 *
 *   node scripts/measure-startup.cjs [bundle] [--json]
 *
 * Prints `{ bundleBytes, loadMs, runs }` (median of 5 fresh processes when called
 * with no child flag). Exits 1 when the median exceeds KNOX_STARTUP_BUDGET_MS.
 */
const Module = require("module");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const bundle = path.resolve(
  process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ||
    path.join(__dirname, "..", "dist", "extension.js"),
);

function stub() {
  const handler = {
    get(target, key) {
      if (key === "__esModule") {
        return true;
      }
      if (key === "prototype") {
        return target.prototype;
      }
      if (key === Symbol.toPrimitive) {
        return () => "";
      }
      if (key === "then") {
        return undefined;
      }
      return makeStub();
    },
    apply: () => makeStub(),
    construct: () => makeStub(),
  };
  function makeStub() {
    return new Proxy(class {}, handler);
  }
  // esbuild's __toESM copies own keys, so the top-level API names must exist.
  const root = { __esModule: true };
  const dts = path.join(__dirname, "..", "..", "..", "src", "vscode-dts", "vscode.d.ts");
  if (fs.existsSync(dts)) {
    const text = fs.readFileSync(dts, "utf8");
    for (const m of text.matchAll(/^\texport (?:class|enum|namespace|function|const) (\w+)/gm)) {
      root[m[1]] = makeStub();
    }
  }
  root.env = new Proxy(
    { appRoot: "/nonexistent", language: "en", machineId: "m", sessionId: "s", appName: "Knox", uriScheme: "knox", uiKind: 1, remoteName: undefined, shell: "/bin/zsh" },
    { get: (t, k) => (k in t ? t[k] : makeStub()) },
  );
  root.UIKind = { Desktop: 1, Web: 2 };
  root.version = "1.100.0";
  return new Proxy(root, {
    get: (target, key) => (key in target ? target[key] : handler.get(class {}, key)),
  });
}

if (process.argv.includes("--child")) {
  (async () => {
  const originalLoad = Module._load;
  const vscodeStub = stub();
  Module._load = function (request, ...rest) {
    if (request === "vscode") {
      return vscodeStub;
    }
    return originalLoad.call(this, request, ...rest);
  };
  const start = process.hrtime.bigint();
  let error;
  let mod;
  try {
    mod = require(bundle);
  } catch (e) {
    error = String((e && e.message) || e).slice(0, 200);
  }
  const loadMs = Number(process.hrtime.bigint() - start) / 1e6;
  process.stdout.write(JSON.stringify({ loadMs, error }));
  process.exit(0);
  })();
} else {

const runs = [];
for (let i = 0; i < 5; i++) {
  const r = spawnSync(process.execPath, [__filename, bundle, "--child"], {
    encoding: "utf8",
  });
  try {
    runs.push(JSON.parse(r.stdout));
  } catch {
    console.error("measure-startup: child failed", r.stderr);
    process.exit(1);
  }
}
runs.sort((a, b) => a.loadMs - b.loadMs);
const median = runs[Math.floor(runs.length / 2)].loadMs;
const result = {
  bundleBytes: fs.statSync(bundle).size,
  loadMs: Math.round(median * 10) / 10,
  runs: runs.map((r) => Math.round(r.loadMs * 10) / 10),
  stubError: runs[0].error,
};
console.log(JSON.stringify(result));
const budget = Number(process.env.KNOX_STARTUP_BUDGET_MS || 0);
if (budget > 0 && median > budget) {
  console.error(`startup load ${median}ms exceeds budget ${budget}ms`);
  process.exit(1);
}
}
