import overrides from "./data/reasoningEffortOverrides.json";
import {
  findKnoxChatModelSync,
  modelSupportsParameter,
  type KnoxChatModelMetadata,
} from "./knoxChatModels.js";

export type ReasoningEffortConfig = {
  allowed: string[];
  default: string;
};

/** Gateway-wide default when effort is supported but enums are unknown. */
export const DEFAULT_REASONING_EFFORT_CONFIG: ReasoningEffortConfig = {
  allowed: ["none", "low", "medium", "high", "xhigh", "max", "minimal"],
  default: "medium",
};

type SidecarFile = {
  version: number;
  models: Record<string, ReasoningEffortConfig>;
};

const sidecar = overrides as SidecarFile;

function normalizeModelId(value: string, provider?: string): string {
  const id = value.trim().toLowerCase();
  const modelProvider = provider?.trim().toLowerCase();

  if (!id) {
    return "";
  }
  if (id.includes("/")) {
    return id;
  }
  if (id.startsWith("gpt-") || modelProvider === "openai") {
    return `openai/${id}`;
  }
  if (id.startsWith("claude-") || modelProvider === "anthropic") {
    return `anthropic/${id}`;
  }
  return id;
}

/**
 * Effort config from API `reasoning` object when KnoxChat/OpenRouter-style
 * metadata includes supported_efforts / default_effort.
 */
export function getReasoningEffortConfigFromMetadata(
  metadata: KnoxChatModelMetadata,
): ReasoningEffortConfig | null {
  const reasoning = metadata.reasoning;
  if (!reasoning) {
    return null;
  }

  const allowed =
    reasoning.supported_efforts === null
      ? DEFAULT_REASONING_EFFORT_CONFIG.allowed
      : Array.isArray(reasoning.supported_efforts) &&
          reasoning.supported_efforts.length > 0
        ? reasoning.supported_efforts
        : null;

  if (!allowed) {
    // Object present but no effort selector — model may only support on/off.
    return null;
  }

  const filteredAllowed = reasoning.mandatory
    ? allowed.filter((value) => value !== "none")
    : allowed;

  const preferredDefault =
    reasoning.default_effort &&
    filteredAllowed.includes(reasoning.default_effort)
      ? reasoning.default_effort
      : filteredAllowed.includes(DEFAULT_REASONING_EFFORT_CONFIG.default)
        ? DEFAULT_REASONING_EFFORT_CONFIG.default
        : filteredAllowed[0];

  return {
    allowed: filteredAllowed,
    default: preferredDefault,
  };
}

function getSidecarConfig(modelId: string): ReasoningEffortConfig | null {
  const normalized = normalizeModelId(modelId);
  return sidecar.models[normalized] ?? null;
}

/** True only when /v1/models advertises adjustable effort (not mere reasoning). */
export function modelAdvertisesReasoningEffort(
  metadata?: KnoxChatModelMetadata | null,
  supportedParameters?: string[],
): boolean {
  if (metadata && getReasoningEffortConfigFromMetadata(metadata)) {
    return true;
  }
  return (
    modelSupportsParameter(metadata?.supported_parameters, "reasoning_effort") ||
    modelSupportsParameter(supportedParameters, "reasoning_effort")
  );
}

/**
 * Resolve effort UI config without GUI per-model allow-lists:
 * 1) live /v1/models `reasoning.supported_efforts`
 * 2) versioned sidecar JSON (only if reasoning_effort is advertised)
 * 3) default gateway enum when supported_parameters includes reasoning_effort
 *
 * Generic `reasoning` / `include_reasoning` alone must NOT show the effort UI.
 */
export function resolveReasoningEffortConfigForModel(options: {
  modelId?: string;
  provider?: string;
  supportedParameters?: string[];
  metadata?: KnoxChatModelMetadata;
}): ReasoningEffortConfig | null {
  const metadata =
    options.metadata ??
    (options.modelId ? findKnoxChatModelSync(options.modelId) : undefined);

  if (metadata) {
    const fromApi = getReasoningEffortConfigFromMetadata(metadata);
    if (fromApi) {
      return fromApi;
    }
  }

  if (!modelAdvertisesReasoningEffort(metadata, options.supportedParameters)) {
    return null;
  }

  const candidates = [
    options.modelId,
    metadata?.id,
    metadata?.root ?? undefined,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const fromSidecar = getSidecarConfig(candidate);
    if (fromSidecar) {
      return fromSidecar;
    }
  }

  return DEFAULT_REASONING_EFFORT_CONFIG;
}

export function normalizeReasoningModelId(
  value: string,
  provider?: string,
): string {
  return normalizeModelId(value, provider);
}
