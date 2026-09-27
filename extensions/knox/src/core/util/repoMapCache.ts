/**
 * Disk cache for generated repo maps (HL-20).
 * Stored under ~/.knox/repo-map/ (or KNOX_GLOBAL_DIR/repo-map in tests).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getKnoxGlobalPath } from "./paths.js";

const CACHE_VERSION = 1;

export interface RepoMapCacheEntry {
  version: number;
  fingerprint: string;
  content: string;
}

export function getRepoMapCacheDir(): string {
  const dir = path.join(getKnoxGlobalPath(), "repo-map");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function repoMapCacheKey(parts: {
  workspaceDirs: string[];
  path?: string;
  includeSignatures?: boolean;
  query?: string;
}): string {
  const raw = JSON.stringify({
    dirs: [...parts.workspaceDirs].sort(),
    path: parts.path ?? "",
    signatures: Boolean(parts.includeSignatures),
    query: parts.query ?? "",
  });
  return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 20);
}

export function repoMapFingerprint(
  uris: string[],
  mtimes?: Record<string, number>,
): string {
  let maxMtime = 0;
  if (mtimes) {
    for (const value of Object.values(mtimes)) {
      if (value > maxMtime) {
        maxMtime = value;
      }
    }
  }
  const first = uris[0] ?? "";
  const last = uris[uris.length - 1] ?? "";
  return `${uris.length}:${maxMtime}:${first}:${last}`;
}

function cacheFile(key: string): string {
  return path.join(getRepoMapCacheDir(), `${key}.json`);
}

export function readRepoMapCache(key: string): RepoMapCacheEntry | undefined {
  try {
    const raw = fs.readFileSync(cacheFile(key), "utf8");
    const parsed = JSON.parse(raw) as RepoMapCacheEntry;
    if (parsed?.version !== CACHE_VERSION || typeof parsed.content !== "string") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeRepoMapCache(key: string, entry: RepoMapCacheEntry): void {
  try {
    fs.writeFileSync(
      cacheFile(key),
      JSON.stringify({ ...entry, version: CACHE_VERSION }),
    );
  } catch (error) {
    console.debug("[RepoMap] Failed to write cache:", error);
  }
}
