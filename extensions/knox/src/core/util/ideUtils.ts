import { IDE } from "..";
import { t } from "../i18n/index.js";

import {
  getUriPathBasename,
  joinEncodedUriPathSegmentToUri,
  joinPathsToUri,
  pathToUriPathSegment,
} from "./uri";

function looksLikeUri(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

function looksLikeAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

/** Browser-safe file URI for an absolute OS path (no Node `url`). */
function absolutePathToFileUri(absPath: string): string {
  const unix = absPath.replace(/\\/g, "/");
  const windows = unix.match(/^([A-Za-z]:)\/(.*)$/);
  if (windows) {
    const rest = windows[2]
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    return `file:///${windows[1]}/${rest}`;
  }
  const parts = unix.split("/").map((part, index) =>
    index === 0 ? "" : encodeURIComponent(part),
  );
  return `file://${parts.join("/")}`;
}

/**
 * Workspace-relative path variants models commonly emit.
 * Strips `./` and a leading workspace folder name (`tetris/src/main.rs`
 * when the folder is `…/tetris`).
 */
export function relativePathCandidates(
  rawPath: string,
  workspaceDirUris: string[],
): string[] {
  const trimmed = rawPath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!trimmed) {
    return [];
  }
  const out = [trimmed];
  for (const dirUri of workspaceDirUris) {
    const base = getUriPathBasename(dirUri);
    if (!base) {
      continue;
    }
    if (trimmed === base) {
      if (!out.includes(".")) {
        out.push(".");
      }
    } else if (trimmed.startsWith(`${base}/`)) {
      const stripped = trimmed.slice(base.length + 1);
      if (stripped && !out.includes(stripped)) {
        out.push(stripped);
      }
    }
  }
  return out;
}

/*
  This function takes a relative (to workspace) filepath
  And checks each workspace for if it exists or not
  Only returns fully resolved URI if it exists
*/
export async function resolveRelativePathInDir(
  path: string,
  ide: IDE,
  dirUriCandidates?: string[],
): Promise<string | undefined> {
  const trimmed = path.trim();
  if (looksLikeUri(trimmed) && (await ide.fileExists(trimmed))) {
    return trimmed;
  }
  if (looksLikeAbsolutePath(trimmed)) {
    const absoluteUri = absolutePathToFileUri(trimmed);
    if (await ide.fileExists(absoluteUri)) {
      return absoluteUri;
    }
  }

  const dirs = dirUriCandidates ?? (await ide.getWorkspaceDirs());
  for (const candidate of relativePathCandidates(trimmed, dirs)) {
    if (candidate === ".") {
      if (dirs[0] && (await ide.fileExists(dirs[0]))) {
        return dirs[0];
      }
      continue;
    }
    for (const dirUri of dirs) {
      const fullUri = joinPathsToUri(dirUri, candidate);
      if (await ide.fileExists(fullUri)) {
        return fullUri;
      }
    }
  }

  return undefined;
}

/*
  Same as above but in this case the relative path does not need to exist (e.g. file to be created, etc)
  Checks closes match with the dirs, path segment by segment
  and based on which workspace has the closest matching path, returns resolved URI
  If no meaninful path match just concatenates to first dir's uri
*/
export async function inferResolvedUriFromRelativePath(
  _relativePath: string,
  ide: IDE,
  dirCandidates?: string[],
): Promise<string> {
  if (!_relativePath || typeof _relativePath !== 'string') {
    throw new Error(t("invalidRelativePath", { path: _relativePath }));
  }
  const relativePath = _relativePath.trim().replaceAll("\\", "/");
  const dirs = dirCandidates ?? (await ide.getWorkspaceDirs());

  if (dirs.length === 0) {
    throw new Error(t("noDirsProvided"));
  }

  const candidates = relativePathCandidates(relativePath, dirs);
  const pathForResolve =
    candidates.find((candidate) => candidate !== candidates[0]) ??
    candidates[0] ??
    relativePath;

  const segments = pathToUriPathSegment(pathForResolve).split("/");
  // Generate all possible suffixes from shortest to longest
  const suffixes: string[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    suffixes.push(segments.slice(i).join("/"));
  }

  // For each suffix, try to find a unique matching dir/file
  for (const suffix of suffixes) {
    const uris = dirs.map((dir) => ({
      dir,
      partialUri: joinEncodedUriPathSegmentToUri(dir, suffix),
    }));
    const promises = uris.map(async ({ partialUri, dir }) => {
      const exists = await ide.fileExists(partialUri);
      return {
        dir,
        partialUri,
        exists,
      };
    });
    const existenceChecks = await Promise.all(promises);

    const existingUris = existenceChecks.filter(({ exists }) => exists);

    // If exactly one directory matches, use it
    if (existingUris.length === 1) {
      return joinEncodedUriPathSegmentToUri(
        existingUris[0].dir,
        segments.join("/"),
      );
    }
  }

  // Sometimes the model will decide to only output the base name or small number of path parts
  // in which case we shouldn't create a new file if it matches the current file
  const activeFile = await ide.getCurrentFile();
  if (activeFile && activeFile.path.endsWith(pathForResolve)) {
    return activeFile.path;
  }

  // If no unique match found, use the first directory
  return joinPathsToUri(dirs[0], pathForResolve);
}
