import { KnoxConfig, IDE } from "core";
import { fetchwithRequestOptions } from "knoxdev-package/fetch";
import { QuickPickItem, window } from "vscode";

export async function getContextProviderItems({
  contextProviders,
}: KnoxConfig): Promise<QuickPickItem[]> {
  if (!contextProviders) {
    return [];
  }

  const quickPickItems = contextProviders
    .filter((provider) => provider.description.type === "normal")
    .map((provider) => {
      return {
        label: provider.description.displayTitle,
        detail: provider.description.description,
      };
    });

  return quickPickItems;
}

export async function getContextProvidersString(
  selectedProviders: QuickPickItem[] | undefined,
  config: KnoxConfig,
  ide: IDE,
): Promise<string> {
  const contextItems = (
    await Promise.all(
      selectedProviders?.map((selectedProvider) => {
        const provider = config.contextProviders?.find(
          (provider) =>
            provider.description.displayTitle === selectedProvider.label,
        );

        if (!provider) {
          return [];
        }

        return provider.getContextItems("", {
          config,
          ide,
          llm: config.models[0],
          fullInput: "",
          selectedCode: [],
          fetch: (url, init) =>
            fetchwithRequestOptions(url, init, config.requestOptions),
        });
      }) || [],
    )
  ).flat();

  return contextItems.map((item) => item.content).join("\n\n") + "\n\n---\n\n";
}

export async function getContextProviderQuickPickVal(
  config: KnoxConfig,
  ide: IDE,
) {
  const contextProviderItems = await getContextProviderItems(config);

  const quickPick = window.createQuickPick();

  quickPick.items = contextProviderItems;
  quickPick.title = "Context Source";
  quickPick.placeholder = "Please select a context source to add to your prompt";
  quickPick.canSelectMany = true;

  quickPick.show();

  const val = await new Promise<string>((resolve) => {
    quickPick.onDidAccept(async () => {
      const selectedItems = Array.from(quickPick.selectedItems);
      getContextProvidersString(selectedItems, config, ide)
        .then(resolve)
        .catch((e) => {
          console.warn(`Failed to get context source: ${e}`);
          resolve("");
        });
    });
  });

  quickPick.dispose();

  return val;
}
