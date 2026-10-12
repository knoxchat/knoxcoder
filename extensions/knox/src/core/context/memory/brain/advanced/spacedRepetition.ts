import { BrainStore } from "../BrainStore.js";
import { Ebbinghaus } from "../Ebbinghaus.js";
import { getMemoryConfig } from "../memoryConfigAccess.js";

// ══════════════════════════════════════════════════════════════════════════════
// 25. Spaced Repetition Strengthening (Ebbinghaus Curve)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Implements the Ebbinghaus forgetting curve for memory strengthening (Part IV):
 *
 *   R(t) = R₀ · e^(-λt / S(m))
 *   I(m,t) = I₀ · R(t) · (1 + α · access_count)
 *   S_new(m) = S_old(m) + β · 1[accessed]
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
   * Calculate current retention for a memory using the Ebbinghaus curve.
   */
  static calculateRetention(
    lastAccessedAt: string,
    retrievalCount: number,
    salience: number = 0.5,
    importance: number = 0.5,
  ): number {
    return Ebbinghaus.retentionFromMemory(lastAccessedAt, retrievalCount, salience, importance);
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
   * Boost importance when a memory is retrieved (spaced repetition strengthening).
   * Uses theorem: I(m,t) = I₀ · (1 + α · access_count) after fresh access (R≈1).
   */
  static calculateBoostedImportance(
    currentImportance: number,
    retrievalCount: number,
  ): number {
    return Ebbinghaus.boostImportanceOnAccess(currentImportance, retrievalCount);
  }

  /**
   * Apply spaced repetition boost to a memory on retrieval.
   * Updates importance_score; optionally increments retrieval_count + last_accessed.
   *
   * @param incrementAccess — false when caller already incremented retrieval_count (e.g. recall path)
   */
  static async boostOnRetrieval(
    memoryId: number,
    options?: { incrementAccess?: boolean },
  ): Promise<number> {
    const db = await BrainStore.get();
    const row = (await db.get(
      "SELECT importance_score, retrieval_count, salience FROM brain_semantic WHERE id = ?",
      [memoryId],
    )) as { importance_score: number; retrieval_count: number; salience?: number } | undefined;
    if (!row) return 0;

    const increment = options?.incrementAccess !== false;
    const newCount = increment ? (row.retrieval_count ?? 0) + 1 : (row.retrieval_count ?? 0);

    const newImportance = SpacedRepetition.calculateBoostedImportance(
      row.importance_score,
      newCount,
    );

    if (increment) {
      await db.run(
        `UPDATE brain_semantic SET importance_score = ?, retrieval_count = ?, last_accessed_at = datetime('now') WHERE id = ?`,
        [newImportance, newCount, memoryId],
      );
    } else {
      await db.run(
        "UPDATE brain_semantic SET importance_score = ? WHERE id = ?",
        [newImportance, memoryId],
      );
    }

    return newImportance;
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
      `SELECT id, category, title, importance_score, retrieval_count, last_accessed_at, salience
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
      );
      const strength = SpacedRepetition.getStrength(r.retrieval_count, salience, r.importance_score);
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
