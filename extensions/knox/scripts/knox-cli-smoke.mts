/**
 * Packaged CLI smoke (P1-4): after `build:cli`, `knox --version` / `doctor` /
 * `--help` must run without the TypeScript sources.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const knoxRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(knoxRoot, "..", "..");
const bundle = path.join(knoxRoot, "cli", "dist", "knox.js");
const cliPkg = path.join(knoxRoot, "cli", "package.json");
const BUNDLE_BYTES_BUDGET = 20 * 1024 * 1024;

function fail(message: string): never {
  console.error(`knox-cli-smoke: ${message}`);
  process.exit(1);
}

function runKnox(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [bundle, ...args], {
    encoding: "utf8",
    env: { ...process.env, KNOX_API_KEY: undefined },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

if (!fs.existsSync(bundle)) {
  fail(`${bundle} missing. Run: npm run build:cli`);
}

const stat = fs.statSync(bundle);
if (stat.size === 0) {
  fail("cli/dist/knox.js is empty");
}
if (stat.size > BUNDLE_BYTES_BUDGET) {
  fail(`cli/dist/knox.js is ${stat.size} bytes (budget ${BUNDLE_BYTES_BUDGET})`);
}

const check = spawnSync(process.execPath, ["--check", bundle], { encoding: "utf8" });
if (check.status !== 0) {
  fail(`node --check failed:\n${check.stderr || check.stdout}`);
}

const product = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as { version?: string };
const cliMeta = JSON.parse(fs.readFileSync(cliPkg, "utf8")) as {
  name?: string;
  bin?: Record<string, string>;
  version?: string;
};
if (cliMeta.name !== "@knoxchat/cli") {
  fail(`cli/package.json name is ${cliMeta.name}, expected @knoxchat/cli`);
}
if (cliMeta.bin?.knox !== "dist/knox.js") {
  fail("cli/package.json bin.knox must be dist/knox.js");
}
if (cliMeta.version !== product.version) {
  fail(
    `cli/package.json version ${cliMeta.version} does not match product ${product.version}`,
  );
}

const version = runKnox(["--version"]);
if (version.status !== 0) {
  fail(`knox --version exited ${version.status}: ${version.stderr}`);
}
const printed = version.stdout.trim();
if (printed !== product.version) {
  fail(`knox --version printed ${JSON.stringify(printed)}, expected ${product.version}`);
}

const help = runKnox(["--help"]);
if (help.status !== 0) {
  fail(`knox --help exited ${help.status}: ${help.stderr}`);
}
if (!help.stdout.includes("knox doctor") || !help.stdout.includes("--json")) {
  fail("knox --help is missing doctor / --json");
}

const doctor = runKnox(["doctor"]);
if (doctor.status !== 0 && doctor.status !== 1) {
  fail(`knox doctor exited ${doctor.status}: ${doctor.stderr}`);
}
if (!doctor.stdout.startsWith(`knox ${product.version}`)) {
  fail(`knox doctor header was ${JSON.stringify(doctor.stdout.split("\n")[0])}`);
}
if (/sk-|kc_live_|apiKey/i.test(doctor.stdout + doctor.stderr)) {
  fail("knox doctor leaked a credential");
}

console.log(
  `knox-cli-smoke: ok knox ${printed} ${(stat.size / (1024 * 1024)).toFixed(2)} MB`,
);
