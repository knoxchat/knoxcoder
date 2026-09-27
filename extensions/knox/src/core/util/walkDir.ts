import { IDE } from "..";

import {
  DEFAULT_IGNORE_BASENAMES,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILETYPES,
} from "./ignore";
import { joinPathsToUri } from "./uri";
import {
  addNestedWalkIgnore,
  loadWalkIgnore,
  type WalkIgnoreMatcher,
} from "./walkIgnore";

/** Matches `FileType` in index.d.ts (not a runtime export). */
const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;
const FILE_TYPE_SYMLINK = 64;

export interface WalkDirOptions {
  source?: string;
  /** Extra name substrings to skip (in addition to default ignore dirs/types). */
  ignoreFiles?: string[];
  /**
   * When true, emit directory URIs in the result list.
   * Recursion always happens; this flag does not control descent.
   */
  includeDirs?: boolean;
  /** Stop after this many emitted entries (default {@link DEFAULT_WALK_MAX_ENTRIES}). */
  maxEntries?: number;
  /** Honor `.gitignore` / `.knoxignore`. Default true. */
  respectGitignore?: boolean;
  /** Workspace roots so a zoomed walk (`mm/`) still sees the repo gitignore. */
  workspaceDirs?: string[];
}

/** Cap for kernel-sized trees. Callers see a truncated list, not a hang. */
export const DEFAULT_WALK_MAX_ENTRIES = 100_000;

function shouldSkipName(name: string, ignoreFiles?: string[]): boolean {
  if (name === "." || name === "..") {
    return true;
  }
  if (DEFAULT_IGNORE_DIRS.includes(name)) {
    return true;
  }
  if (ignoreFiles?.some((pattern) => name.includes(pattern))) {
    return true;
  }
  if (DEFAULT_IGNORE_FILETYPES.some((ext) => name.endsWith(ext))) {
    return true;
  }
  if (DEFAULT_IGNORE_BASENAMES.includes(name)) {
    return true;
  }
  return false;
}

/**
 * Recursively list files under `directory`.
 *
 * Directories are always descended (unlike the old `includeDirs` gate, which
 * skipped recursion entirely). `includeDirs` only controls whether directory
 * URIs themselves are pushed onto the result. `.gitignore` / `.knoxignore`
 * are honored unless `respectGitignore` is false.
 */
export async function walkDir(
  directory: string,
  ide: IDE,
  options: WalkDirOptions = {},
): Promise<string[]> {
  const results: string[] = [];
  const maxEntries = options.maxEntries ?? DEFAULT_WALK_MAX_ENTRIES;
  const includeDirs = Boolean(options.includeDirs);
  const respectGitignore = options.respectGitignore !== false;
  const matcher: WalkIgnoreMatcher | undefined = respectGitignore
    ? await loadWalkIgnore(ide, [directory, ...(options.workspaceDirs ?? [])])
    : undefined;

  async function walk(dirUri: string): Promise<void> {
    if (results.length >= maxEntries) {
      return;
    }

    let entries: [string, number][];
    try {
      entries = await ide.listDir(dirUri);
    } catch (error) {
      console.warn(`Error walking directory ${dirUri}:`, error);
      return;
    }

    if (matcher) {
      for (const [name, fileType] of entries) {
        if (fileType === FILE_TYPE_FILE) {
          await addNestedWalkIgnore(ide, dirUri, name, matcher);
        }
      }
    }

    for (const [name, fileType] of entries) {
      if (results.length >= maxEntries) {
        return;
      }
      if (shouldSkipName(name, options.ignoreFiles)) {
        continue;
      }

      const fullPath = joinPathsToUri(dirUri, name);
      const isDirectory = fileType === FILE_TYPE_DIRECTORY;
      if (matcher?.ignores(fullPath, isDirectory)) {
        continue;
      }

      if (fileType === FILE_TYPE_DIRECTORY) {
        if (includeDirs) {
          results.push(fullPath);
        }
        await walk(fullPath);
        continue;
      }

      if (fileType === FILE_TYPE_SYMLINK) {
        // Do not follow symlinks (cycles / escape).
        continue;
      }

      if (fileType === FILE_TYPE_FILE) {
        results.push(fullPath);
      }
    }
  }

  await walk(directory);
  return results;
}
