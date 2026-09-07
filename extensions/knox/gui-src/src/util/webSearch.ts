import type { ModelDescription } from "core";
import {
  checkKnoxChatWebSearchSupportSync,
  findKnoxChatModelSync,
  modelSupportsWebSearchFromMetadata,
} from "core/llm/knoxChatModels";

type WebSearchModelInput =
  | string
  | Pick<
      ModelDescription,
      "provider" | "model" | "title" | "capabilities" | "supportedParameters"
    >
  | null
  | undefined;

function modelIdFromInput(model: WebSearchModelInput): string | undefined {
  if (!model) {
    return undefined;
  }
  if (typeof model === "string") {
    return model;
  }
  return model.model || model.title;
}

/**
 * Whether a model supports provider-native web search.
 * Prefer live /v1/models metadata first so stale capabilities.false from a
 * cold config load cannot hide the toggle after prefetch.
 */
export function modelSupportsWebSearch(model: WebSearchModelInput): boolean {
  if (!model) {
    return false;
  }

  const modelId = modelIdFromInput(model);
  if (modelId) {
    const apiResult = checkKnoxChatWebSearchSupportSync(modelId);
    if (apiResult !== undefined) {
      return apiResult;
    }
  }

  if (typeof model !== "string" && model.title) {
    const byTitle = findKnoxChatModelSync(model.title);
    if (byTitle) {
      return modelSupportsWebSearchFromMetadata(byTitle);
    }
  }

  if (typeof model !== "string") {
    if (
      model.supportedParameters?.includes("web_search") ||
      model.supportedParameters?.includes("web_search_options")
    ) {
      return true;
    }
    // Only trust explicit true from persisted caps; treat false as unknown
    // so a pre-enrichment serialize cannot permanently hide the toggle.
    if (model.capabilities?.webSearch === true) {
      return true;
    }
  }

  return false;
}
