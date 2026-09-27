import { IDE } from "../..";
import { walkDir } from "../../util/walkDir";
import { readAllGlobalPromptFiles } from "../../util/paths";
import { joinPathsToUri } from "../../util/uri";
import { DEFAULT_PROMPTS_FOLDER_V1 } from "../v1";

/**
 * Project-local prompts folder (legacy Continuum-style path).
 * Still supported; prefer `~/.knox/prompts` for new files (createNewPromptFileV2).
 */
export const DEFAULT_PROMPTS_FOLDER_V2 = ".knox/prompts";

/** Workspace-relative dirs scanned for `.prompt` files (in addition to ~/.knox/prompts). */
const WORKSPACE_PROMPT_DIRS = [
  DEFAULT_PROMPTS_FOLDER_V1, // .prompts
  DEFAULT_PROMPTS_FOLDER_V2, // .knox/prompts
];

export async function getPromptFilesFromDir(
  ide: IDE,
  dir: string,
): Promise<{ path: string; content: string }[]> {
  try {
    const exists = await ide.fileExists(dir);

    if (!exists) {
      return [];
    }

    const uris = await walkDir(dir, ide, {
      source: "get dir prompt files",
    });
    const promptFilePaths = uris.filter((p) => p.endsWith(".prompt"));
    const results = promptFilePaths.map(async (uri) => {
      const content = await ide.readFile(uri);
      return { path: uri, content };
    });
    return Promise.all(results);
  } catch (e) {
    console.error(e);
    return [];
  }
}

export async function getAllPromptFiles(
  ide: IDE,
  overridePromptFolder?: string,
  /**
   * @deprecated Ignored — both `.prompts` and `.knox/prompts` are always scanned.
   * Kept so call sites do not break.
   */
  _checkV1DefaultFolder: boolean = false,
): Promise<{ path: string; content: string }[]> {
  const workspaceDirs = await ide.getWorkspaceDirs();

  const dirsToCheck = overridePromptFolder
    ? [overridePromptFolder]
    : WORKSPACE_PROMPT_DIRS;

  const fullDirs = workspaceDirs
    .map((dir) => dirsToCheck.map((d) => joinPathsToUri(dir, d)))
    .flat();

  let promptFiles = (
    await Promise.all(fullDirs.map((dir) => getPromptFilesFromDir(ide, dir)))
  ).flat();

  // Global prompts (~/.knox/prompts)
  promptFiles.push(...readAllGlobalPromptFiles());

  // Deduplicate by path (override + default dirs can overlap)
  const seen = new Set<string>();
  promptFiles = promptFiles.filter((file) => {
    if (seen.has(file.path)) {
      return false;
    }
    seen.add(file.path);
    return true;
  });

  return await Promise.all(
    promptFiles.map(async (file) => {
      const content = await ide.readFile(file.path);
      return { path: file.path, content };
    }),
  );
}
