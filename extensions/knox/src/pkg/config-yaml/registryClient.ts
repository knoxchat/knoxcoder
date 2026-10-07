import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { Registry } from "./interfaces/index.js";
import { FullSlug, VirtualTags } from "./interfaces/slugs.js";

/**
 * Local config registry. `uses: owner/package` loads YAML from
 * `~/.knoxcoder/registry/owner/package.yaml` (or `package@version.yaml`).
 * Remote fetch is not supported — a missing local file is an error, not a
 * network call.
 *
 * `KNOX_GLOBAL_DIR` overrides the global root (same as the rest of Knox).
 */
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

export function knoxRegistryRoot(): string {
  const globalRoot =
    process.env.KNOX_GLOBAL_DIR ?? path.join(os.homedir(), ".knoxcoder");
  return path.join(globalRoot, "registry");
}

export function isSafeRegistrySlug(part: string): boolean {
  return Boolean(part) && SLUG_RE.test(part);
}

export function localRegistryCandidates(
  fullSlug: FullSlug,
  root: string = knoxRegistryRoot(),
): string[] {
  if (
    !isSafeRegistrySlug(fullSlug.ownerSlug) ||
    !isSafeRegistrySlug(fullSlug.packageSlug)
  ) {
    return [];
  }
  const dir = path.join(root, fullSlug.ownerSlug);
  const resolvedDir = path.resolve(dir);
  const resolvedRoot = path.resolve(root);
  if (
    resolvedDir !== resolvedRoot &&
    !resolvedDir.startsWith(resolvedRoot + path.sep)
  ) {
    return [];
  }
  const names: string[] = [];
  const version = fullSlug.versionSlug;
  if (
    version &&
    version !== VirtualTags.Latest &&
    isSafeRegistrySlug(version)
  ) {
    names.push(`${fullSlug.packageSlug}@${version}.yaml`);
    names.push(`${fullSlug.packageSlug}@${version}.yml`);
  }
  names.push(`${fullSlug.packageSlug}.yaml`, `${fullSlug.packageSlug}.yml`);
  return names.map((name) => path.join(resolvedDir, name));
}

function missingBlockMessage(fullSlug: FullSlug, root: string): string {
  return (
    `Config block uses: ${fullSlug.ownerSlug}/${fullSlug.packageSlug} was not found in ${root}. ` +
    `Put YAML at registry/${fullSlug.ownerSlug}/${fullSlug.packageSlug}.yaml ` +
    `(or ${fullSlug.packageSlug}@<version>.yaml). Remote registries are not supported.`
  );
}

export class RegistryClient implements Registry {
  constructor(private readonly root: string = knoxRegistryRoot()) {}

  async getContent(fullSlug: FullSlug): Promise<string> {
    const candidates = localRegistryCandidates(fullSlug, this.root);
    if (candidates.length === 0) {
      throw new Error(missingBlockMessage(fullSlug, this.root));
    }
    for (const file of candidates) {
      try {
        return await fs.readFile(file, "utf8");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          throw error;
        }
      }
    }
    throw new Error(missingBlockMessage(fullSlug, this.root));
  }
}
