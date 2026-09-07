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
import {
  getShortestUniqueRelativeUriPaths,
  getUriPathBasename,
} from "../../util/uri";

const ENTIRE_PROJECT_ITEM: ContextSubmenuItem = {
  id: "entire-codebase",
  title: t("entireCodebase"),
  description: t("searchEntireCodebase"),
};

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
    // Directory walking functionality has been removed
    const folders: any[] = [];
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
      })),
    ];
  }
}

export default RepoMapContextProvider;
