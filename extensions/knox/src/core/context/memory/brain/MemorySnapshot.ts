import { MEMORY_POINTER_LINE } from "./injectFormat.js";

/**
 * MemorySnapshot — session-start pointer (MEM-63).
 *
 * The snapshot used to freeze a built memory context into the system prompt at
 * session start. Retrieved memory is now a quoted `[memory]` block in a
 * user-role message built per turn, so a snapshot carries no memory content:
 * only a static pointer line that is identical for every session (so the
 * prefix / KV cache still holds). Memory text must never enter the system
 * message.
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
   * Build the snapshot: the static pointer line, no retrieved memory.
   */
  private static async buildSnapshot(
    sessionId: string,
    _maxTokens: number,
    _query?: string,
  ): Promise<Snapshot> {
    return {
      sessionId,
      context: MEMORY_POINTER_LINE,
      tokenCount: Math.ceil(MEMORY_POINTER_LINE.length / 4),
      createdAt: Date.now(),
      sources: {
        semanticCount: 0,
        episodicCount: 0,
        entityCount: 0,
        procedureCount: 0,
        patternCount: 0,
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
