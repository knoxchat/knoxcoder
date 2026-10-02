/** Conversation tracking and session history. */

import { BrainStore } from "../BrainStore.js";
import { autoExtract } from "./extraction.js";
import { estimateImportance, estimateTokens } from "./helpers.js";
import { getWorkingMemory } from "./runtime.js";

// ── Episodic Memory (Conversation Tracking) ────────────────────────────────

/**
 * Record a conversation turn in episodic memory.
 * Called automatically during chat to build the memory trace.
 */
export async function recordMessage(
  sessionId: string,
  role: string,
  content: string,
  options?: {
    type?: "user_message" | "assistant_message" | "tool_call" | "tool_result" | "system";
    tokenCount?: number;
    importance?: number;
    metadata?: Record<string, any>;
  },
): Promise<number> {
  const importance =
    options?.importance ?? estimateImportance(content, role);
  const id = await BrainStore.addEpisodic(
    sessionId,
    options?.type ?? (role === "user" ? "user_message" : "assistant_message"),
    role,
    content,
    options?.tokenCount ?? estimateTokens(content),
    importance,
    options?.metadata ?? {},
  );

  // Passive learning: extract facts/entities and detect topic shifts from
  // every recorded turn. Fire-and-forget — autoExtract respects the
  // auto_extract_enabled config and must never block conversation flow.
  if (role === "user" || role === "assistant") {
    autoExtract(content, role, sessionId, id).catch(() => {});

    // Keep working memory (the "currently thinking about" buffer) fresh:
    // gate attention toward this turn, then slot it in. Long content is
    // truncated — working memory holds gist, not transcripts.
    try {
      const wm = getWorkingMemory();
      wm.attendTo(content);
      wm.add({
        id: `episodic:${id}`,
        content: content.length > 500 ? `${content.slice(0, 500)}…` : content,
        source: role === "user" ? "user" : "episodic",
        relevance: Math.max(0.3, Math.min(1, importance)),
        metadata: { session_id: sessionId, role },
      });
    } catch {}
  }

  return id;
}

/**
 * Get conversation history for a session (episodic only — legacy).
 */
export async function getSessionHistory(sessionId: string, limit?: number) {
  return BrainStore.getEpisodicBySession(sessionId, limit);
}

/**
 * Full session history: episodic + semantic + topics + metadata (IMP-22).
 */
export async function getSessionHistoryFull(
  sessionId: string,
  options?: { episodicLimit?: number; semanticLimit?: number },
): Promise<import("../types.js").SessionHistoryResult> {
  const episodicLimit = options?.episodicLimit ?? 500;
  const semanticLimit = options?.semanticLimit ?? 200;

  const [session, episodic, semantic, topics, token_estimate] = await Promise.all([
    BrainStore.getSession(sessionId),
    BrainStore.getEpisodicBySession(sessionId, episodicLimit),
    BrainStore.getSemanticBySession(sessionId, semanticLimit),
    BrainStore.getSessionTopics(sessionId),
    BrainStore.estimateSessionTokens(sessionId),
  ]);

  return {
    session,
    episodic,
    semantic,
    topics,
    token_estimate,
    message_count: session?.message_count ?? episodic.length,
  };
}
