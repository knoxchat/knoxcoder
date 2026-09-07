import { ModelRole } from "knoxdev-package/config-yaml";

import {
  BrowserSerializedKnoxConfig,
  ILLM,
  KnoxConfig,
  ModelDescription,
} from "../";
import { getContextProviderCategory } from "../context/providers/index";

function llmToSerializedModelDescription(llm: ILLM): ModelDescription {
  return {
    provider: llm.providerName,
    model: llm.model,
    title: llm.title ?? llm.model,
    apiKey: llm.apiKey,
    apiBase: llm.apiBase,
    contextLength: llm.contextLength,
    template: llm.template,
    completionOptions: llm.completionOptions,
    systemMessage: llm.systemMessage,
    requestOptions: llm.requestOptions,
    promptTemplates: llm.promptTemplates as any,
    capabilities: llm.capabilities,
    supportedParameters: llm.supportedParameters,
    inputModalities: llm.inputModalities,
    outputModalities: llm.outputModalities,
    roles: llm.roles,
  };
}

export async function finalToBrowserConfig(
  final: KnoxConfig,
): Promise<BrowserSerializedKnoxConfig> {
  return {
    models: final.models.map(llmToSerializedModelDescription),
    systemMessage: final.systemMessage,
    completionOptions: final.completionOptions,
    slashCommands: final.slashCommands?.map(
      ({ run, ...slashCommandDescription }) => slashCommandDescription,
    ),
    contextProviders: final.contextProviders?.map((c) => ({
      ...c.description,
      category:
        c.description.category ??
        getContextProviderCategory(c.description.title),
    })),
    disableSessionTitles: final.disableSessionTitles,
    ui: final.ui,
    experimental: final.experimental,
    rules: final.rules,
    tools: final.tools,
    modelsByRole: Object.fromEntries(
      Object.entries(final.modelsByRole).map(([k, v]) => [
        k,
        v.map(llmToSerializedModelDescription),
      ]),
    ) as Record<ModelRole, ModelDescription[]>,
    selectedModelByRole: Object.fromEntries(
      Object.entries(final.selectedModelByRole).map(([k, v]) => [
        k,
        v ? llmToSerializedModelDescription(v) : null,
      ]),
    ) as Record<ModelRole, ModelDescription | null>,
  };
}
