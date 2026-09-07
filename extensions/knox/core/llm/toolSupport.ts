import {
  checkKnoxChatToolSupport,
  checkKnoxChatToolSupportSync,
} from "./knoxChatModels.js";

export type { KnoxChatModelMetadata } from "./knoxChatModels.js";
export {
  checkKnoxChatImageOutputSupportSync,
  checkKnoxChatImageSupportSync,
  checkKnoxChatParameterSupportSync,
  checkKnoxChatReasoningSupportSync,
  checkKnoxChatToolSupportSync,
  checkKnoxChatWebSearchSupportSync,
  deriveEnrichedModelParams,
  enrichKnoxChatModelCapabilitiesFromApi,
  findKnoxChatModelSync,
  getKnoxChatModelPricingSync,
  getKnoxChatModels,
  getMetadataContextLength,
  getMetadataMaxCompletionTokens,
  getRecommendedMaxTokens,
  hydrateKnoxChatModelsCacheFromDisk,
  isOpenAIReasoningSeriesModel,
  modelSupportsImageInput,
  modelSupportsImageOutput,
  modelSupportsParameter,
  modelSupportsReasoningFromSupportedParameters,
  modelSupportsToolsFromSupportedParameters,
  modelSupportsWebSearchFromMetadata,
  preloadKnoxChatModels,
  seedKnoxChatModelsCache,
  shouldEnrichFromKnoxChatApi,
} from "./knoxChatModels.js";

export {
  DEFAULT_REASONING_EFFORT_CONFIG,
  getReasoningEffortConfigFromMetadata,
  resolveReasoningEffortConfigForModel,
} from "./reasoningEffortConfig.js";
export type { ReasoningEffortConfig } from "./reasoningEffortConfig.js";

export const PROVIDER_TOOL_SUPPORT: Record<
  string,
  (model: string) => boolean | undefined | Promise<boolean>
> = {
  anthropic: (model) => {
    if (
      ["claude-fable", "claude-sonnet", "claude-opus", "claude-haiku"].some(
        (part) => model.toLowerCase().startsWith(part),
      )
    ) {
      return true;
    }
  },
  openai: (model) => {
    // https://platform.openai.com/docs/guides/function-calling#models-supporting-function-calling
    if (
      model.toLowerCase().startsWith("gpt-5") ||
      model.toLowerCase().startsWith("gemini") ||
      model.toLowerCase().startsWith("claude-sonnet") ||
      model.toLowerCase().startsWith("claude-opus") ||
      model.toLowerCase().startsWith("claude-haiku") ||
      model.toLowerCase().startsWith("claude-fable") ||
      model.toLowerCase().startsWith("o3")
    ) {
      return true;
    }
  },

  // KnoxChat support for tool calling - dynamically determined from KnoxChat API
  knoxchat: (model) => {
    const cached = checkKnoxChatToolSupportSync(model);
    if (cached !== undefined) {
      return cached;
    }
    return checkKnoxChatToolSupport(model);
  },
};
