import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  IDE,
  LoadSubmenuItemsArgs,
} from "../../index.js";
import { t } from "../../i18n/index.js";
import {
  findUriInDirs,
  getCleanUriPath,
  getParentUri,
  getShortestUniqueRelativeUriPaths,
  getUriDescription,
  getUriPathBasename,
} from "../../util/uri.js";
import { walkDir } from "../../util/walkDir.js";
import { BaseContextProvider } from "../index.js";

/** Cap for the @ file/folder submenu. Truncation prefers shallower paths (MN-01). */
export const MAX_SUBMENU_ITEMS = 10_000;

/** Cap for folder-mention context listings (MN-12). */
export const MAX_FOLDER_LISTING_ENTRIES = 500;

/** Matches `FileType.Directory` in index.d.ts (not a runtime export). */
const FILE_TYPE_DIRECTORY = 2;

function uriDepth(uri: string): number {
  return getCleanUriPath(uri).split("/").filter(Boolean).length;
}

/** Prefer workspace-root files/folders when the walk exceeds the submenu cap. */
export function selectMentionWalkUris(
  files: string[],
  folders: string[],
  maxItems: number = MAX_SUBMENU_ITEMS,
): string[] {
  return [...files, ...folders]
    .sort((a, b) => {
      const depthDelta = uriDepth(a) - uriDepth(b);
      if (depthDelta !== 0) {
        return depthDelta;
      }
      return a.localeCompare(b);
    })
    .slice(0, maxItems);
}

export function formatFolderListing(
  folderUri: string,
  uris: string[],
): string {
  return uris
    .map((uri) => findUriInDirs(uri, [folderUri]).relativePathOrBasename)
    .filter((path) => path.length > 0)
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}

export async function isDirectoryUri(
  uri: string,
  ide: IDE,
): Promise<boolean> {
  const exists = await ide.fileExists(uri);
  if (!exists) {
    return false;
  }

  const parent = getParentUri(uri);
  const name = getUriPathBasename(uri);
  if (parent && name) {
    try {
      const entries = await ide.listDir(parent);
      const match = entries.find(([entryName]) => entryName === name);
      if (match) {
        return match[1] === FILE_TYPE_DIRECTORY;
      }
    } catch {
      // Fall through to listing the URI itself.
    }
  }

  try {
    await ide.listDir(uri);
    return true;
  } catch {
    return false;
  }
}

class FileFolderContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "file",
    displayTitle: "File | Folder",
    description: t("typeToSearch"),
    type: "submenu",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const fileUri = query.trim();
    if (!fileUri) {
      return [];
    }

    const workspaceDirs = await extras.ide.getWorkspaceDirs();
    const { relativePathOrBasename, last2Parts, baseName } = getUriDescription(
      fileUri,
      workspaceDirs,
    );

    if (await isDirectoryUri(fileUri, extras.ide)) {
      const walked = await walkDir(fileUri, extras.ide, {
        source: "mention-folder-listing",
        includeDirs: true,
        workspaceDirs,
        maxEntries: MAX_FOLDER_LISTING_ENTRIES + 1,
      });
      const truncated = walked.length > MAX_FOLDER_LISTING_ENTRIES;
      const listed = walked.slice(0, MAX_FOLDER_LISTING_ENTRIES);
      const listing = formatFolderListing(fileUri, listed);
      const truncationNote = truncated
        ? `\n\n(truncated, showing first ${MAX_FOLDER_LISTING_ENTRIES} entries)`
        : "";

      return [
        {
          name: baseName,
          description: last2Parts,
          content: `Folder listing of ${relativePathOrBasename}/\n\n\`\`\`\n${listing}\n\`\`\`${truncationNote}`,
          uri: {
            type: "file",
            value: fileUri,
          },
        },
      ];
    }

    try {
      const content = await extras.ide.readFile(fileUri);

      return [
        {
          name: baseName,
          description: last2Parts,
          content: `\`\`\`${relativePathOrBasename}\n${content}\n\`\`\``,
          uri: {
            type: "file",
            value: fileUri,
          },
        },
      ];
    } catch {
      return [];
    }
  }

  async loadSubmenuItems(
    args: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    const workspaceDirs = await args.ide.getWorkspaceDirs();
    if (workspaceDirs.length === 0) {
      return [];
    }

    const walked = await Promise.all(
      workspaceDirs.map(async (dir) => {
        const [files, mixed] = await Promise.all([
          walkDir(dir, args.ide, {
            source: "mention-file",
            includeDirs: false,
            workspaceDirs,
            maxEntries: MAX_SUBMENU_ITEMS,
          }),
          walkDir(dir, args.ide, {
            source: "mention-folder",
            includeDirs: true,
            workspaceDirs,
            maxEntries: MAX_SUBMENU_ITEMS,
          }),
        ]);
        const fileSet = new Set(files);
        const folders = mixed.filter((uri) => !fileSet.has(uri));
        return { files, folders };
      }),
    );

    const files = walked.flatMap((part) => part.files);
    const folders = walked.flatMap((part) => part.folders);
    const folderPaths = new Set(folders);
    const limitedItems = selectMentionWalkUris(files, folders);
    const truncated = files.length + folders.length > limitedItems.length;

    const withUniquePaths = getShortestUniqueRelativeUriPaths(
      limitedItems,
      workspaceDirs,
    );

    return withUniquePaths.map((item) => ({
      id: item.uri,
      title: getUriPathBasename(item.uri),
      description: item.uniquePath,
      icon: folderPaths.has(item.uri) ? "folder" : "file",
      ...(truncated
        ? { metadata: { truncated: true, truncatedCount: MAX_SUBMENU_ITEMS } }
        : {}),
    }));
  }
}

export default FileFolderContextProvider;
