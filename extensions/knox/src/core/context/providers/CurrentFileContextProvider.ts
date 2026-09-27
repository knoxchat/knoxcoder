import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../";
import { t } from "../../i18n/index.js";
import { getUriDescription } from "../../util/uri";

class CurrentFileContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "currentFile",
    displayTitle: "Current File",
    description: t("theCurrentlyOpenFile"),
    type: "normal",
    renderInlineAs: "",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const currentFile = await extras.ide.getCurrentFile();
    if (!currentFile) {
      return [];
    }

    const { relativePathOrBasename, last2Parts, baseName } = getUriDescription(
      currentFile.path,
      await extras.ide.getWorkspaceDirs(),
    );

    let prefix = t("thisIsCurrentlyOpenFile");
    let name = baseName;

    // This allows frontend to retrieve when using alt + enter or default context with slightly different copy
    if (query === "non-mention-usage") {
      prefix = t("fileOpenDoNotReference");
      name = t("openFile") + baseName;
    }

    return [
      {
        description: last2Parts,
        content: `${prefix}\n\n\`\`\`${relativePathOrBasename}\n${currentFile.contents}\n\`\`\``,
        name,
        uri: {
          type: "file",
          value: currentFile.path,
        },
      },
    ];
  }
}

export default CurrentFileContextProvider;
