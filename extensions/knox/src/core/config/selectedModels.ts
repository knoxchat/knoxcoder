import { ALL_MODEL_ROLES, ModelRole } from "knoxdev-package/config-yaml";

import { KnoxConfig, ILLM } from "..";
import {
  GlobalContext,
  GlobalContextModelSelections,
} from "../util/GlobalContext";

function resolveUnifiedModel(
  knoxConfig: KnoxConfig,
  currentForProfile: GlobalContextModelSelections,
): ILLM | null {
  const preferredTitles = [
    currentForProfile.chat,
    currentForProfile.edit,
    currentForProfile.apply,
    currentForProfile.viewRead,
    currentForProfile.realTimeSearch,
    currentForProfile.summarize,
  ];
  for (const title of preferredTitles) {
    if (!title) {
      continue;
    }
    const match = knoxConfig.models.find((model) => model.title === title);
    if (match) {
      return match;
    }
  }
  return knoxConfig.models[0] ?? knoxConfig.modelsByRole.chat[0] ?? null;
}

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

  const unified = resolveUnifiedModel(knoxConfig, currentForProfile);
  console.log(
    `[rectifySelectedModels] Unified model: ${unified?.title || "null"}`,
  );

  let fellBack = false;
  const roles: ModelRole[] = [...ALL_MODEL_ROLES];
  for (const role of roles) {
    const currentSelection = currentForProfile[role] ?? null;
    if (currentSelection !== (unified?.title ?? null)) {
      fellBack = true;
    }
    configCopy.selectedModelByRole[role] = unified;
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
