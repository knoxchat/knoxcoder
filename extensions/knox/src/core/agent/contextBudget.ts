import type { ChatMessage } from "..";
import { totalMessageTokens } from "../compaction/tokenBudget";
import { findLlmInfo } from "../llm/llmInfo";
import {
  findKnoxChatModelSync,
  getMetadataContextLength,
} from "../llm/knoxChatModels";

/** Compact once the history reaches this fraction of the usable window. */
export const COMPACT_TRIGGER_RATIO = 0.75;
/** Used only when nothing at all is known about the model. */
export const UNKNOWN_CONTEXT_FALLBACK = 128_000;
const DEFAULT_MAX_TOKENS = 2048;
/** Fallback estimator: chars ÷ 4. Used when the routed model has no tokenizer. */
export const CHAR_RATIO_FALLBACK = 4;
/** Theorem tokenizer_margin: inflate every estimated C_* size for tokenizer drift. */
export const TOKENIZER_MARGIN_DEFAULT = 0.05;

export interface ContextWindow {
  /** Name used for local token counting. */
  model: string;
  contextLength: number;
  maxTokens: number;
  source: "llm" | "knoxchat" | "catalog" | "fallback";
}

export interface ContextUsage {
  used: number;
  limit: number;
  ratio: number;
  source: "reported" | "estimated";
}

/**
 * Resolve the active model's real window: the configured/autodetected
 * `llm.contextLength`, else KnoxChat `/v1/models` metadata, else the static
 * catalog, else a conservative 128k (never a silent 32k guess).
 */
export function resolveContextWindow(llm: unknown): ContextWindow {
  const record = (llm ?? {}) as {
    model?: string;
    contextLength?: number;
    completionOptions?: { maxTokens?: number };
  };
  const model = typeof record.model === "string" && record.model ? record.model : "";
  let contextLength = 0;
  let source: ContextWindow["source"] = "fallback";

  const direct = Number(record.contextLength);
  if (Number.isFinite(direct) && direct > 0) {
    contextLength = direct;
    source = "llm";
  } else if (model) {
    const meta = findKnoxChatModelSync(model);
    const fromMeta = meta ? getMetadataContextLength(meta) : undefined;
    if (fromMeta && Number.isFinite(fromMeta) && fromMeta > 0) {
      contextLength = fromMeta;
      source = "knoxchat";
    } else {
      const info = findLlmInfo(model)?.contextLength;
      if (info && info > 0) {
        contextLength = info;
        source = "catalog";
      }
    }
  }
  if (!contextLength) {
    contextLength = UNKNOWN_CONTEXT_FALLBACK;
  }

  const requested = Number(record.completionOptions?.maxTokens);
  const maxTokens = Math.min(
    Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_MAX_TOKENS,
    Math.floor(contextLength / 4),
  );
  return { model: model || "anthropic/claude-sonnet-5.5", contextLength, maxTokens, source };
}

/** Char-ratio token estimate (chars ÷ 4). Fallback when no model tokenizer is available. */
export function estimateCharRatioTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / CHAR_RATIO_FALLBACK);
}

/**
 * Inflate a counted size by tokenizer_margin so estimates stay on the safe
 * side of tokenizer drift. Reported provider usage must not pass through here.
 */
export function applyTokenizerMargin(
  tokens: number,
  margin: number = TOKENIZER_MARGIN_DEFAULT,
): number {
  if (!(tokens > 0) || !Number.isFinite(tokens)) {
    return 0;
  }
  const m = Number.isFinite(margin) && margin >= 0 ? margin : TOKENIZER_MARGIN_DEFAULT;
  return Math.ceil(tokens * (1 + m));
}

/**
 * Count tokens with the routed model's tokenizer (`llm.countTokens`).
 * Fallback: char-ratio estimator. Does not apply tokenizer_margin.
 */
export function countRoutedTokens(
  text: string,
  llm?: unknown,
  model?: string,
): number {
  if (!text) {
    return 0;
  }
  const handle = (llm ?? (model ? { model } : undefined)) as
    | { countTokens?: (t: string) => number; model?: string }
    | undefined;
  if (handle && typeof handle.countTokens === "function") {
    const n = Number(handle.countTokens(text));
    if (Number.isFinite(n) && n >= 0) {
      return Math.ceil(n);
    }
  }
  return estimateCharRatioTokens(text);
}

/** Routed-model count plus tokenizer_margin (MEM-69). */
export function countRoutedTokensWithMargin(
  text: string,
  options?: { llm?: unknown; model?: string; margin?: number },
): number {
  return applyTokenizerMargin(
    countRoutedTokens(text, options?.llm, options?.model),
    options?.margin,
  );
}

/**
 * Ratio of provider-reported prompt tokens to our local estimate, clamped.
 * Used to scale the local window so estimates converge on real usage.
 */
export function calibrationRatio(reported: number, estimated: number): number {
  if (!(reported > 0) || !(estimated > 0)) {
    return 1;
  }
  return Math.min(3, Math.max(0.5, reported / estimated));
}

/** Context meter numbers for the composer (reported usage wins when known). */
export function computeContextUsage(
  messages: ChatMessage[],
  window: ContextWindow,
  reportedPromptTokens?: number,
): ContextUsage {
  const limit = window.contextLength;
  const reported =
    reportedPromptTokens !== undefined && reportedPromptTokens > 0
      ? reportedPromptTokens
      : undefined;
  const estimated = applyTokenizerMargin(
    totalMessageTokens(messages, window.model),
  );
  const used = reported ?? estimated;
  return {
    used,
    limit,
    ratio: Math.min(1, used / limit),
    source: reported !== undefined ? "reported" : "estimated",
  };
}
