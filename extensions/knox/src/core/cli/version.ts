/**
 * CLI version string. Prefers the product version at the repo root so
 * `knox --version` matches KnoxCoder; the published `@knoxchat/cli` package
 * stamps the same value on its own package.json.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Keep in sync with root `package.json` until a release pipeline stamps it. */
export const KNOX_CLI_VERSION_FALLBACK = "2.0.0-beta";

export const CLI_JSON_SCHEMA_VERSION = 1;

function readJson(file: string): { name?: unknown; version?: unknown; bin?: unknown } | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as {
      name?: unknown;
      version?: unknown;
      bin?: unknown;
    };
  } catch {
    return undefined;
  }
}

function versionOf(pkg: { version?: unknown } | undefined): string | undefined {
  return typeof pkg?.version === "string" && pkg.version.trim()
    ? pkg.version.trim()
    : undefined;
}

function isCliPackage(pkg: { name?: unknown; bin?: unknown } | undefined): boolean {
  if (!pkg) {
    return false;
  }
  if (pkg.name === "@knoxchat/cli") {
    return true;
  }
  return Boolean(
    pkg.bin &&
      typeof pkg.bin === "object" &&
      !Array.isArray(pkg.bin) &&
      "knox" in pkg.bin,
  );
}

export function knoxCliVersion(startDir = path.dirname(fileURLToPath(import.meta.url))): string {
  const fromEnv = process.env.KNOX_VERSION?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  let dir = startDir;
  let cliVersion: string | undefined;
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(dir, "package.json");
    const pkg = fs.existsSync(pkgPath) ? readJson(pkgPath) : undefined;
    if (!cliVersion && isCliPackage(pkg)) {
      cliVersion = versionOf(pkg);
    }
    const product = path.join(dir, "product.json");
    if (fs.existsSync(product) && pkg) {
      return versionOf(pkg) ?? cliVersion ?? KNOX_CLI_VERSION_FALLBACK;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return cliVersion ?? KNOX_CLI_VERSION_FALLBACK;
}
