import { BrainStore } from "../BrainStore.js";

// ══════════════════════════════════════════════════════════════════════════════
// 23. 5-Tier Memory Hierarchy
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Expanded 5-tier hierarchy with per-level TTL:
 *
 *   1. "active"   — currently in-use, always fresh (TTL: session lifetime)
 *   2. "hot"      — recent, high-importance (TTL: 24h before demotion check)
 *   3. "warm"     — aging, moderate importance (TTL: 7d before demotion)
 *   4. "cold"     — archived, compressed (TTL: 90d before prune)
 *   5. "frozen"   — deep archive, heavily compressed, rarely touched (TTL: 365d)
 *
 * The "active" and "frozen" tiers extend the existing hot/warm/cold model.
 * "active" captures memories being actively used in the current session.
 * "frozen" provides a long-term archive before final pruning.
 */

export type ExtendedMemoryTier = "active" | "hot" | "warm" | "cold" | "frozen";

export interface TierConfig {
  tier: ExtendedMemoryTier;
  max_age_hours: number;          // Max time before demotion check
  importance_threshold: number;   // Below this → demote
  retrieval_threshold: number;    // Below this retrieval count → demote
  compress: boolean;              // Whether to compress content at this tier
}

const DEFAULT_TIER_CONFIGS: TierConfig[] = [
  { tier: "active",  max_age_hours: 0,        importance_threshold: 0,   retrieval_threshold: 0,  compress: false },
  { tier: "hot",     max_age_hours: 24,       importance_threshold: 0.7, retrieval_threshold: 0,  compress: false },
  { tier: "warm",    max_age_hours: 168,      importance_threshold: 0.5, retrieval_threshold: 2,  compress: false },  // 7 days
  { tier: "cold",    max_age_hours: 2160,     importance_threshold: 0.3, retrieval_threshold: 3,  compress: true },   // 90 days
  { tier: "frozen",  max_age_hours: 8760,     importance_threshold: 0.1, retrieval_threshold: 5,  compress: true },   // 365 days
];

export class FiveTierHierarchy {
  private static configs: TierConfig[] = [...DEFAULT_TIER_CONFIGS];

  static getConfigs(): TierConfig[] {
    return FiveTierHierarchy.configs.map((c) => ({ ...c }));
  }

  static updateConfig(tier: ExtendedMemoryTier, update: Partial<Omit<TierConfig, "tier">>): void {
    const cfg = FiveTierHierarchy.configs.find((c) => c.tier === tier);
    if (cfg) Object.assign(cfg, update);
  }

