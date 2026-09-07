import ignore from "ignore";
import path from "path";

import { IDE } from "..";
import {
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILETYPES,
} from "../util/ignore";
import { walkDir } from "../util/walkDir";
import { getGlobalAssistantsPath } from "../util/paths";
import { localPathOrUriToPath, localPathToUri } from "../util/pathToUri";

export function isLocalAssistantFile(uri: string): boolean {
  if (!uri.endsWith(".yaml") && !uri.endsWith(".yml")) {
    return false;
  }

  const filePath = localPathOrUriToPath(uri);
  const assistantsRoot = getGlobalAssistantsPath();
  return (
    filePath === assistantsRoot ||
    filePath.startsWith(assistantsRoot + path.sep)
  );
}

export async function getAssistantFilesFromDir(
  ide: IDE,
  dir: string,
): Promise<{ path: string; content: string }[]> {
  try {
    const exists = await ide.fileExists(dir);

    if (!exists) {
      return [];
    }

    const ignoreFiles = DEFAULT_IGNORE_FILETYPES.filter((t) => t !== "config.yaml")
      .concat(DEFAULT_IGNORE_DIRS);

    const uris = await walkDir(dir, ide, {
      ignoreFiles,
      source: "Get assistant files",
    });
    const assistantFilePaths = uris.filter(
      (p) => p.endsWith(".yaml") || p.endsWith(".yml"),
    );
    const results = assistantFilePaths.map(async (uri) => {
      const content = await ide.readFile(uri); // make a try catch
      return { path: uri, content };
    });
    return Promise.all(results);
  } catch (e) {
    console.error(e);
    return [];
  }
}

export async function getAllAssistantFiles(
  ide: IDE,
): Promise<{ path: string; content: string }[]> {
  const fullDirs = [localPathToUri(getGlobalAssistantsPath())];

  const assistantFiles = (
    await Promise.all(fullDirs.map((dir) => getAssistantFilesFromDir(ide, dir)))
  ).flat();

  return await Promise.all(
    assistantFiles.map(async (file) => {
      const content = await ide.readFile(file.path);
      return { path: file.path, content };
    }),
  );
}
