import {
  AssistantUnrolled,
  ConfigResult,
} from "knoxdev-package/config-yaml";

import { KnoxConfig, IDE, IdeSettings } from "../../";
import BuiltInSlashCommands from "../../commands/slash";
import { getConfigYamlPath } from "../../util/paths";
import { localPathOrUriToPath } from "../../util/pathToUri";
import { rectifySelectedModelsFromGlobalContext } from "../selectedModels";
import { loadKnoxConfigFromYaml } from "../yaml/loadYaml";

export default async function doLoadConfig(
  ide: IDE,
  ideSettingsPromise: Promise<IdeSettings>,
  writeLog: (message: string) => Promise<void>,
  overrideConfigYaml: AssistantUnrolled | undefined,
  profileId: string,
  overrideConfigYamlByPath: string | undefined,
): Promise<ConfigResult<KnoxConfig>> {
  const ideInfo = await ide.getIdeInfo();
  const uniqueId = await ide.getUniqueId();
  const ideSettings = await ideSettingsPromise;

  const configYamlPath = localPathOrUriToPath(
    overrideConfigYamlByPath || getConfigYamlPath(ideInfo.ideType),
  );

  const result = await loadKnoxConfigFromYaml(
    ide,
    ideSettings,
    ideInfo,
    uniqueId,
    writeLog,
    overrideConfigYaml,
    configYamlPath,
  );

  let newConfig = result.config;
  let errors = result.errors;
  const configLoadInterrupted = result.configLoadInterrupted;

  if (configLoadInterrupted || !newConfig) {
    return { errors, config: newConfig, configLoadInterrupted: true };
  }

  errors = [...(errors ?? [])];

  newConfig = rectifySelectedModelsFromGlobalContext(newConfig, profileId);

  const existingSlashNames = new Set(
    newConfig.slashCommands.map((c) => c.name),
  );
  for (const builtIn of BuiltInSlashCommands) {
    if (!existingSlashNames.has(builtIn.name)) {
      newConfig.slashCommands.push(builtIn);
    }
  }

  const counts: Record<string, number> = {};
  newConfig.tools.forEach((tool) => {
    if (counts[tool.function.name]) {
      counts[tool.function.name] = counts[tool.function.name] + 1;
    } else {
      counts[tool.function.name] = 1;
    }
  });
  Object.entries(counts).forEach(([toolName, count]) => {
    if (count > 1) {
      errors!.push({
        fatal: false,
        message: `Detected duplicate tools (${count}) with the name "${toolName}". This will cause permission conflicts and usage may be unpredictable.`,
      });
    }
  });

  return { config: newConfig, errors, configLoadInterrupted: false };
}
