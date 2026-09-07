import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../index.js";
import { t } from "../../i18n/index.js";
import { BaseContextProvider } from "../index.js";

class DiffContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "diff",
    displayTitle: "Git Diff",
    description: t("currentGitDiff"),
    type: "normal",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const diff = await extras.ide.getDiff(
      this.options?.includeUnstaged ?? true,
    );
    return [
      {
        description: t("currentGitDiff"),
        content:
          diff.length === 0
            ? t("gitShowsNoChanges")
            : `\`\`\`git diff\n${diff.join("\n")}\n\`\`\``,
        name: "Git Diff",
      },
    ];
  }
}

export default DiffContextProvider;
