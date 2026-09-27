/**
 * LLM model metadata — context lengths, max tokens, regex matchers.
 * Used by BaseLLM to autodetect model parameters.
 */

interface LlmInfo {
  model: string;
  displayName?: string;
  description?: string;
  contextLength?: number;
  maxCompletionTokens?: number;
  regex?: RegExp;
  recommendedFor?: ("chat")[];
}

/**
 * Static fallbacks for non-KnoxChat providers / offline use.
 * KnoxChat models resolve contextLength / maxTokens from /v1/models at
 * config-load and request time instead of this catalog.
 */
const allLlms: LlmInfo[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────────
  { model: "gpt-4o", contextLength: 128000, recommendedFor: ["chat"] },
  { model: "gpt-4o-mini", contextLength: 128000, recommendedFor: ["chat"] },
  { model: "o1-preview", contextLength: 128000, maxCompletionTokens: 32768, recommendedFor: ["chat"] },
  { model: "o1-mini", contextLength: 128000, maxCompletionTokens: 65536, recommendedFor: ["chat"] },
  { model: "o3-mini", contextLength: 128000, maxCompletionTokens: 65536, recommendedFor: ["chat"] },
];

export function findLlmInfo(model: string): LlmInfo | undefined {
  return allLlms.find((llm) =>
    llm.regex ? llm.regex.test(model) : llm.model === model,
  );
}
