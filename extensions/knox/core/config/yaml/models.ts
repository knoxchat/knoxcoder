import { ModelConfig } from "knoxdev-package/config-yaml";

import { IDE, IdeSettings, LLMOptions } from "../..";
import { t } from "../../i18n/index.js";
import { BaseLLM } from "../../llm";
import { LLMClasses } from "../../llm/llms";

const AUTODETECT = "AUTODETECT";

function getModelClass(
  model: ModelConfig,
): (typeof LLMClasses)[number] | undefined {
  return LLMClasses.find((llm) => llm.providerName === model.provider);
}

async function modelConfigToBaseLLM(
  model: ModelConfig,
  uniqueId: string,
  writeLog: (log: string) => Promise<void>,
  systemMessage: string | undefined,
): Promise<BaseLLM | undefined> {
  const cls = getModelClass(model);

  if (!cls) {
    return undefined;
  }

  const { capabilities, defaultCompletionOptions, ...rest } = model;
  const { contextLength, ...completionOptions } = defaultCompletionOptions ?? {};

  let options: LLMOptions = {
    ...rest,
    contextLength,
    completionOptions: {
      ...completionOptions,
      model: model.model,
      maxTokens:
        completionOptions.maxTokens ??
        cls.defaultOptions?.completionOptions?.maxTokens,
    },
    writeLog,
    uniqueId,
    title: model.name,
    systemMessage,
    promptTemplates: model.promptTemplates,
    // Only set capabilities that are explicitly true. Leaving others
    // undefined lets KnoxChat /v1/models enrichment + autodetection win
    // (YAML `false` must not permanently hide toggles after a cold start).
    capabilities: {
      ...(model.capabilities?.includes("tool_use") ? { tools: true } : {}),
      ...(model.capabilities?.includes("image_input")
        ? { uploadImage: true }
        : {}),
      ...(model.capabilities?.includes("image_output")
        ? { imageOutput: true }
        : {}),
      ...(model.capabilities?.includes("reasoning") ? { reasoning: true } : {}),
      ...(model.capabilities?.includes("web_search") ? { webSearch: true } : {}),
    },
  };

  // Also honor the top-level `capabilities` array used by some YAML shapes
  if (capabilities?.find((c) => c === "tool_use")) {
    options.capabilities = {
      ...options.capabilities,
      tools: true,
    };
  }

  if (capabilities?.find((c) => c === "image_input")) {
    options.capabilities = {
      ...options.capabilities,
      uploadImage: true,
    };
  }

  if (capabilities?.find((c) => c === "image_output")) {
    options.capabilities = {
      ...options.capabilities,
      imageOutput: true,
    };
  }

  if (capabilities?.find((c) => c === "reasoning")) {
    options.capabilities = {
      ...options.capabilities,
      reasoning: true,
    };
  }

  if (capabilities?.find((c) => c === "web_search")) {
    options.capabilities = {
      ...options.capabilities,
      webSearch: true,
    };
  }


  // These are params that are at model config level in JSON
  // But we decided to move to nested `env` in YAML
  // Since types vary and we don't want to blindly spread env for now,
  // Each one is handled individually here
  const env = model.env ?? {};
  if (
    "useLegacyCompletionsEndpoint" in env &&
    typeof env.useLegacyCompletionsEndpoint === "boolean"
  ) {
    options.useLegacyCompletionsEndpoint = env.useLegacyCompletionsEndpoint;
  }
  if ("aiGatewaySlug" in env && typeof env.aiGatewaySlug === "string") {
    options.aiGatewaySlug = env.aiGatewaySlug;
  }

  const llm = new cls(options);
  return llm;
}

async function autodetectModels(
  llm: BaseLLM,
  model: ModelConfig,
  uniqueId: string,
  writeLog: (log: string) => Promise<void>,
  systemMessage: string | undefined,
): Promise<BaseLLM[]> {
  try {
    const modelNames = await llm.listModels();
    const detectedModels = await Promise.all(
      modelNames.map(async (modelName) => {
        // To ensure there are no infinite loops
        if (modelName === AUTODETECT) {
          return undefined;
        }

        return await modelConfigToBaseLLM(
          {
            ...model,
            model: modelName,
            name: modelName,
          },
          uniqueId,
          writeLog,
          systemMessage,
        );
      }),
    );
    return detectedModels.filter((x) => typeof x !== "undefined") as BaseLLM[];
  } catch (e) {
    console.warn(t("errorWhileListingModels"), e);
    return [];
  }
}

export async function llmsFromModelConfig(
  model: ModelConfig,
  _ide: IDE,
  uniqueId: string,
  _ideSettings: IdeSettings,
  writeLog: (log: string) => Promise<void>,
  systemMessage: string | undefined,
): Promise<BaseLLM[]> {
  const baseLlm = await modelConfigToBaseLLM(
    model,
    uniqueId,
    writeLog,
    systemMessage,
  );
  if (!baseLlm) {
    return [];
  }

  if (model.model === AUTODETECT) {
    return await autodetectModels(
      baseLlm,
      model,
      uniqueId,
      writeLog,
      systemMessage,
    );
  }
  return [baseLlm];
}
