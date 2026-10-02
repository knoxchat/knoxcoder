/** Session tracking, listing, close, and stale cleanup. */

import { BrainStore } from "../BrainStore.js";
import { AutoMemory } from "../AutoMemory.js";
import { MemorySnapshot } from "../MemorySnapshot.js";
import type {
  BrainSession,
} from "../types.js";
import { brainRuntime } from "./state.js";
import { emit } from "./events.js";
import { llmSummarizeSession } from "./llm.js";
import { persistWorkingMemory, switchWorkingMemorySession } from "./runtime.js";
import { summarizeSession } from "./summarize.js";

// ── Session Management ─────────────────────────────────────────────────────

/**
 * Register or update a conversation session.
 */
export async function trackSession(sessionId: string, title: string, workspaceDir: string): Promise<void> {
  await switchWorkingMemorySession(sessionId);
  brainRuntime.activeSessionId = sessionId;

  const existing = await BrainStore.getSession(sessionId);
  if (existing) {
    await BrainStore.updateSession(sessionId, { title, is_active: true });
    await BrainStore.ensureSessionProjectId(sessionId, workspaceDir);
  } else {
    await BrainStore.createSession(sessionId, title, workspaceDir);
  }
}

/**
 * List all tracked sessions.
 */
export async function listSessions(limit?: number, workspaceDir?: string): Promise<BrainSession[]> {
  return BrainStore.listSessions(limit, workspaceDir);
}

/**
 * Get a specific session with its details.
 */
export async function getSession(sessionId: string): Promise<BrainSession | null> {
  return BrainStore.getSession(sessionId);
}

/**
 * Delete a session and all its episodic memories.
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  // Auto-summarize before deletion if not already summarized
  const session = await BrainStore.getSession(sessionId);
  if (session && !session.summary) {
    try {
      await llmSummarizeSession(sessionId);
    } catch {
      // Still delete even if summarization fails
    }
  }
  const result = await BrainStore.deleteSession(sessionId);
  if (result) emit("session:deleted", { session_id: sessionId });
  return result;
}

/**
 * Close a session (mark as inactive) and auto-summarize.
 * This triggers LLM summarization if available, or heuristic fallback.
 */
export async function closeSession(sessionId: string, options?: { persistWorkingMemory?: boolean }): Promise<string> {
  const session = await BrainStore.getSession(sessionId);
  if (!session) return `Session "${sessionId}" not found.`;

  // Flush remaining buffered messages as a final topic segment
  AutoMemory.flushSessionTopics(sessionId, session.message_count ?? 0).catch(() => {});

  // P4.1 — Persist working memory state before closing. Skipped for
  // background stale-session closes: the working memory singleton holds the
  // *current* session's state, not the stale session's.
  if (options?.persistWorkingMemory !== false) {
    await persistWorkingMemory(sessionId);
  }

  if (brainRuntime.activeSessionId === sessionId) {
    brainRuntime.activeSessionId = null;
  }
  if (brainRuntime.workingMemSessionId === sessionId) {
    brainRuntime.workingMem = null;
    brainRuntime.workingMemSessionId = null;
  }

  // Auto-summarize on close (when enabled)
  let summary = session.summary ?? "";
  const config = BrainStore.getConfig();
  if (!summary && config.auto_summarize) {
    try {
      const result = await llmSummarizeSession(sessionId);
      summary = result.summary;
    } catch {
      summary = await summarizeSession({ session_id: sessionId });
    }
  } else if (!summary && !config.auto_summarize) {
    summary = session.summary ?? "";
  }

  await BrainStore.updateSession(sessionId, { is_active: false });

  // Clear snapshot cache for closed session
  MemorySnapshot.remove(sessionId);

  emit("session:updated", { session_id: sessionId, is_active: false, auto_summarized: true });
  return `Session "${session.title}" closed and summarized.`;
}

/**
 * Close sessions that have been idle longer than `maxIdleHours`.
 * Called by the auto-consolidation scheduler so sessions abandoned by the
 * UI still get topic-flushed, summarized, and their working memory persisted.
 */
export async function closeStaleSessions(maxIdleHours: number = 24): Promise<number> {
  const db = await BrainStore.get();
  const rows = await db.all(
    `SELECT id FROM brain_sessions
     WHERE is_active = 1
       AND updated_at < datetime('now', ?)
     ORDER BY updated_at ASC
     LIMIT 10`,
    [`-${Math.max(1, Math.floor(maxIdleHours))} hours`],
  );

  let closed = 0;
  for (const row of rows) {
    try {
      await closeSession((row as any).id, { persistWorkingMemory: false });
      closed++;
    } catch {
      // Best-effort — skip sessions that fail to close
    }
  }
  return closed;
}
