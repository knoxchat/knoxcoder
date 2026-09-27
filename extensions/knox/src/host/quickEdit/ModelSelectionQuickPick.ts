import { KnoxConfig } from "core";
import { QuickPickItem, window } from "vscode";

import { t } from "../i18n";

export async function getModelQuickPickVal(
  curModelTitle: string,
  config: KnoxConfig,
) {
  const modelItems: QuickPickItem[] = config.models.map((model) => {
    const isCurModel = curModelTitle === model.title;

    return {
      label: model.title
        ? `${isCurModel ? "$(check)" : "     "} ${model.title}`
        : "Model title not set",
    };
  });

  const selectedItem = await window.showQuickPick(modelItems, {
    title: "Model",
    placeHolder: t("quickEdit.selectModel"),
  });

  if (!selectedItem) {
    return undefined;
  }

  const selectedModelTitle = config.models.find(
    (model) => model.title && selectedItem.label.includes(model.title),
  )?.title;

  return selectedModelTitle;
}
