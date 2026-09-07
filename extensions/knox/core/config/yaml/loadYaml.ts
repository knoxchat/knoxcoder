import fs from "node:fs";

import {
  AssistantUnrolled,
  ConfigResult,
  ConfigValidationError,
  FQSN,
  ModelRole,
  PlatformClient,
  RegistryClient,
  SecretResult,
  SecretType,
  unrollAssistantFromContent,
  validateConfigYaml,
} from "knoxdev-package/config-yaml";

import {
  KnoxConfig,
  IContextProvider,
  IDE,
  IdeInfo,
  IdeSettings,
} from "../..";
import { slashFromCustomCommand } from "../../commands";
import {
  contextProviderClassFromName,
  createDefaultContextProviders,
  integrationProviderReady,
  INTEGRATION_CONTEXT_PROVIDER_TITLES,
  mergeContextProvidersWithDefaults,
} from "../../context/providers/index";
import { getAllPromptFiles } from "../../promptFiles/v2/getPromptFiles";
import { slashCommandFromPromptFile } from "../../promptFiles/v2/slashCommandFromPromptFile";
import { allTools, selectAgentTools } from "../../tools";
import { GlobalContext } from "../../util/GlobalContext";
import { getConfigYamlPath } from "../../util/paths";
import { getSystemPromptDotFile } from "../getSystemPromptDotFile";
import { loadProjectInstructions } from "../rules";
import { modifyAnyConfigWithSharedConfig } from "../sharedConfig";
import {
  detectWorkspaceKind,
  ideSettingsToExperimental,
  resolveAgentProfile,
  workspaceKindHints,
} from "../agentProfile";
import { loadAgentYamlExperimental } from "../agentYaml";
import { applyAgentJobsOptions } from "../../tools/shellJobs";

import { enrichKnoxChatModelCapabilitiesFromApi } from "../../llm/toolSupport";
import { llmsFromModelConfig } from "./models";

/**
 * Local-only secret resolution.
 * Resolves `${{ secrets.* }}` from process.env by secret name; otherwise
 * returns an explicit NotFound result so callers do not treat missing
 * secrets as a silent success.
 */
export class LocalPlatformClient implements PlatformClient {
  async resolveFQSNs(fqsns: FQSN[]): Promise<(SecretResult | undefined)[]> {
    if (fqsns.length === 0) {
      return [];
    }

    return fqsns.map((fqsn) => {
      const envValue = process.env[fqsn.secretName];
      if (envValue !== undefined && envValue !== "") {
        return {
          found: true as const,
          fqsn,
          value: envValue,
          secretLocation: {
            secretType: SecretType.User,
            userSlug: "local",
            secretName: fqsn.secretName,
          },
        };
      }

      return {
        found: false as const,
        fqsn,
        secretLocation: {
          secretType: SecretType.NotFound,
          secretName: fqsn.secretName,
        },
      };
    });
  }
}

async function loadConfigYaml(
  rawYaml: string,
  overrideConfigYaml: AssistantUnrolled | undefined,
): Promise<ConfigResult<AssistantUnrolled>> {
  let config =
    overrideConfigYaml ??
    (await unrollAssistantFromContent(
      {
        ownerSlug: "",
        packageSlug: "",
        versionSlug: "",
      },
      rawYaml,
      new RegistryClient(),
      {
        platformClient: new LocalPlatformClient(),
        renderSecrets: true,
      },
    ));
  const errors = validateConfigYaml(config);

  if (errors?.some((error) => error.fatal)) {
    return {
      errors,
      config: undefined,
      configLoadInterrupted: true,
    };
  }

  return {
    config,
    errors,
    configLoadInterrupted: false,
  };
}

