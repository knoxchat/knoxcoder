import { ModelRole } from "knoxdev-package/config-yaml";

import { KnoxConfig, ILLM } from "..";
import {
  GlobalContext,
  GlobalContextModelSelections,
} from "../util/GlobalContext";

export function rectifySelectedModelsFromGlobalContext(
  knoxConfig: KnoxConfig,
  profileId: string,
): KnoxConfig {
  console.log(`[rectifySelectedModels] Processing profile: ${profileId}`);
  const configCopy = { ...knoxConfig };

  const globalContext = new GlobalContext();
  const currentSelectedModels = globalContext.get("selectedModelsByProfileId");
  const currentForProfile: GlobalContextModelSelections =
    currentSelectedModels?.[profileId] ?? {};

  console.log(`[rectifySelectedModels] Current selections for profile:`, currentForProfile);

  let fellBack = false;

  const roles: ModelRole[] = [
    "chat",
    "summarize",
    "apply",
    "edit",
    "viewRead",
    "realTimeSearch",
  ];
  for (const role of roles) {
    let newModel: ILLM | null = null;
    const currentSelection = currentForProfile[role] ?? null;
    console.log(`[rectifySelectedModels] Role '${role}': currentSelection = ${currentSelection}`);
    
    if (currentSelection) {
      const match = knoxConfig.modelsByRole[role].find(
        (m) => m.title === currentSelection,
      );
      if (match) {
        newModel = match;
        console.log(`[rectifySelectedModels] Role '${role}': Found matching model: ${match.title}`);
      } else {
        console.log(`[rectifySelectedModels] Role '${role}': No matching model found for '${currentSelection}'`);
      }
    }
    if (!newModel && knoxConfig.modelsByRole[role].length > 0) {
      newModel = knoxConfig.modelsByRole[role][0];
      console.log(`[rectifySelectedModels] Role '${role}': Auto-selected first available model: ${newModel.title}`);
    }
    if (!(currentSelection === (newModel?.title ?? null))) {
      fellBack = true;
    }
    configCopy.selectedModelByRole[role] = newModel;
    console.log(`[rectifySelectedModels] Role '${role}': Final selection: ${newModel?.title || 'null'}`);
  }

  // In the case shared config wasn't respected,
  // Rewrite the shared config
  if (fellBack) {
    globalContext.update("selectedModelsByProfileId", {
      ...currentSelectedModels,
      [profileId]: Object.fromEntries(
        Object.entries(configCopy.selectedModelByRole).map(([key, value]) => [
          key,
          value?.title ?? null,
        ]),
      ),
    });
  }

  return configCopy;
}
