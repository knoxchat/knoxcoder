import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  LoadSubmenuItemsArgs,
} from "../../index.js";
import { t } from "../../i18n/index.js";
import {
  getShortestUniqueRelativeUriPaths,
  getUriDescription,
  getUriPathBasename,
} from "../../util/uri.js";
import { BaseContextProvider } from "../index.js";

const MAX_SUBMENU_ITEMS = 10_000;

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
    // Check if query is a directory path
    const isDirectory = await this.isDirectory(query, extras.ide);
    
    if (isDirectory) {
      return [];
    } else {
      // Handle file query
      try {
        const fileUri = query.trim();
        const content = await extras.ide.readFile(fileUri);

        const { relativePathOrBasename, last2Parts, baseName } = getUriDescription(
          fileUri,
          await extras.ide.getWorkspaceDirs(),
        );

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
      } catch (error) {
        // If file reading fails, return empty
        return [];
      }
    }
  }

  private async isDirectory(path: string, ide: any): Promise<boolean> {
    try {
      const items = await ide.listDir(path);
      return Array.isArray(items) && items.length >= 0;
    } catch {
      // If listDir fails, assume it's a file
      return false;
    }
  }

  async loadSubmenuItems(
    args: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    const workspaceDirs = await args.ide.getWorkspaceDirs();
    
    // File walking functionality has been removed
    const files: any[] = [];
    const folders: any[] = [];

    // Combine files and folders
    const allItems = [...files.flat(), ...folders];
    const limitedItems = allItems.slice(-MAX_SUBMENU_ITEMS);
    const withUniquePaths = getShortestUniqueRelativeUriPaths(
      limitedItems,
      workspaceDirs,
    );

    // Create a Set of folder paths for quick lookup
    const folderPaths = new Set(folders);

    return withUniquePaths.map((item) => {
      const isFolder = folderPaths.has(item.uri);
      return {
        id: item.uri,
        title: getUriPathBasename(item.uri),
        description: item.uniquePath,
        icon: isFolder ? "folder" : "file",
      };
    });
  }
}

export default FileFolderContextProvider; 