import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { DEFAULT_IGNORE_BASENAMES } from "../../util/ignore";
import { joinPathsToUri } from "../../util/uri";
import {
  addNestedWalkIgnore,
  isWalkIgnoreFileName,
  loadWalkIgnore,
} from "../../util/walkIgnore";
import { t } from "../../i18n/index.js";
import { matchGlob } from "../globMatch";

import { ToolImpl } from ".";

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

/** Always skip — never a QEMU/kernel source tree. */
const ALWAYS_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "coverage",
  ".turbo",
  ".cache",
]);

/** Skip unless this is a configured in-tree build (QEMU Makefile / config-host.mak). */
const CONDITIONAL_SKIP_DIRS = new Set(["build"]);

const OBJECT_FILE_RE = /\.(o|ko|obj)$/i;
const BUILD_KEEP_NAMES = new Set([
  "Makefile",
  "makefile",
  "GNUmakefile",
  "config-host.mak",
  "build.ninja",
  "build.make",
]);

export const GLOB_DEFAULT_MAX_RESULTS = 200;
/** Visit cap for kernel-sized trees (HL-21). */
export const GLOB_MAX_WALK = 100_000;

export function patternWantsObjectFiles(pattern: string): boolean {
  return /\.(o|ko|obj)\b/i.test(pattern);
}

export function patternWantsGeneratedArtifacts(pattern: string): boolean {
  return /vmlinux|system\.map|module\.symvers|modules\.(order|builtin)/i.test(
    pattern,
  );
}

export function formatGlobHeader(params: {
  pattern: string;
  matchCount: number;
  maxResults: number;
  visited: number;
  maxWalk: number;
  hitWalkCap: boolean;
  hitResultCap: boolean;
}): string {
  if (params.hitWalkCap) {
    return (
      `Found ${params.matchCount} file(s) matching "${params.pattern}" ` +
      `(visited ${params.visited}, stopped at walk cap ${params.maxWalk}; use a narrower path).`
    );
  }
  if (params.hitResultCap) {
    return (
      `Found ${params.matchCount} file(s) matching "${params.pattern}" ` +
      `(truncated at ${params.maxResults}; pass max_results or a narrower path).`
    );
  }
  return `Found ${params.matchCount} file(s) matching "${params.pattern}".`;
}

function basenameOfUri(uri: string): string {
  const trimmed = uri.replace(/\/$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] ?? trimmed;
}

export const globImpl: ToolImpl = async (args, extras) => {
  if (!args.pattern || typeof args.pattern !== "string") {
    throw new Error(t("missingRequiredParam", { param: "pattern" }));
  }

  const pattern = args.pattern.trim();
  if (!pattern) {
    throw new Error(t("missingRequiredParam", { param: "pattern" }));
  }

  const targetDirectory =
    typeof args.target_directory === "string" && args.target_directory.trim()
      ? args.target_directory.trim()
      : ".";
  const maxResults =
    typeof args.max_results === "number" && args.max_results > 0
      ? Math.floor(args.max_results)
      : GLOB_DEFAULT_MAX_RESULTS;

  let rootUri: string;
  try {
    if (targetDirectory === ".") {
      const dirs = await extras.ide.getWorkspaceDirs();
      if (!dirs[0]) {
        throw new Error(t("noDirsProvided"));
      }
      rootUri = dirs[0];
    } else {
      rootUri = await inferResolvedUriFromRelativePath(
        targetDirectory,
        extras.ide,
      );
    }
  } catch (error) {
    throw new Error(
      t("failedToResolveFilePath", {
        filepath: targetDirectory,
        error: (error as Error).message,
      }),
    );
  }

  const matches: string[] = [];
  let visited = 0;
  const includeObjectFiles = patternWantsObjectFiles(pattern);
  const includeGenerated = patternWantsGeneratedArtifacts(pattern);
  const rootIsBuild = basenameOfUri(rootUri).toLowerCase() === "build";
  let workspaceDirs: string[] = [];
  try {
    workspaceDirs = await extras.ide.getWorkspaceDirs();
  } catch {
    workspaceDirs = [];
  }
  const matcher = await loadWalkIgnore(extras.ide, [rootUri, ...workspaceDirs]);

  async function keepConditionalDir(childUri: string): Promise<boolean> {
    if (rootIsBuild) {
      return true;
    }
    try {
      const entries = await extras.ide.listDir(childUri);
      return entries.some(([name]) => BUILD_KEEP_NAMES.has(name));
    } catch {
      return false;
    }
  }

  async function walk(dirUri: string, relative: string): Promise<void> {
    if (matches.length >= maxResults || visited >= GLOB_MAX_WALK) {
      return;
    }
    let entries: [string, number][];
    try {
      entries = await extras.ide.listDir(dirUri);
    } catch {
      return;
    }
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    for (const [name, type] of entries) {
      if (type === FILE_TYPE_FILE) {
        await addNestedWalkIgnore(extras.ide, dirUri, name, matcher);
      }
    }

    for (const [name, type] of entries) {
      if (matches.length >= maxResults || visited >= GLOB_MAX_WALK) {
        return;
      }
      if (name === "." || name === "..") {
        continue;
      }
      visited++;
      const isDir = type === FILE_TYPE_DIRECTORY;
      const childUri = joinPathsToUri(dirUri, name);
      if (matcher.ignores(childUri, isDir)) {
        continue;
      }

      if (isDir && ALWAYS_SKIP_DIRS.has(name)) {
        continue;
      }
      if (isDir && CONDITIONAL_SKIP_DIRS.has(name)) {
        if (!(await keepConditionalDir(childUri))) {
          continue;
        }
      }

      const rel = relative ? `${relative}/${name}` : name;

      if (isDir) {
        await walk(childUri, rel);
        continue;
      }

      if (type !== FILE_TYPE_FILE) {
        continue;
      }
      if (!includeObjectFiles && OBJECT_FILE_RE.test(name)) {
        continue;
      }
      if (
        !includeGenerated &&
        DEFAULT_IGNORE_BASENAMES.includes(name) &&
        !isWalkIgnoreFileName(name)
      ) {
        continue;
      }
      if (matchGlob(rel, pattern)) {
        matches.push(rel);
      }
    }
  }

  const startRel =
    targetDirectory === "."
      ? ""
      : targetDirectory.replace(/\\/g, "/").replace(/^\.\//, "");
  await walk(rootUri, startRel);

  const hitWalkCap = visited >= GLOB_MAX_WALK;
  const hitResultCap = matches.length >= maxResults;
  const header = formatGlobHeader({
    pattern,
    matchCount: matches.length,
    maxResults,
    visited,
    maxWalk: GLOB_MAX_WALK,
    hitWalkCap,
    hitResultCap,
  });

  const body = matches.length ? matches.join("\n") : "(no matches)";

  return [
    {
      name: "Glob",
      description: header,
      content: `${header}\n\n${body}`,
    },
  ];
};
