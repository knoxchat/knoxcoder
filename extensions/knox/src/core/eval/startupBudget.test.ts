import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// K-038: startup budget.
//
// Measured 2026-10-03 on the minified host bundle (Apple silicon, Node 24, stub
// `vscode`): 13.46 MB, module load median 125 ms (almost all of it V8 parse and
// compile of the bundle; module bodies are lazy `__esm`/`__commonJS` wrappers).
// Budgets leave headroom for noisy CI machines but catch a real regression, such
// as a heavy library moving back onto the eager import path.
const BUNDLE_BYTES_BUDGET = 16 * 1024 * 1024;
const LOAD_MS_BUDGET = 500;

const here = path.dirname(fileURLToPath(import.meta.url));
const knoxRoot = path.resolve(here, "..", "..", "..");
const srcRoot = path.join(knoxRoot, "src");
const bundle = path.join(knoxRoot, "dist", "extension.js");

/** Libraries that cost real time to evaluate and are only needed on demand. */
const LAZY_ONLY = ["dbinfoz", "jsdom", "@mozilla/readability", "node-html-markdown"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "out") {
      continue;
    }
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("startup budget (K-038)", () => {
  it("keeps heavy libraries off the static import path", () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const text = readFileSync(file, "utf8");
      for (const lib of LAZY_ONLY) {
        const escaped = lib.replace(/[/@-]/g, (c) => `\\${c}`);
        const staticImport = new RegExp(
          `^\\s*import\\s[^;]*?from\\s+["']${escaped}["']`,
          "m",
        );
        const bareImport = new RegExp(`^\\s*import\\s+["']${escaped}["']`, "m");
        const requireCall = new RegExp(`require\\(\\s*["']${escaped}["']\\s*\\)`);
        if (
          staticImport.test(text) ||
          bareImport.test(text) ||
          requireCall.test(text)
        ) {
          offenders.push(`${path.relative(srcRoot, file)} -> ${lib}`);
        }
      }
    }
    expect(
      offenders,
      `Use await import("<lib>") on first use instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  const hasBundle = existsSync(bundle);
  // esbuild only minifies the packaged build (`minify: !isDev`). A minified
  // bundle is a handful of lines; a dev bundle is hundreds of thousands. The
  // budgets apply to the packaged build only, so a leftover dev bundle in
  // `dist/` must not fail the suite.
  const isMinified =
    hasBundle &&
    readFileSync(bundle, "utf8").split("\n").length < 20_000;
  it.skipIf(!isMinified)("bundle stays under the size budget", () => {
    expect(statSync(bundle).size).toBeLessThanOrEqual(BUNDLE_BYTES_BUDGET);
  });

  it.skipIf(!isMinified)(
    "bundle module load stays under the time budget",
    () => {
      // A dev (unminified) bundle is about twice the size and parses slower; the
      // time budget only applies to the packaged build.
      if (statSync(bundle).size > BUNDLE_BYTES_BUDGET) {
        return;
      }
      const result = spawnSync(
        process.execPath,
        [path.join(knoxRoot, "scripts", "measure-startup.cjs"), bundle],
        {
          encoding: "utf8",
          env: { ...process.env, KNOX_STARTUP_BUDGET_MS: String(LOAD_MS_BUDGET) },
        },
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);
    },
    60_000,
  );
});