  /**
   * Run the 5-tier consolidation cycle.
   * Processes each tier boundary: active→hot→warm→cold→frozen→prune.
   *
   * NOTE: Because the DB schema uses TEXT tier column compatible with any value,
   * "active" and "frozen" are stored directly in the existing tier column.
   */
  static async consolidate(): Promise<{
    promoted: number;
    demoted: number;
    pruned: number;
    compressed: number;
  }> {
    const db = await BrainStore.get();
    const result = { promoted: 0, demoted: 0, pruned: 0, compressed: 0 };

    // ── Demotions (top down) ──────────────────────────────────────────────

    // Active → Hot: anything in active tier not accessed recently
    const activeToHot = await db.run(
      `UPDATE brain_episodic SET tier = 'hot'
       WHERE tier = 'active'
       AND created_at < datetime('now', '-1 hours')`,
    );
    result.demoted += activeToHot.changes ?? 0;

    const semActiveToHot = await db.run(
      `UPDATE brain_semantic SET tier = 'hot'
       WHERE tier = 'active'
       AND last_accessed_at < datetime('now', '-1 hours')`,
    );
    result.demoted += semActiveToHot.changes ?? 0;

    // Hot → Warm
    const hotCfg = FiveTierHierarchy.configs.find((c) => c.tier === "hot")!;
    const hotHours = `-${hotCfg.max_age_hours} hours`;
    const epHotToWarm = await db.run(
      `UPDATE brain_episodic SET tier = 'warm'
       WHERE tier = 'hot' AND importance_score < ?
       AND created_at < datetime('now', ?)`,
      [hotCfg.importance_threshold, hotHours],
    );
    result.demoted += epHotToWarm.changes ?? 0;

    const semHotToWarm = await db.run(
      `UPDATE brain_semantic SET tier = 'warm'
       WHERE tier = 'hot' AND importance_score < ?
       AND last_accessed_at < datetime('now', ?)`,
      [hotCfg.importance_threshold, hotHours],
    );
    result.demoted += semHotToWarm.changes ?? 0;

    // Warm → Cold
    const warmCfg = FiveTierHierarchy.configs.find((c) => c.tier === "warm")!;
    const warmHours = `-${warmCfg.max_age_hours} hours`;
    const epWarmToCold = await db.run(
      `UPDATE brain_episodic SET tier = 'cold'
       WHERE tier = 'warm' AND importance_score < ?
       AND created_at < datetime('now', ?)`,
      [warmCfg.importance_threshold, warmHours],
    );
    result.demoted += epWarmToCold.changes ?? 0;

    const semWarmToCold = await db.run(
      `UPDATE brain_semantic SET tier = 'cold'
       WHERE tier = 'warm' AND importance_score < ? AND retrieval_count < ?
       AND last_accessed_at < datetime('now', ?)`,
      [warmCfg.importance_threshold, warmCfg.retrieval_threshold, warmHours],
    );
    result.demoted += semWarmToCold.changes ?? 0;

    // Cold → Frozen
    const coldCfg = FiveTierHierarchy.configs.find((c) => c.tier === "cold")!;
    const coldHours = `-${coldCfg.max_age_hours} hours`;
    const epColdToFrozen = await db.run(
      `UPDATE brain_episodic SET tier = 'frozen'
       WHERE tier = 'cold' AND importance_score < ?
       AND created_at < datetime('now', ?)`,
      [coldCfg.importance_threshold, coldHours],
    );
    result.demoted += epColdToFrozen.changes ?? 0;

    const semColdToFrozen = await db.run(
      `UPDATE brain_semantic SET tier = 'frozen'
       WHERE tier = 'cold' AND importance_score < ? AND retrieval_count < ?
       AND last_accessed_at < datetime('now', ?)`,
      [coldCfg.importance_threshold, coldCfg.retrieval_threshold, coldHours],
    );
    result.demoted += semColdToFrozen.changes ?? 0;

    // Frozen → Prune
    const frozenCfg = FiveTierHierarchy.configs.find((c) => c.tier === "frozen")!;
    const frozenHours = `-${frozenCfg.max_age_hours} hours`;
    const prunedEp = await db.run(
      `DELETE FROM brain_episodic
       WHERE tier = 'frozen' AND importance_score < ?
       AND created_at < datetime('now', ?)`,
      [frozenCfg.importance_threshold, frozenHours],
    );
    result.pruned += prunedEp.changes ?? 0;

    const prunedSem = await db.run(
      `DELETE FROM brain_semantic
       WHERE tier = 'frozen' AND importance_score < ? AND retrieval_count < ?
       AND last_accessed_at < datetime('now', ?)`,
      [frozenCfg.importance_threshold, frozenCfg.retrieval_threshold, frozenHours],
    );
    result.pruned += prunedSem.changes ?? 0;

    // ── Promotions (bottom up) ────────────────────────────────────────────

    // Frozen → Cold: if accessed recently
    const frozenToCold = await db.run(
      `UPDATE brain_semantic SET tier = 'cold'
       WHERE tier = 'frozen' AND last_accessed_at > datetime('now', '-7 days')`,
    );
    result.promoted += frozenToCold.changes ?? 0;

    // Cold → Warm: if retrieval count rising
    const coldToWarm = await db.run(
      `UPDATE brain_semantic SET tier = 'warm'
       WHERE tier = 'cold' AND retrieval_count >= 3
       AND last_accessed_at > datetime('now', '-14 days')`,
    );
    result.promoted += coldToWarm.changes ?? 0;

    // Warm → Hot: if frequently accessed
    const warmToHot = await db.run(
      `UPDATE brain_semantic SET tier = 'hot'
       WHERE tier = 'warm' AND retrieval_count >= 5
       AND last_accessed_at > datetime('now', '-3 days')`,
    );
    result.promoted += warmToHot.changes ?? 0;

    // ── Compression for cold/frozen ───────────────────────────────────────
    const compressedCount = await BrainStore.compressColdTier();
    // Also compress frozen tier
    const frozenRows = await db.all(
      `SELECT id, content FROM brain_semantic WHERE tier = 'frozen' AND content NOT LIKE 'z:%' AND length(content) > 200`,
    );
    for (const row of frozenRows) {
      const r = row as any;
      const compressed = BrainStore.compressContent(r.content);
      if (compressed !== r.content) {
        await db.run("UPDATE brain_semantic SET content = ? WHERE id = ?", [compressed, r.id]);
        result.compressed++;
      }
    }
    const frozenEpRows = await db.all(
      `SELECT id, content FROM brain_episodic WHERE tier = 'frozen' AND content NOT LIKE 'z:%' AND length(content) > 200`,
    );
    for (const row of frozenEpRows) {
      const r = row as any;
      const compressed = BrainStore.compressContent(r.content);
      if (compressed !== r.content) {
        await db.run("UPDATE brain_episodic SET content = ? WHERE id = ?", [compressed, r.id]);
        result.compressed++;
      }
    }
    result.compressed += compressedCount;

    // Decompress promoted memories
    const hotCompressed = await db.all(
      `SELECT id, content FROM brain_semantic WHERE tier IN ('hot', 'active') AND content LIKE 'z:%'`,
    );
    for (const row of hotCompressed) {
      const r = row as any;
      const decompressed = BrainStore.decompressContent(r.content);
      if (decompressed !== r.content) {
        await db.run("UPDATE brain_semantic SET content = ? WHERE id = ?", [decompressed, r.id]);
      }
    }

    return result;
  }

  /**
   * Get tier distribution counts.
   */
  static async getTierDistribution(): Promise<Record<ExtendedMemoryTier, { semantic: number; episodic: number }>> {
    const db = await BrainStore.get();

    const semRows = await db.all(
      `SELECT tier, COUNT(*) as c FROM brain_semantic GROUP BY tier`,
    );
    const epRows = await db.all(
      `SELECT tier, COUNT(*) as c FROM brain_episodic GROUP BY tier`,
    );

    const dist: Record<string, { semantic: number; episodic: number }> = {
      active: { semantic: 0, episodic: 0 },
      hot: { semantic: 0, episodic: 0 },
      warm: { semantic: 0, episodic: 0 },
      cold: { semantic: 0, episodic: 0 },
      frozen: { semantic: 0, episodic: 0 },
    };

    for (const r of semRows) {
      const tier = (r as any).tier;
      if (dist[tier]) dist[tier].semantic = (r as any).c;
    }
    for (const r of epRows) {
      const tier = (r as any).tier;
      if (dist[tier]) dist[tier].episodic = (r as any).c;
    }

    return dist as Record<ExtendedMemoryTier, { semantic: number; episodic: number }>;
  }
}