async function configYamlToKnoxConfig(
  config: AssistantUnrolled,
  ide: IDE,
  ideSettings: IdeSettings,
  ideInfo: IdeInfo,
  uniqueId: string,
  writeLog: (log: string) => Promise<void>,
): Promise<{ config: KnoxConfig; errors: ConfigValidationError[] }> {
  const localErrors: ConfigValidationError[] = [];
  const knoxConfig: KnoxConfig = {
    slashCommands: [],
    models: [],
    tools: [...allTools],
    systemMessage: config.rules?.join("\n"),
    experimental: {
      ...loadAgentYamlExperimental(
        "",
        (config as { agent?: unknown }).agent,
      ),
    },
    rules: config.rules,
    contextProviders: [],
    modelsByRole: {
      chat: [],
      edit: [],
      apply: [],
      summarize: [],
      viewRead: [],
      realTimeSearch: [],
    },
    selectedModelByRole: {
      chat: null,
      edit: null,
      apply: null,
      summarize: null,
      viewRead: null,
      realTimeSearch: null,
    },
    data: config.data,
  };

  try {
    const promptFiles = await getAllPromptFiles(ide);

    for (const file of promptFiles) {
      try {
        const slashCommand = slashCommandFromPromptFile(
          file.path,
          file.content,
        );
        if (slashCommand) {
          knoxConfig.slashCommands?.push(slashCommand);
        }
      } catch (e) {
        localErrors.push({
          fatal: false,
          message: `Failed to convert prompt file ${file.path} to slash command: ${e instanceof Error ? e.message : e}`,
        });
      }
    }
  } catch (e) {
    localErrors.push({
      fatal: false,
      message: `Error loading local prompt files: ${e instanceof Error ? e.message : e}`,
    });
  }

  config.prompts?.forEach((prompt) => {
    try {
      const slashCommand = slashFromCustomCommand(prompt);
      knoxConfig.slashCommands?.push(slashCommand);
    } catch (e) {
      localErrors.push({
        message: `Error loading prompt ${prompt.name}: ${e instanceof Error ? e.message : e}`,
        fatal: false,
      });
    }
  });

  const modelsArrayRoles: ModelRole[] = ["chat", "summarize", "apply", "edit", "viewRead", "realTimeSearch"];
  for (const model of config.models ?? []) {
    model.roles = model.roles ?? modelsArrayRoles;
    try {
      const llms = await llmsFromModelConfig(
        model,
        ide,
        uniqueId,
        ideSettings,
        writeLog,
        knoxConfig.systemMessage,
      );

      if (modelsArrayRoles.some((role) => model.roles?.includes(role))) {
        knoxConfig.models.push(...llms);
      }

      if (model.roles?.includes("chat")) {
        knoxConfig.modelsByRole.chat.push(...llms);
      }

      if (model.roles?.includes("summarize")) {
        knoxConfig.modelsByRole.summarize.push(...llms);
      }

      if (model.roles?.includes("apply")) {
        knoxConfig.modelsByRole.apply.push(...llms);
      }

      if (model.roles?.includes("edit")) {
        knoxConfig.modelsByRole.edit.push(...llms);
      }

      if (model.roles?.includes("viewRead")) {
        knoxConfig.modelsByRole.viewRead.push(...llms);
      }

      if (model.roles?.includes("realTimeSearch")) {
        knoxConfig.modelsByRole.realTimeSearch.push(...llms);
      }

    } catch (e) {
      localErrors.push({
        fatal: false,
        message: `Failed to load model:\nName: ${model.name}\nModel: ${model.model}\nProvider: ${model.provider}\n${e instanceof Error ? e.message : e}`,
      });
    }
  }

  await enrichKnoxChatModelCapabilitiesFromApi(knoxConfig.models);

  const defaultTitles = new Set(
    createDefaultContextProviders().map((p) => p.description.title),
  );

  const fromConfig = (config.context
    ?.map((context) => {
      const cls = contextProviderClassFromName(context.provider) as any;
      if (!cls) {
        if (!defaultTitles.has(context.provider)) {
          localErrors.push({
            fatal: false,
            message: `Unknown context provider ${context.provider}`,
          });
        }
        return undefined;
      }

      if (INTEGRATION_CONTEXT_PROVIDER_TITLES.has(context.provider)) {
        const readiness = integrationProviderReady(
          context.provider,
          context.params ?? {},
        );
        if (!readiness.ok) {
          localErrors.push({
            fatal: false,
            message: `Integration context provider "${context.provider}" skipped: ${readiness.reason}`,
          });
          return undefined;
        }
      }

      const instance: IContextProvider = new cls(context.params ?? {});
      return instance;
    })
    .filter((p) => !!p) ?? []) as IContextProvider[];

  knoxConfig.contextProviders = mergeContextProvidersWithDefaults(fromConfig);

  return { config: knoxConfig, errors: localErrors };
}

