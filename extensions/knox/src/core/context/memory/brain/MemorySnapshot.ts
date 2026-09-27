import { ContextBuilder } from "./ContextBuilder.js";
import { BrainStore } from "./BrainStore.js";
import type { BuildContextInput } from "./types.js";

/**
 * MemorySnapshot — Frozen snapshot pattern for memory context injection.
 *
 * Injects memory context into the system prompt at session start, immutable mid-session.
 * This preserves the LLM's prefix/KV cache (latency + cost savings).
 *
 * Architecture:
 * - On session start: build a comprehensive context snapshot from all memory types
 * - Freeze the snapshot: no changes to injected context during the session
 * - DB writes still happen live (new memories, episodic tracking)
 * - On next session: snapshot refreshes with latest data
 *
 * Benefits:
 * - Consistent context throughout a session (no mid-turn context shifts)
 * - LLM prefix cache reuse (significant latency reduction on long sessions)
 * - Lower API costs (fewer context-building calls)
 * - Deterministic behavior within a session
 */

export interface Snapshot {
  sessionId: string;
  context: string;
  tokenCount: number;
  createdAt: number;
  sources: {
    semanticCount: number;
    episodicCount: number;
    entityCount: number;
    procedureCount: number;
    patternCount: number;
  };
}

export class MemorySnapshot {
  // One snapshot per session
  private static snapshots: Map<string, Snapshot> = new Map();

  // Whether to auto-refresh on next access (triggered by significant changes)
  private static refreshFlags: Map<string, boolean> = new Map();

  // Change counter per session (for refresh threshold)
  private static changeCounters: Map<string, number> = new Map();
  private static readonly REFRESH_THRESHOLD = 20; // Refresh after N significant changes

  // ── Snapshot Lifecycle ─────────────────────────────────────────────────────

  /**
   * Get or create the frozen snapshot for a session.
   * Returns cached snapshot if available; builds a fresh one on first call.
   */
  static async getSnapshot(
    sessionId: string,
    maxTokens: number = 4000,
    query?: string,
  ): Promise<Snapshot> {
    // Return cached snapshot if valid
    const existing = MemorySnapshot.snapshots.get(sessionId);
    if (existing && !MemorySnapshot.refreshFlags.get(sessionId)) {
      return existing;
    }

    // Build fresh snapshot
    const snapshot = await MemorySnapshot.buildSnapshot(sessionId, maxTokens, query);
    MemorySnapshot.snapshots.set(sessionId, snapshot);
    MemorySnapshot.refreshFlags.set(sessionId, false);
    MemorySnapshot.changeCounters.set(sessionId, 0);

    return snapshot;
  }

  /**
   * Build a fresh snapshot for the session.
   */
  private static async buildSnapshot(
    sessionId: string,
    maxTokens: number,
    query?: string,
  ): Promise<Snapshot> {
    // Use ContextBuilder to assemble the best context
    const input: BuildContextInput = {
      message: query ?? "session context overview",
      session_id: sessionId,
      max_tokens: maxTokens,
      include_graph: true,
      include_procedures: true,
      include_patterns: true,
    };

    const context = await ContextBuilder.build(input);

    // Count sources for diagnostics
    const semanticCount = (context.match(/\[(?:fact|preference|decision|summary|insight|code_pattern|error_fix|project_context|workflow)\]/g) ?? []).length;
    const episodicCount = (context.match(/\[Session [a-f0-9]/g) ?? []).length;
    const entityCount = (context.match(/\[(?:person|organization|technology|concept|project|file|function|class)\]/g) ?? []).length;
    const procedureCount = (context.match(/\[(?:general|coding|debugging)\]/g) ?? []).length;
    const patternCount = (context.match(/Suggested Approaches/g) ?? []).length;

    return {
      sessionId,
      context,
      tokenCount: Math.ceil(context.length / 4),
      createdAt: Date.now(),
      sources: {
        semanticCount,
        episodicCount,
        entityCount,
        procedureCount,
        patternCount,
      },
    };
  }

  /**
   * Signal that significant changes have occurred.
   * After enough changes, the snapshot will be refreshed on next access.
   */
  static recordChange(sessionId: string): void {
    const count = (MemorySnapshot.changeCounters.get(sessionId) ?? 0) + 1;
    MemorySnapshot.changeCounters.set(sessionId, count);

    if (count >= MemorySnapshot.REFRESH_THRESHOLD) {
      MemorySnapshot.refreshFlags.set(sessionId, true);
    }
  }

  /**
   * Force refresh the snapshot for a session on next access.
   */
  static invalidate(sessionId: string): void {
    MemorySnapshot.refreshFlags.set(sessionId, true);
  }

  /**
   * Invalidate all snapshots (e.g., after consolidation or import).
   */
  static invalidateAll(): void {
    for (const sessionId of MemorySnapshot.snapshots.keys()) {
      MemorySnapshot.refreshFlags.set(sessionId, true);
    }
  }

  /**
   * Remove snapshot for a closed session.
   */
  static remove(sessionId: string): void {
    MemorySnapshot.snapshots.delete(sessionId);
    MemorySnapshot.refreshFlags.delete(sessionId);
    MemorySnapshot.changeCounters.delete(sessionId);
  }

  /**
   * Get snapshot stats for all active sessions.
   */
  static getStats(): Array<{
    sessionId: string;
    tokenCount: number;
    ageMs: number;
    changesSinceSnapshot: number;
    needsRefresh: boolean;
  }> {
    const now = Date.now();
    return Array.from(MemorySnapshot.snapshots.entries()).map(([id, snap]) => ({
      sessionId: id,
      tokenCount: snap.tokenCount,
      ageMs: now - snap.createdAt,
      changesSinceSnapshot: MemorySnapshot.changeCounters.get(id) ?? 0,
      needsRefresh: MemorySnapshot.refreshFlags.get(id) ?? false,
    }));
  }

  /**
   * Clear all snapshots (cleanup).
   */
  static clear(): void {
    MemorySnapshot.snapshots.clear();
    MemorySnapshot.refreshFlags.clear();
    MemorySnapshot.changeCounters.clear();
  }
}
