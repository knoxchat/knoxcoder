/**
 * Honor .gitignore / .knoxignore while walking trees (HL-19 leftover).
 *
 * Patterns are matched relative to the ignore file's directory. Nested
 * ignore files become extra layers. Ignore files themselves are never skipped.
 */

import ignore from "ignore";

import type { IDE } from "..";
import { findUriInDirs, joinPathsToUri } from "./uri";

export const WALK_IGNORE_FILENAMES = [".gitignore", ".knoxignore"] as const;

export function isWalkIgnoreFileName(name: string): boolean {
  return (WALK_IGNORE_FILENAMES as readonly string[]).includes(name);
}

export interface WalkIgnoreMatcher {
  addLayer(rootUri: string, content: string): void;
  ignores(uri: string, isDirectory?: boolean): boolean;
}

function normalizeUri(uri: string): string {
  return uri.replace(/\/$/, "");
}

export function createWalkIgnoreMatcher(): WalkIgnoreMatcher {
  const layers: { rootUri: string; ig: ReturnType<typeof ignore> }[] = [];

  return {
    addLayer(rootUri, content) {
      const text = content ?? "";
      if (!text.trim()) {
        return;
      }
      const ig = ignore();
      try {
        ig.add(text);
      } catch {
        return;
      }
      layers.push({ rootUri: normalizeUri(rootUri), ig });
    },
    ignores(uri, isDirectory = false) {
      const target = normalizeUri(uri);
      let base = "";
      try {
        base = decodeURIComponent(target.split("/").pop() ?? "");
      } catch {
        base = target.split("/").pop() ?? "";
      }
      if (isWalkIgnoreFileName(base)) {
        return false;
      }
      for (const layer of layers) {
        let rel = "";
        try {
          const found = findUriInDirs(target, [layer.rootUri]);
          if (!found.foundInDir || !found.relativePathOrBasename) {
            continue;
          }
          rel = found.relativePathOrBasename.replace(/\\/g, "/");
        } catch {
          continue;
        }
        if (!rel || rel === ".") {
          continue;
        }
        try {
          if (layer.ig.ignores(rel)) {
            return true;
          }
          if (isDirectory && layer.ig.ignores(`${rel}/`)) {
            return true;
          }
        } catch {
          continue;
        }
      }
      return false;
    },
  };
}

async function readIgnoreIfPresent(
  ide: IDE,
  uri: string,
): Promise<string | undefined> {
  try {
    if (
      typeof ide.fileExists !== "function" ||
      typeof ide.readFile !== "function"
    ) {
      return undefined;
    }
    if (!(await ide.fileExists(uri))) {
      return undefined;
    }
    return await ide.readFile(uri);
  } catch {
    return undefined;
  }
}

/** Load root-level `.gitignore` / `.knoxignore` from each walk or workspace URI. */
export async function loadWalkIgnore(
  ide: IDE,
  rootUris: string[],
): Promise<WalkIgnoreMatcher> {
  const matcher = createWalkIgnoreMatcher();
  const seen = new Set<string>();
  for (const raw of rootUris) {
    if (!raw) {
      continue;
    }
    const root = normalizeUri(raw);
    if (seen.has(root)) {
      continue;
    }
    seen.add(root);
    for (const name of WALK_IGNORE_FILENAMES) {
      const uri = joinPathsToUri(root, name);
      const text = await readIgnoreIfPresent(ide, uri);
      if (text) {
        matcher.addLayer(root, text);
      }
    }
  }
  return matcher;
}

/** If `listDir` showed an ignore file, add that directory as a nested layer. */
export async function addNestedWalkIgnore(
  ide: IDE,
  dirUri: string,
  fileName: string,
  matcher: WalkIgnoreMatcher,
): Promise<void> {
  if (!isWalkIgnoreFileName(fileName)) {
    return;
  }
  const uri = joinPathsToUri(dirUri, fileName);
  const text = await readIgnoreIfPresent(ide, uri);
  if (text) {
    matcher.addLayer(dirUri, text);
  }
}
