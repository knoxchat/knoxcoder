import Handlebars from "handlebars";

import { ContextItem, KnoxSDK, IContextProvider } from "../..";

function createContextItem(item: ContextItem, provider: IContextProvider) {
  return {
    ...item,
    id: {
      itemId: item.description,
      providerTitle: provider.description.title,
    },
  };
}

export function getContextProviderHelpers(
  context: KnoxSDK,
): Array<[string, Handlebars.HelperDelegate]> | undefined {
  return context.config.contextProviders?.map((provider: IContextProvider) => [
    provider.description.title,
    async (helperContext: any) => {
      const items = await provider.getContextItems(helperContext, {
        config: context.config,
        fetch: context.fetch,
        fullInput: context.input,
        ide: context.ide,
        llm: context.llm,
        selectedCode: context.selectedCode,
      });

      items.forEach((item) =>
        context.addContextItem(createContextItem(item, provider)),
      );

      return items.map((item) => item.content).join("\n\n");
    },
  ]);
}
