import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../index.js";
import { t } from "../../i18n/index.js";
import { BaseContextProvider } from "../index.js";

class TerminalContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "terminal",
    displayTitle: "Terminal",
    description: t("lastTerminalCommand"),
    type: "normal",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const content = await extras.ide.getTerminalContents();
    return [
      {
        description: t("terminalContent"),
        content: `Current terminal content:\n\n${content}`,
        name: "Terminal",
      },
    ];
  }
}

export default TerminalContextProvider;
