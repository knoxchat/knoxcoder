import type { ModelDescription } from "core";
import {
  checkKnoxChatReasoningSupportSync,
  findKnoxChatModelSync,
  modelSupportsParameter,
  modelSupportsReasoningFromSupportedParameters,
} from "core/llm/knoxChatModels";
import {
  normalizeReasoningModelId,
  resolveReasoningEffortConfigForModel,
  type ReasoningEffortConfig,
} from "core/llm/reasoningEffortConfig";

export type { ReasoningEffortConfig };

type ReasoningModelInput =
  | string
  | Pick<
      ModelDescription,
      "provider" | "model" | "title" | "capabilities" | "supportedParameters"
    >
  | null
  | undefined;

function modelIdFromInput(model: ReasoningModelInput): string | undefined {
  if (!model) {
    return undefined;
  }
  if (typeof model === "string") {
    return model;
  }
  return model.model || model.title;
}

/**
 * Stable key for sticky per-model effort preferences.
 */
export function getReasoningModelKey(
  model: ReasoningModelInput,
): string | undefined {
  if (!model) {
    return undefined;
  }
  if (typeof model === "string") {
    const normalized = normalizeReasoningModelId(model);
    return normalized || model;
  }
  const id = model.model || model.title;
  if (!id) {
    return undefined;
  }
  return normalizeReasoningModelId(id, model.provider) || id;
}

/**
 * All ids that may have been used as sticky keys for this model
 * (normalized id, raw model id, title). Lookup uses every candidate so a
 * relaunch cannot miss the saved effort if the displayed model object differs.
 */
export function getReasoningModelKeys(
  model: ReasoningModelInput,
): string[] {
  const keys: string[] = [];
  const add = (value?: string) => {
    if (value && !keys.includes(value)) {
      keys.push(value);
    }
  };

  add(getReasoningModelKey(model));
  if (!model) {
    return keys;
  }
  if (typeof model === "string") {
    add(model);
    add(normalizeReasoningModelId(model));
    return keys;
  }
  add(model.model);
  add(model.title);
  if (model.model) {
    add(normalizeReasoningModelId(model.model, model.provider));
  }
  if (model.title) {
    add(normalizeReasoningModelId(model.title, model.provider));
  }
  return keys;
}

/**
 * Whether the model supports reasoning at all.
 * Prefer live /v1/models metadata, then persisted capabilities / parameters.
 */
export function modelSupportsReasoning(model: ReasoningModelInput): boolean {
  if (!model) {
    return false;
  }

  const modelId = modelIdFromInput(model);
  if (modelId) {
    const apiResult = checkKnoxChatReasoningSupportSync(modelId);
    if (apiResult !== undefined) {
      return apiResult;
    }
  }

  if (typeof model !== "string") {
    if (
      modelSupportsReasoningFromSupportedParameters(model.supportedParameters)
    ) {
      return true;
    }
    if (model.capabilities?.reasoning !== undefined) {
      return model.capabilities.reasoning;
    }
  }

  return false;
}

/**
 * Effort selector requires adjustable effort, not just reasoning/thinking.
 * Source of truth: /v1/models `supported_parameters` incl. reasoning_effort,
 * or `reasoning.supported_efforts`.
 */
function modelSupportsReasoningEffort(model: ReasoningModelInput): boolean {
  if (!model) {
    return false;
  }

  if (typeof model !== "string") {
    if (model.supportedParameters?.includes("reasoning_effort")) {
      return true;
    }
  }

  const modelId = modelIdFromInput(model);
  if (!modelId) {
    return false;
  }

  const metadata = findKnoxChatModelSync(modelId);
  if (!metadata) {
    return false;
  }

  if (
    modelSupportsParameter(metadata.supported_parameters, "reasoning_effort")
  ) {
    return true;
  }

  // OpenRouter-style reasoning object (array or null = all gateway values)
  return !!(metadata.reasoning && "supported_efforts" in metadata.reasoning);
}

/**
 * Effort enums from API metadata → versioned sidecar → gateway default.
 * No per-model allow-lists live in the GUI.
 */
export function getReasoningEffortConfig(
  model: ReasoningModelInput,
): ReasoningEffortConfig | null {
  if (!model) {
    return null;
  }

  if (!modelSupportsReasoningEffort(model)) {
    return null;
  }

  const candidates =
    typeof model === "string"
      ? [model]
      : ([model.model, model.title].filter(Boolean) as string[]);
  const provider = typeof model === "string" ? undefined : model.provider;
  const supportedParameters =
    typeof model === "string" ? undefined : model.supportedParameters;

  for (const candidate of candidates) {
    const normalized = normalizeReasoningModelId(candidate, provider);
    const metadata =
      findKnoxChatModelSync(normalized) ?? findKnoxChatModelSync(candidate);
    const config = resolveReasoningEffortConfigForModel({
      modelId: normalized || candidate,
      provider,
      supportedParameters,
      metadata,
    });
    if (config) {
      return config;
    }
  }

  return resolveReasoningEffortConfigForModel({
    supportedParameters,
  });
}

/**
 * Show the pre-content "Thinking…" placeholder for any reasoning-capable model,
 * not only legacy o1 ids.
 */
export function shouldShowThinkingPlaceholder(
  model: ReasoningModelInput,
): boolean {
  if (!model) {
    return false;
  }
  if (getReasoningEffortConfig(model)) {
    return true;
  }
  return modelSupportsReasoning(model);
}

/**
 * Resolve effort for a request / UI:
 * 1) sticky per-model preference when still allowed
 * 2) API / sidecar default for that model
 *
 * A global leftover selection is intentionally ignored so switching models
 * does not inherit another model's effort.
 */
export function resolveReasoningEffort(
  model: ReasoningModelInput,
  stickyByModel?: Record<string, string> | null,
  /** @deprecated Prefer stickyByModel; kept for one-release migration of persisted UI state */
  legacySelectedEffort?: string | null,
): string | undefined {
  const config = getReasoningEffortConfig(model);
  if (!config) {
    return undefined;
  }

  const modelKeys = getReasoningModelKeys(model);
  for (const modelKey of modelKeys) {
    const sticky = stickyByModel?.[modelKey];
    if (sticky && config.allowed.includes(sticky)) {
      return sticky;
    }
  }

  // Migration: empty sticky map + old single global value still valid for this model
  const stickyEmpty =
    !stickyByModel || Object.keys(stickyByModel).length === 0;
  if (
    stickyEmpty &&
    legacySelectedEffort &&
    config.allowed.includes(legacySelectedEffort)
  ) {
    return legacySelectedEffort;
  }

  return config.default;
}