export async function loadKnoxConfigFromYaml(
  ide: IDE,
  ideSettings: IdeSettings,
  ideInfo: IdeInfo,
  uniqueId: string,
  writeLog: (log: string) => Promise<void>,
  overrideConfigYaml: AssistantUnrolled | undefined,
  configYamlPath: string | undefined,
): Promise<ConfigResult<KnoxConfig>> {
  const rawYaml =
    overrideConfigYaml === undefined
      ? fs.readFileSync(
          configYamlPath ?? getConfigYamlPath(ideInfo.ideType),
          "utf-8",
        )
      : "";

  const configYamlResult = await loadConfigYaml(rawYaml, overrideConfigYaml);

  if (!configYamlResult.config || configYamlResult.configLoadInterrupted) {
    return {
      errors: configYamlResult.errors,
      config: undefined,
      configLoadInterrupted: true,
    };
  }

  const { config: knoxConfig, errors: localErrors } =
    await configYamlToKnoxConfig(
      configYamlResult.config,
      ide,
      ideSettings,
      ideInfo,
      uniqueId,
      writeLog,
    );

  const fromRawAgent = loadAgentYamlExperimental(
    rawYaml,
    (configYamlResult.config as { agent?: unknown }).agent,
  );
  knoxConfig.experimental = {
    ...ideSettingsToExperimental(ideSettings),
    ...fromRawAgent,
    ...knoxConfig.experimental,
  };

  try {
    const instructions = await loadProjectInstructions(ide);
    const systemPromptDotFile =
      instructions.systemPrompt ?? (await getSystemPromptDotFile(ide));
    if (systemPromptDotFile) {
      if (knoxConfig.systemMessage) {
        knoxConfig.systemMessage += "\n\n" + systemPromptDotFile;
      } else {
        knoxConfig.systemMessage = systemPromptDotFile;
      }
    }
    if (
      (instructions.policy.paths?.length ?? 0) > 0 ||
      (instructions.policy.commands?.length ?? 0) > 0
    ) {
      knoxConfig.experimental = {
        ...knoxConfig.experimental,
        agentPolicyFromRules: instructions.policy,
      };
    }
  } catch (e) {
    localErrors.push({
      fatal: false,
      message: `Failed to load system prompt dot file: ${e instanceof Error ? e.message : e}`,
    });
  }

  const sharedConfig = new GlobalContext().getSharedConfig();
  const withShared = modifyAnyConfigWithSharedConfig(
    knoxConfig,
    sharedConfig,
  );

  let workspaceIsSystems = false;
  let workspaceHints = workspaceKindHints(null);
  try {
    const dirs = await ide.getWorkspaceDirs();
    const root = dirs[0];
    if (root) {
      const entries = await ide.listDir(root);
      const kind = detectWorkspaceKind(entries.map(([name]) => name));
      workspaceHints = workspaceKindHints(kind);
      workspaceIsSystems = Boolean(workspaceHints.systems);
    }
  } catch {
    workspaceIsSystems = false;
  }
  withShared.experimental = {
    ...withShared.experimental,
    agentProfile: resolveAgentProfile(
      withShared.experimental?.agentProfile,
      workspaceHints,
    ),
  };
  const resolvedProfile = withShared.experimental?.agentProfile;
  let debugSessionActive = false;
  try {
    const status = await ide.debugControl?.({ op: "status" });
    debugSessionActive = Boolean(status?.sessionActive);
  } catch {
    debugSessionActive = false;
  }
  withShared.tools = selectAgentTools(allTools, {
    systems: resolvedProfile === "systems" || workspaceIsSystems,
    debugSessionActive,
  });

  applyAgentJobsOptions({
    logDir: withShared.experimental?.agentJobsLogDir,
    awaitTimeoutMs: withShared.experimental?.agentJobsAwaitTimeoutMs,
  });

  return {
    config: withShared,
    errors: [...(configYamlResult.errors ?? []), ...localErrors],
    configLoadInterrupted: false,
  };
}
