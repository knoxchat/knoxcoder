/**
 * Packaged-extension smoke (P0-2): after `esbuild`, the host bundle must
 * exist, parse, and stay under the startup size budget. This does not launch
 * Electron; `host/test/runner/runRemainingSmokeOnKnoxCoder.ts` still needs a
 * KnoxCoder build for a full app smoke.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const knoxRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(knoxRoot, "dist", "extension.js");
const BUNDLE_BYTES_BUDGET = 16 * 1024 * 1024;

function fail(message: string): never {
  console.error(`packaged-extension-smoke: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(bundle)) {
  fail(`${bundle} missing. Run: npm run esbuild`);
}

const stat = fs.statSync(bundle);
if (stat.size === 0) {
  fail("dist/extension.js is empty");
}
if (stat.size > BUNDLE_BYTES_BUDGET) {
  fail(`dist/extension.js is ${stat.size} bytes (budget ${BUNDLE_BYTES_BUDGET})`);
}

const check = spawnSync(process.execPath, ["--check", bundle], { encoding: "utf8" });
if (check.status !== 0) {
  fail(`node --check failed:\n${check.stderr || check.stdout}`);
}

console.log(
  `packaged-extension-smoke: ok ${path.relative(knoxRoot, bundle)} ${(stat.size / (1024 * 1024)).toFixed(2)} MB`,
);
