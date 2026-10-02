/** Passive auto-memory extraction. */

import { BrainStore } from "../BrainStore.js";
import { AutoMemory } from "../AutoMemory.js";
import { emit } from "./events.js";
import { llmExtractEntities } from "./llm.js";
import { brainRuntime } from "./state.js";

// ── Auto-Memory Extraction ─────────────────────────────────────────────────

/**
 * Automatically extract memories from a message.
 * Called during conversation tracking for passive knowledge building.
 * Triggers LLM-enhanced extraction periodically when available.
 * Also runs topic shift detection on each message.
 */
export async function autoExtract(
  content: string,
  role: string,
  sessionId: string,
  messageIndex?: number,
): Promise<{ semantic_count: number; entity_count: number }> {
  const config = BrainStore.getConfig();
  if (!config.auto_extract_enabled) {
    return { semantic_count: 0, entity_count: 0 };
  }
  const result = await AutoMemory.extract(content, role, sessionId);
  if (result.semantic_count > 0 || result.entity_count > 0) {
    emit("auto_extract:completed", { session_id: sessionId, semantic_count: result.semantic_count, entity_count: result.entity_count });
  }

  // Trigger LLM-enhanced extraction periodically for substantial messages
  if (result.should_llm_extract && config.llm_entity_extraction_enabled && brainRuntime.llm) {
    // Fire-and-forget: don't block the main flow
    llmExtractEntities(content, sessionId).catch(() => {
      // Silently ignore LLM extraction failures
    });
  }

  // Auto-detect topic shifts (fire-and-forget)
  if (messageIndex !== undefined) {
    AutoMemory.detectTopicShift(sessionId, role, content, messageIndex)
      .then((topic) => {
        if (topic) {
          emit("topic:detected", { session_id: sessionId, topic: topic.topic, keywords: topic.keywords, confidence: topic.confidence });
        }
      })
      .catch(() => {});
  }

  return { semantic_count: result.semantic_count, entity_count: result.entity_count };
}
