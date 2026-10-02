/** Heuristic session summarization. */

import { BrainStore } from "../BrainStore.js";
import type {
  SessionSummaryInput,
} from "../types.js";
import { emit } from "./events.js";
import { extractKeywords, invalidateMemoryCaches } from "./helpers.js";

// ── Session Summarization ──────────────────────────────────────────────────

/**
 * Generate a summary of a session's conversation.
 * This creates a compressed representation for long-term storage.
 */
export async function summarizeSession(input: SessionSummaryInput): Promise<string> {
  const history = await BrainStore.getEpisodicBySession(input.session_id, 500);
  const session = await BrainStore.getSession(input.session_id);

  if (history.length === 0) {
    return "No conversation history found for this session.";
  }

  // Build a condensed summary from the conversation
  const summaryParts: string[] = [];
  summaryParts.push(`Session: ${session?.title ?? input.session_id}`);
  summaryParts.push(`Messages: ${history.length}`);
  summaryParts.push(`Period: ${history[0].created_at} — ${history[history.length - 1].created_at}`);
  summaryParts.push("");

  // Extract key topics from high-importance messages
  const important = history
    .filter((m) => m.importance_score >= 0.6)
    .slice(0, 20);

  if (important.length > 0) {
    summaryParts.push("Key Topics:");
    for (const msg of important) {
      const preview = msg.content.substring(0, 200).replace(/\n/g, " ");
      summaryParts.push(`  [${msg.role}] ${preview}${msg.content.length > 200 ? "..." : ""}`);
    }
    summaryParts.push("");
  }

  // Gather user messages as topic indicators
  const userMessages = history.filter((m) => m.role === "user").slice(0, 30);
  if (userMessages.length > 0) {
    summaryParts.push("User Requests:");
    for (const msg of userMessages) {
      const preview = msg.content.substring(0, 150).replace(/\n/g, " ");
      summaryParts.push(`  - ${preview}${msg.content.length > 150 ? "..." : ""}`);
    }
  }

  const summary = summaryParts.join("\n");

  // Store the summary on the session
  await BrainStore.updateSession(input.session_id, { summary });
  invalidateMemoryCaches();
  emit("session:summarized", { session_id: input.session_id, summary_length: summary.length });

  // Also store as a semantic memory for cross-session recall
  await BrainStore.storeSemantic({
    category: "summary",
    title: `Session Summary: ${session?.title ?? input.session_id}`,
    content: summary,
    session_id: input.session_id,
    keywords: extractKeywords(summary),
    importance: 0.7,
  });

  return summary;
}
