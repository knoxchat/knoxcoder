/**
 * CLI version string. Prefers the product version at the repo root so
 * `knox --version` matches KnoxCoder; falls back to a baked constant when
 * the CLI is copied out of tree.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Keep in sync with root `package.json` until a release pipeline stamps it. */
export const KNOX_CLI_VERSION_FALLBACK = "2.0.0-beta";

export const CLI_JSON_SCHEMA_VERSION = 1;

function readJsonVersion(file: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export function knoxCliVersion(startDir = path.dirname(fileURLToPath(import.meta.url))): string {
  const fromEnv = process.env.KNOX_VERSION?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    const product = path.join(dir, "product.json");
    if (fs.existsSync(product) && fs.existsSync(pkg)) {
      return readJsonVersion(pkg) ?? KNOX_CLI_VERSION_FALLBACK;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return KNOX_CLI_VERSION_FALLBACK;
}
