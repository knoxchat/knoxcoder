import { BaseContextProvider } from "..";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  LoadSubmenuItemsArgs,
} from "../../";
import { t } from "../../i18n/index.js";
import generateRepoMap from "../../util/generateRepoMap";
import { walkDir } from "../../util/walkDir";
import {
  getShortestUniqueRelativeUriPaths,
  getUriPathBasename,
} from "../../util/uri";

const ENTIRE_PROJECT_ITEM: ContextSubmenuItem = {
  id: "entire-codebase",
  title: t("entireCodebase"),
  description: t("searchEntireCodebase"),
};

/** Same cap as the @file submenu so repo-map stays bounded. */
export const MAX_REPO_MAP_FOLDERS = 10_000;

class RepoMapContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "repo-map",
    displayTitle: "Repository Structure Map",
    description: t("pleaseSelectFolder"),
    type: "submenu",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    return [
      {
        name: "Repository Structure Map",
        description: t("overviewRepoStructure"),
        content: await generateRepoMap(extras.llm, extras.ide, {
          dirUris: query === ENTIRE_PROJECT_ITEM.id ? undefined : [query],
          outputRelativeUriPaths: true,
          includeSignatures: this.options?.includeSignatures ?? true,
        }),
      },
    ];
  }

  async loadSubmenuItems(
    args: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    const workspaceDirs = await args.ide.getWorkspaceDirs();
    if (workspaceDirs.length === 0) {
      return [ENTIRE_PROJECT_ITEM];
    }

    const walked = await Promise.all(
      workspaceDirs.map(async (dir) => {
        const [files, mixed] = await Promise.all([
          walkDir(dir, args.ide, {
            source: "mention-repo-map-files",
            includeDirs: false,
            workspaceDirs,
            maxEntries: MAX_REPO_MAP_FOLDERS,
          }),
          walkDir(dir, args.ide, {
            source: "mention-repo-map",
            includeDirs: true,
            workspaceDirs,
            maxEntries: MAX_REPO_MAP_FOLDERS,
          }),
        ]);
        const fileSet = new Set(files);
        return mixed.filter((uri) => !fileSet.has(uri));
      }),
    );

    const folders = walked.flat();
    const withUniquePaths = getShortestUniqueRelativeUriPaths(
      folders,
      workspaceDirs,
    );

    return [
      ENTIRE_PROJECT_ITEM,
      ...withUniquePaths.map((folder) => ({
        id: folder.uri,
        title: getUriPathBasename(folder.uri),
        description: folder.uniquePath,
        icon: "folder" as const,
      })),
    ];
  }
}

export default RepoMapContextProvider;
