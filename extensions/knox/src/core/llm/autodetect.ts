import {
  ChatMessage,
  ModelCapability,
  ModelDescription,
  TemplateType,
} from "../index.js";

import {
  anthropicTemplateMessages,
} from "./templates/chat.js";
import { claudeEditPrompt, gptEditPrompt } from "./templates/edit.js";
import {
  checkKnoxChatImageSupportSync,
  checkKnoxChatReasoningSupportSync,
  checkKnoxChatToolSupportSync,
  checkKnoxChatWebSearchSupportSync,
  PROVIDER_TOOL_SUPPORT,
} from "./toolSupport.js";

const PROVIDER_HANDLES_TEMPLATING: string[] = [
  "openai",
  "anthropic",
  "knoxchat",
];

const PROVIDER_SUPPORTS_IMAGES: string[] = [
  "openai",
  "anthropic",
  "knoxchat",
];

const MODEL_SUPPORTS_IMAGES: string[] = [
  "gemini",
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3",
  "opus-4",
  "opus-5",
  "sonnet-4",
  "sonnet-5",
  "sonnet",
  "opus",
  "haiku",
  "pixtral",
];

function modelSupportsTools(modelDescription: ModelDescription) {
  if (modelDescription.provider === "knoxchat") {
    const apiResult = checkKnoxChatToolSupportSync(modelDescription.model);
    if (apiResult !== undefined) {
      return apiResult;
    }
  }

  if (modelDescription.capabilities?.tools !== undefined) {
    return modelDescription.capabilities.tools;
  }

  const providerSupport = PROVIDER_TOOL_SUPPORT[modelDescription.provider];
  if (!providerSupport) {
    return false;
  }

  const result = providerSupport(modelDescription.model);

  if (result instanceof Promise) {
    if (modelDescription.provider === "knoxchat") {
      result.catch(() => false);
      return true;
    }
    return false;
  }

  return result ?? false;
}

async function modelSupportsToolsAsync(
  modelDescription: ModelDescription,
): Promise<boolean> {
  if (modelDescription.provider === "knoxchat") {
    const apiResult = checkKnoxChatToolSupportSync(modelDescription.model);
    if (apiResult !== undefined) {
      return apiResult;
    }
  }

  if (modelDescription.capabilities?.tools !== undefined) {
    return modelDescription.capabilities.tools;
  }

  const providerSupport = PROVIDER_TOOL_SUPPORT[modelDescription.provider];
  if (!providerSupport) {
    return false;
  }

  const result = providerSupport(modelDescription.model);

  if (result instanceof Promise) {
    try {
      return await result;
    } catch (error) {
      console.warn(
        `Error checking tool support for ${modelDescription.model}:`,
        error,
      );
      return false;
    }
  }

  return result ?? false;
}

function modelSupportsImages(
  provider: string,
  model: string,
  title: string | undefined,
  capabilities: ModelCapability | undefined,
): boolean {
  // Prefer live API for KnoxChat (same order as tools)
  if (provider === "knoxchat") {
    const apiResult = checkKnoxChatImageSupportSync(model);
    if (apiResult !== undefined) {
      return apiResult;
    }
  }

  if (capabilities?.uploadImage !== undefined) {
    return capabilities.uploadImage;
  }

  if (!PROVIDER_SUPPORTS_IMAGES.includes(provider)) {
    return false;
  }

  const lower = model.toLowerCase();
  if (
    MODEL_SUPPORTS_IMAGES.some(
      (modelName) => lower.includes(modelName) || title?.includes(modelName),
    )
  ) {
    return true;
  }

  return false;
}

function modelSupportsReasoning(
  modelDescription: Pick<ModelDescription, "provider" | "model" | "capabilities">,
): boolean {
  if (modelDescription.provider === "knoxchat") {
    const apiResult = checkKnoxChatReasoningSupportSync(modelDescription.model);
    if (apiResult !== undefined) {
      return apiResult;
    }
  }
  return modelDescription.capabilities?.reasoning ?? false;
}

function modelSupportsWebSearchCapability(
  modelDescription: Pick<ModelDescription, "provider" | "model" | "capabilities">,
): boolean {
  if (modelDescription.provider === "knoxchat") {
    const apiResult = checkKnoxChatWebSearchSupportSync(modelDescription.model);
    if (apiResult !== undefined) {
      return apiResult;
    }
  }
  return modelDescription.capabilities?.webSearch ?? false;
}
const PARALLEL_PROVIDERS: string[] = [
  "anthropic",
  "knoxchat",
];

function llmCanGenerateInParallel(provider: string, model: string): boolean {
  if (provider === "openai") {
    return model.includes("gpt");
  }

  return PARALLEL_PROVIDERS.includes(provider);
}

function autodetectTemplateType(model: string): TemplateType | undefined {
  const lower = model.toLowerCase();

  if (
    lower.includes("gpt") ||
    lower.includes("command") ||
    lower.includes("chat-bison") ||
    lower.includes("pplx")
  ) {
    return undefined;
  }

  // Claude requests always sent through Messages API, so formatting not necessary
  if (lower.includes("claude") || lower.includes("sonnet") || lower.includes("opus") || lower.includes("haiku")) {
    return "none";
  }

  return undefined;
}

function autodetectTemplateFunction(
  model: string,
  provider: string,
  explicitTemplate: TemplateType | undefined = undefined,
) {
  if (
    explicitTemplate === undefined &&
    PROVIDER_HANDLES_TEMPLATING.includes(provider)
  ) {
    return null;
  }

  const templateType = explicitTemplate ?? autodetectTemplateType(model);

  if (templateType) {
    const mapping: Record<
      TemplateType,
      null | ((msg: ChatMessage[]) => string)
    > = {
      anthropic: anthropicTemplateMessages,
      none: null,
    };

    return mapping[templateType];
  }

  return null;
}

/**
 * Pick an edit prompt template.
 * - `anthropic` / `none` (Claude Messages API) → Claude-tuned edit prompt
 * - otherwise (gpt-family / provider-native) → gpt edit prompt
 *
 * Dead OS-model branches removed: Knox only exposes TemplateType "anthropic" | "none".
 */
function autodetectPromptTemplates(
  model: string,
  explicitTemplate: TemplateType | undefined = undefined,
) {
  const templateType = explicitTemplate ?? autodetectTemplateType(model);
  const templates: Record<string, any> = {};

  if (templateType === "anthropic" || templateType === "none") {
    templates.edit = claudeEditPrompt;
  } else {
    templates.edit = gptEditPrompt;
  }

  return templates;
}

export {
  autodetectPromptTemplates,
  autodetectTemplateFunction,
  autodetectTemplateType,
  llmCanGenerateInParallel,
  modelSupportsImages,
  modelSupportsReasoning,
  modelSupportsTools,
  modelSupportsToolsAsync,
  modelSupportsWebSearchCapability,
};
