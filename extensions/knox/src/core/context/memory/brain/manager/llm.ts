/** LLM-enhanced extraction, summary, importance, and post-action. */

import { BrainStore } from "../BrainStore.js";
import { KnowledgeGraph } from "../KnowledgeGraph.js";
import { LlmMemoryService } from "../LlmMemoryService.js";
import { brainRuntime } from "./state.js";
import { estimateImportance, estimateTokens } from "./helpers.js";
import { summarizeSession } from "./summarize.js";

// ── LLM-Enhanced Features ─────────────────────────────────────────────────

/**
 * LLM-powered entity extraction.
 * Falls back to rule-based if LLM unavailable.
 */
export async function llmExtractEntities(text: string, sessionId?: string) {
  const llm = brainRuntime.llm;
  if (!llm) {
    const fallback = await KnowledgeGraph.extractAndStore(text);
    return { ...fallback, llm_used: false };
  }
  return LlmMemoryService.extractEntities(llm, text, sessionId);
}

/**
 * LLM-powered session summarization.
 * Falls back to heuristic summary if LLM unavailable.
 */
export async function llmSummarizeSession(sessionId: string, detailLevel?: "brief" | "detailed") {
  const config = BrainStore.getConfig();
  const llm = brainRuntime.llm;
  if (!llm || !config.llm_summarization_enabled) {
    // Fall back to existing heuristic summarize
    const summary = await summarizeSession({ session_id: sessionId });
    return { summary, llm_used: false };
  }
  return LlmMemoryService.summarizeSession(llm, sessionId, detailLevel ?? config.preferred_summary_detail);
}

/**
 * LLM-powered importance evaluation.
 * Falls back to heuristic scoring if LLM unavailable.
 */
export async function llmEvaluateImportance(content: string, role?: string, context?: string) {
  const config = BrainStore.getConfig();
  const llm = brainRuntime.llm;
  if (!llm || !config.llm_importance_scoring_enabled) {
    const score = estimateImportance(content, role ?? "user");
    return { score, reason: "Heuristic scoring", llm_used: false };
  }
  return LlmMemoryService.evaluateImportance(llm, content, role, context);
}

/**
 * LLM-powered post-action memory update.
 * After a tool action completes, the LLM decides what should be remembered.
 */
export async function llmPostActionMemory(
  actionDescription: string,
  actionResult: string,
  sessionId?: string,
) {
  const config = BrainStore.getConfig();
  const llm = brainRuntime.llm;
  if (!llm || !config.llm_post_action_memory_enabled) {
    return { memories_created: 0, entities_created: 0, patterns_recorded: 0, llm_used: false };
  }
  return LlmMemoryService.postActionMemory(llm, actionDescription, actionResult, sessionId);
}

/**
 * Local context-budget estimate (chars ÷ 4). KnoxChat bills at the provider.
 */
export function countTokensAccurate(text: string): number {
  return estimateTokens(text);
}
