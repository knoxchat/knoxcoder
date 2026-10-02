import { fetchwithRequestOptions } from "knoxdev-package/fetch";
import { v4 as uuidv4 } from "uuid";

import CurrentFileContextProvider from "../context/providers/CurrentFileContextProvider";
import { gatherAutoContext } from "../context/autoContext";
import { searchWorkspaceMentions } from "../context/searchWorkspaceMentions";
import { t } from "../i18n/index.js";
import { getSymbolsForManyFiles } from "../util/treeSitter";

import type { ContextItemId } from "..";
import type { CoreRuntime } from "./runtime";

export function registerContextHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  // Context providers

  on("context/loadSubmenuItems", async (msg) => {
    const { config } = await core.configHandler.loadConfig();
    if (!config) {
      return [];
    }

    const items = await config.contextProviders
      ?.find((provider) => provider.description.title === msg.data.title)
      ?.loadSubmenuItems({
        config,
        ide: core.ide,
        fetch: (url, init) =>
          fetchwithRequestOptions(url, init, config.requestOptions),
      });
    return items || [];
  });

  on("context/searchFiles", async (msg) => {
    return searchWorkspaceMentions(
      core.ide,
      msg.data.query,
      msg.data.limit,
    );
  });

  on("context/getContextItems", async (msg) => {
    const { config } = await core.configHandler.loadConfig();
    if (!config) {
      return [];
    }

    const { name, query, fullInput, selectedCode, selectedModelTitle } =
      msg.data;

    const llm = await core.configHandler.llmFromTitle(selectedModelTitle);
    const provider =
      config.contextProviders?.find(
        (provider) => provider.description.title === name,
      ) ??
      [
        // user doesn't need these in their config.json for the shortcuts to work
        // option+enter
        new CurrentFileContextProvider({}),
        // cmd+enter
      ].find((provider) => provider.description.title === name);
    if (!provider) {
      return [];
    }

    try {
      const id: ContextItemId = {
        providerTitle: provider.description.title,
        itemId: uuidv4(),
      };

      const items = await provider.getContextItems(query, {
        config,
        llm,
        fullInput,
        ide: core.ide,
        selectedCode,
        fetch: (url, init) =>
          fetchwithRequestOptions(url, init, config.requestOptions),
      });

      return items.map((item) => ({
        ...item,
        id,
      }));
    } catch (e) {
      let knownError = false;

      if (e instanceof Error) {
      }
      if (!knownError) {
        void core.ide.showToast(
          "error",
          t("errorGettingContextItem", { name, error: String(e) }),
        );
      }
      return [];
    }
  });

  on("context/getSymbolsForFiles", async (msg) => {
    const { uris } = msg.data;
    return await getSymbolsForManyFiles(uris, core.ide);
  });

  on("context/getAutoContext", async (msg) => {
    const { message, existingContextPaths, modelName } = msg.data;
    const pathSet = new Set<string>(existingContextPaths || []);
    try {
      return await gatherAutoContext(
        message,
        core.ide,
        pathSet,
        modelName || "gpt-4",
      );
    } catch (e) {
      console.error("[AutoContext] Failed to gather auto-context:", e);
      return [];
    }
  });
}
