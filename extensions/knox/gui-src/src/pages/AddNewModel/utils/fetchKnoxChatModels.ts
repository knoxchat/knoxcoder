import i18n from "../../../i18n";
import type { IIdeMessenger } from "../../../context/IdeMessenger";
import {
  deriveEnrichedModelParams,
  KNOX_CHAT_MODELS_URL,
  seedKnoxChatModelsCache,
  type KnoxChatModelMetadata,
  type ModelPricingFromApi,
} from "core/llm/knoxChatModels";
import type { ModelPackage } from "../configs/models";

/**
 * Represents a model from the KnoxChat API
 */
interface KnoxChatModel extends KnoxChatModelMetadata {
  name: string;
  description: string | null;
  context_length: number;
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
    modality?: string | null;
    instruct_type?: string | null;
  };
  per_request_limits?: Record<string, any>;
}

/**
 * Response structure from the KnoxChat API
 */
interface KnoxChatResponse {
  data: KnoxChatModel[];
}

type KnoxChatModelsRequester = Pick<IIdeMessenger, "request">;

async function loadKnoxChatModels(
  ideMessenger?: KnoxChatModelsRequester,
): Promise<KnoxChatModel[]> {
  if (ideMessenger && typeof vscode !== "undefined") {
    const result = await ideMessenger.request("knoxchat/listModels", undefined);

    if (result.status === "error") {
      throw new Error(result.error);
    }

    return Array.isArray(result.content)
      ? (result.content as KnoxChatModel[])
      : [];
  }

  const response = await fetch(KNOX_CHAT_MODELS_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.statusText}`);
  }

  const data: KnoxChatResponse = await response.json();
  return Array.isArray(data.data) ? data.data : [];
}

const DEVELOPER_CATEGORY: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  meta: "Meta",
  "meta-llama": "Meta",
  qwen: "Qwen",
  deepseek: "DeepSeek",
  mistralai: "Mistral",
  mistral: "Mistral",
  xai: "xAI",
  "x-ai": "xAI",
  cohere: "Cohere",
  perplexity: "Perplexity",
  moonshotai: "MoonshotAI",
  minimax: "MiniMax",
  stepfun: "StepFun",
  nvidia: "NVIDIA",
  xiaomi: "Xiaomi",
  "z-ai": "ChatGLM",
  knox: "KnoxChat",
};

/**
 * Categorizes a model by developer / owned_by, then ID / tokenizer heuristics.
 */
export function categorizeModel(model: KnoxChatModel): string {
  const developer = (
    model.developer ||
    model.owned_by ||
    model.provider_info?.provider_name ||
    ""
  ).toLowerCase();

  if (developer && DEVELOPER_CATEGORY[developer]) {
    return DEVELOPER_CATEGORY[developer];
  }

  const idAndName = `${model.id} ${model.name}`.toLowerCase();
  const tokenizer = model.architecture?.tokenizer?.toLowerCase() || "";

  if (
    idAndName.includes("openai") ||
    idAndName.includes("gpt") ||
    tokenizer.includes("gpt")
  ) {
    return "OpenAI";
  }
  if (
    idAndName.includes("claude") ||
    idAndName.includes("anthropic") ||
    tokenizer.includes("claude")
  ) {
    return "Anthropic";
  }
  if (
    idAndName.includes("llama") ||
    idAndName.includes("meta") ||
    tokenizer.includes("llama")
  ) {
    return "Meta";
  }
  if (
    idAndName.includes("gemini") ||
    idAndName.includes("palm") ||
    idAndName.includes("google") ||
    idAndName.includes("gemma") ||
    tokenizer.includes("gemini") ||
    tokenizer.includes("gemma")
  ) {
    return "Google";
  }
  if (idAndName.includes("glm") || tokenizer.includes("glm")) {
    return "ChatGLM";
  }
  if (idAndName.includes("qwen") || tokenizer.includes("qwen")) {
    return "Qwen";
  }
  if (idAndName.includes("deepseek") || tokenizer.includes("deepseek")) {
    return "DeepSeek";
  }
  if (idAndName.includes("mistral") || tokenizer.includes("mistral")) {
    return "Mistral";
  }
  if (idAndName.includes("cohere") || tokenizer.includes("cohere")) {
    return "Cohere";
  }
  if (idAndName.includes("perplexity") || idAndName.includes("sonar")) {
    return "Perplexity";
  }
  if (idAndName.includes("grok") || idAndName.includes("x-ai")) {
    return "xAI";
  }
  if (idAndName.includes("knox")) {
    return "KnoxChat";
  }

  return "Other";
}

/**
 * Extended ModelPackage with category information and API display metadata.
 */
export interface CategorizedModelPackage extends ModelPackage {
  category: string;
  maxTokens?: number;
  modalities?: string[];
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  supportsWebSearch?: boolean;
  supportsImageOutput?: boolean;
  /** USD pricing derived from /v1/models when available */
  pricing?: ModelPricingFromApi;
}

function getModelPackageParams(model: KnoxChatModel) {
  const enriched = deriveEnrichedModelParams(model);
  const contextLength =
    enriched.contextLength !== undefined &&
    Number.isFinite(enriched.contextLength)
      ? enriched.contextLength
      : enriched.contextLength === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : 180000;

  return {
    title: model.name,
    model: model.id,
    contextLength,
    ...(enriched.maxTokens !== undefined
      ? {
          completionOptions: {
            maxTokens: enriched.maxTokens,
          },
        }
      : {}),
    capabilities: enriched.capabilities,
    supportedParameters: enriched.supportedParameters,
    inputModalities: enriched.inputModalities,
    outputModalities: enriched.outputModalities,
  };
}

/**
 * Offline fallback when the KnoxChat API is unreachable.
 * Prefer the live API entry for knox/knox-ms whenever available.
 */
const ADDITIONAL_MODELS: CategorizedModelPackage[] = [
  {
    title: "Knox MS",
    description: i18n.t("knoxMsDescription"),
    params: {
      title: "Knox MS",
      model: "knox/knox-ms",
      contextLength: Infinity,
      completionOptions: {
        maxTokens: 128000,
      },
      capabilities: {
        tools: true,
        uploadImage: true,
        reasoning: true,
        webSearch: false,
        imageOutput: false,
      },
    },
    isOpenSource: false,
    category: "KnoxChat",
    maxTokens: 128000,
    modalities: ["text", "image", "file"],
    supportsTools: true,
    supportsReasoning: true,
  },
];

/**
 * Fetches available models from KnoxChat API and transforms them into ModelPackage format.
 */
export async function fetchKnoxChatModels(
  ideMessenger?: KnoxChatModelsRequester,
): Promise<CategorizedModelPackage[]> {
  try {
    const rawModels = await loadKnoxChatModels(ideMessenger);

    // Keep core/GUI sync lookups warm
    seedKnoxChatModelsCache(rawModels);

    const apiModels: CategorizedModelPackage[] = rawModels.map((model) => {
      const enriched = deriveEnrichedModelParams(model);
      return {
        title: model.name,
        description: model.description || `Model ID: ${model.id}`,
        params: getModelPackageParams(model),
        isOpenSource: false,
        category: categorizeModel(model),
        maxTokens: enriched.maxTokens,
        modalities: enriched.inputModalities,
        supportsTools: enriched.capabilities.tools,
        supportsReasoning: enriched.capabilities.reasoning,
        supportsWebSearch: enriched.capabilities.webSearch,
        supportsImageOutput: enriched.capabilities.imageOutput,
        pricing: enriched.pricing,
      };
    });

    const allModels = [...apiModels, ...ADDITIONAL_MODELS];

    const uniqueModels = allModels.filter(
      (model, index, self) =>
        index === self.findIndex((m) => m.params.model === model.params.model),
    );

    return uniqueModels;
  } catch (error) {
    console.error("Error fetching KnoxChat models:", error);
    return ADDITIONAL_MODELS;
  }
}
