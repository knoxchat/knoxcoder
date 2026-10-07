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
  { model: "gpt-6.1-sol", contextLength: 1050000, maxCompletionTokens: 128000, recommendedFor: ["chat"] },
  { model: "gpt-6-luna", contextLength: 1050000, maxCompletionTokens: 128000, recommendedFor: ["chat"] },
  // ── Anthropic ───────────────────────────────────────────────────────────
  { model: "claude-sonnet-5.5", contextLength: 1000000, maxCompletionTokens: 128000, recommendedFor: ["chat"] },
  { model: "claude-opus-5.5", contextLength: 1000000, maxCompletionTokens: 128000, recommendedFor: ["chat"] },
  { model: "claude-haiku-4.5", contextLength: 200000, maxCompletionTokens: 64000, recommendedFor: ["chat"] },
];

export function findLlmInfo(model: string): LlmInfo | undefined {
  return allLlms.find((llm) =>
    llm.regex ? llm.regex.test(model) : llm.model === model,
  );
}
