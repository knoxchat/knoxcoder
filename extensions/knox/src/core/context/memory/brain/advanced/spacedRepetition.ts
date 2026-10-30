import { BrainStore } from "../BrainStore.js";
import { Ebbinghaus } from "../Ebbinghaus.js";
import { resolveStability } from "../Forgetting.js";
import { type FsrsMemoryKind, type FsrsOutcome, type FsrsState } from "../Fsrs.js";
import { getMemoryConfig } from "../memoryConfigAccess.js";

// ══════════════════════════════════════════════════════════════════════════════
// 25. Spaced Repetition Strengthening (Ebbinghaus Curve)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Live R is power-law (MEM-12): R(t,S)=(1+F·t/S)^(-c), S = stored stability.
 * Live S updates are FSRS on use (MEM-14). Retrieve / inject must not change S.
 *
 * Optimal review intervals follow an expanding schedule:
 *   1st review: 1 day, 2nd: 3 days, 3rd: 7 days, 4th: 14 days, 5th: 30 days, etc.
 */

export interface SpacedRepetitionState {
  memory_id: number;
  category: string;
  title: string;
  importance_score: number;
  retrieval_count: number;
  last_accessed_at: string;
  current_retention: number;       // Estimated retention 0.0–1.0
  strength: number;                // Memory strength (grows with retrievals)
  next_optimal_review: string;     // ISO timestamp for next ideal review
  days_until_review: number;
  overdue: boolean;
}

export class SpacedRepetition {
  // Base intervals in days for review schedule (expanding)
  private static readonly REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60, 120, 365];

  /**
   * Calculate current retention for a memory using power-law R(t,S).
   */
  static calculateRetention(
    lastAccessedAt: string,
    retrievalCount: number,
    salience: number = 0.5,
    importance: number = 0.5,
    stability?: number | null,
    category?: string | null,
  ): number {
    return Ebbinghaus.retentionFromMemory(
      lastAccessedAt,
      retrievalCount,
      salience,
      importance,
      undefined,
      { stability, category },
    );
  }

  /**
   * Get the memory strength factor S(m) based on retrieval history.
   */
  static getStrength(
    retrievalCount: number,
    salience: number = 0.5,
    importance: number = 0.5,
  ): number {
    return Ebbinghaus.memoryStrength(retrievalCount, salience, importance);
  }

  /**
   * Calculate the next optimal review time based on current retrieval count.
   */
  static getNextReviewInterval(retrievalCount: number): number {
    const idx = Math.min(retrievalCount, SpacedRepetition.REVIEW_INTERVALS.length - 1);
    return SpacedRepetition.REVIEW_INTERVALS[idx];
  }

  /**
   * Leftover I(m,t) access boost. Not applied on retrieve — live S is FSRS on use.
   */
  static calculateBoostedImportance(
    currentImportance: number,
    retrievalCount: number,
  ): number {
    return Ebbinghaus.boostImportanceOnAccess(currentImportance, retrievalCount);
  }

  /**
   * Leftover retrieve-time boost. MEM-14: retrieved-not-used is a no-op (S, D, I stay).
   * Live strengthening is {@link SpacedRepetition.applyOnUse}.
   */
  static async boostOnRetrieval(
    memoryId: number,
    _options?: { incrementAccess?: boolean },
  ): Promise<number> {
    const db = await BrainStore.get();
    const row = (await db.get(
      "SELECT importance_score FROM brain_semantic WHERE id = ?",
      [memoryId],
    )) as { importance_score: number } | undefined;
    return row?.importance_score ?? 0;
  }

  /** Used+helpful / used+harmful FSRS write. Unused leaves the row unchanged. */
  static async applyOnUse(
    memoryId: number,
    outcome: FsrsOutcome,
    kind: FsrsMemoryKind = "semantic",
    nowMs?: number,
  ): Promise<FsrsState | null> {
    return BrainStore.applyMemoryFsrs(kind, memoryId, outcome, nowMs);
  }

  /**
   * Get memories that are due for review based on spaced repetition schedule.
   * Returns memories whose retention has dropped below the threshold.
   */
  static async getMemoriesDueForReview(
    retentionThreshold?: number,
    limit: number = 20,
  ): Promise<SpacedRepetitionState[]> {
    const cfg = getMemoryConfig();
    const threshold = retentionThreshold ?? cfg.ebbinghaus_review_threshold;
    const db = await BrainStore.get();

    // Get semantic memories with retrieval history, ordered by importance
    const rows = await db.all(
      `SELECT id, category, title, importance_score, retrieval_count, last_accessed_at, salience, stability
       FROM brain_semantic
       WHERE tier IN ('hot', 'warm', 'active')
       AND importance_score >= 0.3
       ORDER BY importance_score DESC
       LIMIT ?`,
      [limit * 5], // Fetch more, then filter by retention
    );

    const results: SpacedRepetitionState[] = [];

    for (const row of rows) {
      const r = row as any;
      const salience = r.salience ?? 0.5;
      const retention = SpacedRepetition.calculateRetention(
        r.last_accessed_at,
        r.retrieval_count,
        salience,
        r.importance_score,
        r.stability,
        r.category,
      );
      const strength = resolveStability(r.stability, r.category);
      const nextIntervalDays = SpacedRepetition.getNextReviewInterval(r.retrieval_count);
      const lastAccessed = new Date(r.last_accessed_at).getTime();
      const nextReview = new Date(lastAccessed + nextIntervalDays * 86400000);
      const daysUntilReview = (nextReview.getTime() - Date.now()) / 86400000;

      if (retention <= threshold) {
        results.push({
          memory_id: r.id,
          category: r.category,
          title: r.title,
          importance_score: r.importance_score,
          retrieval_count: r.retrieval_count,
          last_accessed_at: r.last_accessed_at,
          current_retention: retention,
          strength,
          next_optimal_review: nextReview.toISOString(),
          days_until_review: daysUntilReview,
          overdue: daysUntilReview < 0,
        });
      }
    }

    // Sort: overdue first, then by lowest retention
    results.sort((a, b) => {
      if (a.overdue && !b.overdue) return -1;
      if (!a.overdue && b.overdue) return 1;
      return a.current_retention - b.current_retention;
    });

    return results.slice(0, limit);
  }
}
