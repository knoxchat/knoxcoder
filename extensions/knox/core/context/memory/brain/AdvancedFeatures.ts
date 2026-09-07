/**
 * AdvancedFeatures — Tier D Advanced capabilities.
 *
 * 22. Related Sessions Discovery — Find sessions sharing entities/topics
 * 23. 5-Tier Memory Hierarchy — Expand hot/warm/cold to 5 levels with per-level TTL
 * 24. Root Cause Analysis — Deeper diagnosis in health checks
 * 25. Spaced Repetition Strengthening — Ebbinghaus curve with repetition boosting
 * 26. LRU Cache Layer — In-memory cache with hit/miss stats
 * 27. Performance Metrics Storage — Persist metrics to SQLite for trend analysis
 */

import { BrainStore } from "./BrainStore.js";
import { Ebbinghaus } from "./Ebbinghaus.js";
import { getMemoryConfig } from "./memoryConfigAccess.js";
import type {
  BrainSession,
  SessionTopic,
  SemanticMemory,
  HealthStatus,
} from "./types.js";
import type {
  MetricsSummary,
  OperationMetric,
} from "./PerformanceMonitor.js";

// ══════════════════════════════════════════════════════════════════════════════
// 22. Related Sessions Discovery
// ══════════════════════════════════════════════════════════════════════════════

export interface RelatedSession {
  session: BrainSession;
  shared_entities: string[];
  shared_topics: string[];
  shared_keywords: string[];
  relevance_score: number;
}

export class SessionDiscovery {
  /**
   * Find sessions related to a given session by shared entities, topics,
   * keywords, and semantic connections.
   */
  static async findRelatedSessions(
    sessionId: string,
    limit: number = 10,
  ): Promise<RelatedSession[]> {
    const db = await BrainStore.get();

    // 1. Get entities mentioned in this session's semantic memories
    const sessionEntities = await db.all(
      `SELECT DISTINCT e.name FROM brain_entities e
       INNER JOIN brain_semantic s ON s.source_session_id = ?
       WHERE LOWER(s.content) LIKE '%' || LOWER(e.name) || '%'
         OR LOWER(s.title) LIKE '%' || LOWER(e.name) || '%'`,
      [sessionId],
    );
    const entityNames = sessionEntities.map((r: any) => r.name as string);

    // 2. Get topics for this session
    const topics = await BrainStore.getSessionTopics(sessionId);
    const topicKeywords = topics.flatMap((t) =>
      t.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
    );
    const topicNames = topics.map((t) => t.topic.toLowerCase());

    // 3. Get keywords from this session's semantic memories
    const sessionSemantics = await db.all(
      `SELECT keywords FROM brain_semantic WHERE source_session_id = ? AND keywords != ''`,
      [sessionId],
    );
    const semKeywords = sessionSemantics.flatMap((r: any) =>
      (r.keywords as string).split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
    );

    // Combine all signals
    const allKeywords = new Set([...topicKeywords, ...semKeywords]);

    // 4. Get all other sessions
    const otherSessions = await db.all(
      `SELECT * FROM brain_sessions WHERE id != ? ORDER BY updated_at DESC LIMIT 100`,
      [sessionId],
    );

    const candidates: RelatedSession[] = [];

    for (const sess of otherSessions) {
      const s = sess as any;
      const sharedEntities: string[] = [];
      const sharedTopics: string[] = [];
      const sharedKeywords: string[] = [];
      let score = 0;

      // Check entity overlap via semantic memories
      if (entityNames.length > 0) {
        const otherSemantics = await db.all(
          `SELECT title, content FROM brain_semantic WHERE source_session_id = ?`,
          [s.id],
        );
        for (const entity of entityNames) {
          const lower = entity.toLowerCase();
          for (const sem of otherSemantics) {
            const text = `${(sem as any).title} ${(sem as any).content}`.toLowerCase();
            if (text.includes(lower)) {
              sharedEntities.push(entity);
              break;
            }
          }
        }
        score += sharedEntities.length * 3; // Entity matches weigh heavily
      }

      // Check topic overlap
      const otherTopics = await BrainStore.getSessionTopics(s.id);
      for (const ot of otherTopics) {
        const otName = ot.topic.toLowerCase();
        if (topicNames.includes(otName)) {
          sharedTopics.push(ot.topic);
          score += 2;
        }
        // Check keyword overlap in topics
        const otKeywords = ot.keywords.split(",").map((k: string) => k.trim().toLowerCase());
        for (const kw of otKeywords) {
          if (kw && allKeywords.has(kw)) {
            sharedKeywords.push(kw);
            score += 1;
          }
        }
      }

      // Check keyword overlap in semantic memories
      const otherKw = await db.all(
        `SELECT keywords FROM brain_semantic WHERE source_session_id = ? AND keywords != ''`,
        [s.id],
      );
      for (const row of otherKw) {
        const kws = (row as any).keywords.split(",").map((k: string) => k.trim().toLowerCase());
        for (const kw of kws) {
          if (kw && allKeywords.has(kw) && !sharedKeywords.includes(kw)) {
            sharedKeywords.push(kw);
            score += 0.5;
          }
        }
      }

      // Workspace bonus: same workspace = +1
      if (s.workspace_directory && s.workspace_directory === (await db.get(
        `SELECT workspace_directory FROM brain_sessions WHERE id = ?`, [sessionId],
      ) as any)?.workspace_directory) {
        score += 1;
      }

      if (score > 0) {
        candidates.push({
          session: {
            id: s.id,
            title: s.title,
            workspace_directory: s.workspace_directory,
            project_id: s.project_id ?? "",
            created_at: s.created_at,
            updated_at: s.updated_at,
            message_count: s.message_count,
            summary: s.summary,
            is_active: !!s.is_active,
          },
          shared_entities: [...new Set(sharedEntities)],
          shared_topics: [...new Set(sharedTopics)],
          shared_keywords: [...new Set(sharedKeywords)].slice(0, 20),
          relevance_score: score,
        });
      }
    }

    // Sort by relevance and limit
    candidates.sort((a, b) => b.relevance_score - a.relevance_score);
    return candidates.slice(0, limit);
  }
}

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

// ══════════════════════════════════════════════════════════════════════════════
// 24. Root Cause Analysis
// ══════════════════════════════════════════════════════════════════════════════

export interface RootCause {
  category: "storage" | "performance" | "data_quality" | "configuration" | "growth";
  severity: "low" | "medium" | "high" | "critical";
  symptom: string;
  root_cause: string;
  evidence: string[];
  recommended_actions: string[];
  estimated_impact: string;
}

export interface RootCauseReport {
  timestamp: string;
  overall_status: "healthy" | "degraded" | "critical";
  root_causes: RootCause[];
  health_summary: HealthStatus;
  tier_balance: Record<string, number>;
  query_performance: {
    avg_ms: number;
    slow_queries: number;
    total_queries: number;
  };
}

export class RootCauseAnalyzer {
  /**
   * Perform deep root-cause analysis beyond basic health checks.
   * Examines storage patterns, data quality, query performance,
   * configuration issues, and growth trajectories.
   */
  static async analyze(): Promise<RootCauseReport> {
    const db = await BrainStore.get();
    const health = await BrainStore.getHealth();
    const causes: RootCause[] = [];

    // ── Storage Analysis ──────────────────────────────────────────────────

    // 1. Check WAL size vs main DB
    let walSizeBytes = 0;
    try {
      const { getMemoryBrainSqlitePath } = await import("../../../util/paths.js");
      const walPath = getMemoryBrainSqlitePath() + "-wal";
      const fs = await import("fs");
      if (fs.existsSync(walPath)) {
        walSizeBytes = fs.statSync(walPath).size;
      }
    } catch {}

    if (walSizeBytes > 10 * 1024 * 1024) {
      causes.push({
        category: "storage",
        severity: walSizeBytes > 50 * 1024 * 1024 ? "high" : "medium",
        symptom: `WAL file is ${(walSizeBytes / (1024 * 1024)).toFixed(1)}MB`,
        root_cause: "WAL checkpointing is not keeping up with write rate, or WAL checkpoint never runs",
        evidence: [`WAL size: ${walSizeBytes} bytes`, `Main DB: ${health.db_size_bytes} bytes`],
        recommended_actions: ["Run PRAGMA wal_checkpoint(TRUNCATE)", "Run 'optimize' to VACUUM"],
        estimated_impact: "Improved write performance and reduced disk usage",
      });
    }

    // 2. Check for oversized individual memories
    const largeMemories = await db.get(
      `SELECT COUNT(*) as c, MAX(length(content)) as maxlen FROM brain_semantic WHERE length(content) > 10000`,
    ) as any;
    if (largeMemories?.c > 0) {
      causes.push({
        category: "data_quality",
        severity: largeMemories.c > 50 ? "high" : "medium",
        symptom: `${largeMemories.c} semantic memories exceed 10KB (max: ${(largeMemories.maxlen / 1024).toFixed(1)}KB)`,
        root_cause: "Large uncompressed content stored in semantic memories — possibly raw code or verbose text",
        evidence: [`Count over 10KB: ${largeMemories.c}`, `Max content length: ${largeMemories.maxlen}`],
        recommended_actions: ["Run 'consolidate' to compress cold-tier memories", "Review auto-extract settings to filter verbose content"],
        estimated_impact: "Reduced DB size and faster query performance",
      });
    }

    // ── Tier Balance Analysis ─────────────────────────────────────────────

    const tierCounts: Record<string, number> = {};
    const semTiers = await db.all(`SELECT tier, COUNT(*) as c FROM brain_semantic GROUP BY tier`);
    const epTiers = await db.all(`SELECT tier, COUNT(*) as c FROM brain_episodic GROUP BY tier`);
    for (const r of [...semTiers, ...epTiers]) {
      const t = (r as any).tier;
      tierCounts[t] = (tierCounts[t] ?? 0) + (r as any).c;
    }
    const totalMem = Object.values(tierCounts).reduce((s, c) => s + c, 0);

    if (totalMem > 0) {
      const hotRatio = (tierCounts["hot"] ?? 0) / totalMem;
      if (hotRatio > 0.6) {
        causes.push({
          category: "configuration",
          severity: hotRatio > 0.8 ? "high" : "medium",
          symptom: `Hot tier contains ${(hotRatio * 100).toFixed(0)}% of all memories`,
          root_cause: "Consolidation runs too infrequently or importance thresholds are too high",
          evidence: [
            `Hot: ${tierCounts["hot"] ?? 0}`,
            `Warm: ${tierCounts["warm"] ?? 0}`,
            `Cold: ${tierCounts["cold"] ?? 0}`,
            `Total: ${totalMem}`,
          ],
          recommended_actions: [
            "Run 'consolidate' to tier down aging memories",
            "Lower hot_to_warm_hours config",
            "Increase consolidation frequency",
          ],
          estimated_impact: "Better memory retrieval performance and reduced working set",
        });
      }

      const coldRatio = ((tierCounts["cold"] ?? 0) + (tierCounts["frozen"] ?? 0)) / totalMem;
      if (coldRatio > 0.8 && totalMem > 100) {
        causes.push({
          category: "data_quality",
          severity: "medium",
          symptom: `${(coldRatio * 100).toFixed(0)}% of memories are cold/frozen`,
          root_cause: "Most memories have low importance or haven't been accessed — possible over-extraction",
          evidence: [
            `Cold+Frozen: ${(tierCounts["cold"] ?? 0) + (tierCounts["frozen"] ?? 0)}`,
            `Hot+Warm: ${(tierCounts["hot"] ?? 0) + (tierCounts["warm"] ?? 0)}`,
          ],
          recommended_actions: [
            "Review auto_extract_min_importance setting (raise it)",
            "Prune old frozen memories",
          ],
          estimated_impact: "Smaller DB and more meaningful memory retrieval",
        });
      }
    }

    // ── Orphan / Integrity Analysis ───────────────────────────────────────

    const orphanAssoc = await db.get(
      `SELECT COUNT(*) as c FROM brain_associations
       WHERE (source_type = 'semantic' AND source_id NOT IN (SELECT id FROM brain_semantic))
       OR (target_type = 'semantic' AND target_id NOT IN (SELECT id FROM brain_semantic))
       OR (source_type = 'episodic' AND source_id NOT IN (SELECT id FROM brain_episodic))
       OR (target_type = 'episodic' AND target_id NOT IN (SELECT id FROM brain_episodic))`,
    ) as any;
    if (orphanAssoc?.c > 0) {
      causes.push({
        category: "data_quality",
        severity: orphanAssoc.c > 100 ? "high" : "low",
        symptom: `${orphanAssoc.c} orphan associations found`,
        root_cause: "Memories were deleted without cleaning up their associations",
        evidence: [`Orphan count: ${orphanAssoc.c}`],
        recommended_actions: ["Run heal action: purge_orphan_associations"],
        estimated_impact: "Cleaner data, slightly faster association queries",
      });
    }

    // ── Growth Rate Analysis ──────────────────────────────────────────────

    const recentGrowth = await db.get(
      `SELECT COUNT(*) as c FROM brain_semantic WHERE created_at > datetime('now', '-24 hours')`,
    ) as any;
    if (recentGrowth?.c > 100) {
      causes.push({
        category: "growth",
        severity: recentGrowth.c > 500 ? "high" : "medium",
        symptom: `${recentGrowth.c} new semantic memories in the last 24 hours`,
        root_cause: "High auto-extraction rate or frequent store operations",
        evidence: [`24h new memories: ${recentGrowth.c}`],
        recommended_actions: [
          "Raise auto_extract_min_importance",
          "Reduce max_episodic_per_session",
          "Run consolidation more frequently",
        ],
        estimated_impact: "Controlled growth and better signal-to-noise ratio",
      });
    }

    // ── Expired / Stale Data ──────────────────────────────────────────────

    const expiredCount = await db.get(
      `SELECT COUNT(*) as c FROM brain_semantic WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`,
    ) as any;
    if (expiredCount?.c > 0) {
      causes.push({
        category: "data_quality",
        severity: expiredCount.c > 50 ? "medium" : "low",
        symptom: `${expiredCount.c} expired semantic memories still in database`,
        root_cause: "Expired memory cleanup has not run recently",
        evidence: [`Expired count: ${expiredCount.c}`],
        recommended_actions: ["Run 'consolidate' to prune expired memories"],
        estimated_impact: "Reduced DB size and cleaner search results",
      });
    }

    // ── Duplicate Detection ───────────────────────────────────────────────

    const duplicates = await db.get(
      `SELECT COUNT(*) as c FROM (
        SELECT title, category, COUNT(*) as cnt FROM brain_semantic
        GROUP BY title, category HAVING cnt > 1
      )`,
    ) as any;
    if (duplicates?.c > 0) {
      causes.push({
        category: "data_quality",
        severity: duplicates.c > 20 ? "medium" : "low",
        symptom: `${duplicates.c} duplicate semantic memory title+category combinations`,
        root_cause: "Same facts stored multiple times, possibly from repeated auto-extraction",
        evidence: [`Duplicate groups: ${duplicates.c}`],
        recommended_actions: ["Review and deduplicate semantic memories", "Enable deduplication in auto-extract"],
        estimated_impact: "Cleaner, deduplicated knowledge base",
      });
    }

    // ── Determine overall status ──────────────────────────────────────────

    const criticalCount = causes.filter((c) => c.severity === "critical").length;
    const highCount = causes.filter((c) => c.severity === "high").length;
    let overallStatus: "healthy" | "degraded" | "critical" = "healthy";
    if (criticalCount > 0) overallStatus = "critical";
    else if (highCount > 0 || causes.length >= 3) overallStatus = "degraded";

    return {
      timestamp: new Date().toISOString(),
      overall_status: overallStatus,
      root_causes: causes,
      health_summary: health,
      tier_balance: tierCounts,
      query_performance: {
        avg_ms: 0, // Would be populated from MetricsCollector if available
        slow_queries: 0,
        total_queries: 0,
      },
    };
  }
}

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

// ══════════════════════════════════════════════════════════════════════════════
// 26. LRU Cache Layer
// ══════════════════════════════════════════════════════════════════════════════

interface LruEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  lastAccessedAt: number;
  hitCount: number;
  sizeEstimate: number;
}

export interface LruCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  max_size: number;
  hit_rate: number;
  total_memory_bytes: number;
  avg_entry_age_ms: number;
  hottest_keys: Array<{ key: string; hits: number }>;
}

export interface LruCacheConfig {
  maxEntries: number;
  ttlMs: number;
  maxMemoryBytes: number;
}

/**
 * General-purpose LRU cache with TTL, memory limits, and detailed statistics.
 * Used to cache frequently accessed memories, search results, and entity lookups.
 */
export class LruCache<T = any> {
  private cache = new Map<string, LruEntry<T>>();
  private config: LruCacheConfig;
  private stats = { hits: 0, misses: 0, evictions: 0 };
  private totalMemoryBytes = 0;

  constructor(config?: Partial<LruCacheConfig>) {
    this.config = {
      maxEntries: config?.maxEntries ?? 500,
      ttlMs: config?.ttlMs ?? 30 * 60 * 1000, // 30 minutes
      maxMemoryBytes: config?.maxMemoryBytes ?? 10 * 1024 * 1024, // 10MB
    };
  }

  /**
   * Get a value from cache. Returns undefined if not found or expired.
   * Promotes the entry to most-recently-used position.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.config.ttlMs) {
      this.remove(key);
      this.stats.misses++;
      return undefined;
    }

    // Promote to MRU (re-insert to maintain order)
    this.cache.delete(key);
    entry.lastAccessedAt = Date.now();
    entry.hitCount++;
    this.cache.set(key, entry);
    this.stats.hits++;

    return entry.value;
  }

  /**
   * Set a value in cache. Evicts LRU entries if at capacity.
   */
  set(key: string, value: T, sizeEstimate?: number): void {
    const size = sizeEstimate ?? this.estimateSize(value);

    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.remove(key);
    }

    // Evict until we have room
    while (
      this.cache.size >= this.config.maxEntries ||
      this.totalMemoryBytes + size > this.config.maxMemoryBytes
    ) {
      if (this.cache.size === 0) break;
      this.evictLru();
    }

    const entry: LruEntry<T> = {
      key,
      value,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      hitCount: 0,
      sizeEstimate: size,
    };

    this.cache.set(key, entry);
    this.totalMemoryBytes += size;
  }

  /**
   * Check if a key exists (without promoting it).
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > this.config.ttlMs) {
      this.remove(key);
      return false;
    }
    return true;
  }

  /**
   * Remove a key from cache.
   */
  remove(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.totalMemoryBytes -= entry.sizeEstimate;
    this.cache.delete(key);
    return true;
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
    this.totalMemoryBytes = 0;
  }

  /**
   * Evict expired entries.
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.config.ttlMs) {
        this.remove(key);
        this.stats.evictions++;
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Get cache statistics.
   */
  getStats(): LruCacheStats {
    const now = Date.now();
    let totalAge = 0;
    const entries = Array.from(this.cache.values());
    for (const e of entries) {
      totalAge += now - e.createdAt;
    }

    // Top 10 hottest keys
    const hottest = entries
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 10)
      .map((e) => ({ key: e.key, hits: e.hitCount }));

    const totalRequests = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      size: this.cache.size,
      max_size: this.config.maxEntries,
      hit_rate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      total_memory_bytes: this.totalMemoryBytes,
      avg_entry_age_ms: entries.length > 0 ? totalAge / entries.length : 0,
      hottest_keys: hottest,
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  private evictLru(): void {
    // Map iteration order = insertion order; first entry is LRU
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.remove(firstKey);
      this.stats.evictions++;
    }
  }

  private estimateSize(value: T): number {
    if (typeof value === "string") return value.length * 2;
    if (typeof value === "number") return 8;
    if (value === null || value === undefined) return 0;
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 256; // default estimate
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 27. Performance Metrics Storage
// ══════════════════════════════════════════════════════════════════════════════

export interface StoredMetricsSnapshot {
  id: number;
  timestamp: string;
  total_operations: number;
  success_rate: number;
  avg_response_ms: number;
  p95_response_ms: number;
  total_tokens_used: number;
  operations_per_minute: number;
  db_size_bytes: number;
  memory_count: number;
  memory_tokens_saved: number;
  /** Part VIII–IX: Σ |Mᵢ| / rᵢ at snapshot time. */
  hierarchy_effective_tokens: number;
  /** W_max + hierarchy effective at snapshot time. */
  total_effective: number;
  by_operation_json: string; // JSON
}

export interface MetricsTrend {
  snapshots: StoredMetricsSnapshot[];
  period_hours: number;
  avg_response_trend: "improving" | "stable" | "degrading";
  success_rate_trend: "improving" | "stable" | "degrading";
  growth_rate_trend: "stable" | "growing" | "shrinking" | "accelerating";
  compression_trend: "improving" | "stable" | "degrading";
  /** C_effective growth trend (unlimited context capacity). */
  effective_context_trend: "improving" | "stable" | "degrading";
}

export class MetricsStorage {
  /**
   * Ensure the metrics storage table exists.
   */
  static async ensureTable(): Promise<void> {
    const db = await BrainStore.get();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_metrics_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_operations INTEGER DEFAULT 0,
        success_rate REAL DEFAULT 1.0,
        avg_response_ms REAL DEFAULT 0,
        p95_response_ms REAL DEFAULT 0,
        total_tokens_used INTEGER DEFAULT 0,
        operations_per_minute REAL DEFAULT 0,
        db_size_bytes INTEGER DEFAULT 0,
        memory_count INTEGER DEFAULT 0,
        memory_tokens_saved INTEGER DEFAULT 0,
        hierarchy_effective_tokens REAL DEFAULT 0,
        total_effective REAL DEFAULT 0,
        by_operation_json TEXT DEFAULT '{}'
      )
    `);
    for (const col of [
      "memory_tokens_saved INTEGER DEFAULT 0",
      "hierarchy_effective_tokens REAL DEFAULT 0",
      "total_effective REAL DEFAULT 0",
    ]) {
      try {
        await db.run(`ALTER TABLE brain_metrics_snapshots ADD COLUMN ${col}`);
      } catch {
        // Column already exists
      }
    }
  }

  /**
   * Persist a metrics snapshot to SQLite for historical trend analysis.
   */
  static async storeSnapshot(
    metrics: MetricsSummary,
    dbSizeBytes: number,
    memoryCount: number,
    memoryTokensSaved = 0,
    hierarchyEffectiveTokens = 0,
    totalEffective = 0,
  ): Promise<number> {
    await MetricsStorage.ensureTable();
    const db = await BrainStore.get();

    const result = await db.run(
      `INSERT INTO brain_metrics_snapshots
       (total_operations, success_rate, avg_response_ms, p95_response_ms,
        total_tokens_used, operations_per_minute, db_size_bytes, memory_count,
        memory_tokens_saved, hierarchy_effective_tokens, total_effective, by_operation_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metrics.total_operations,
        metrics.success_rate,
        metrics.avg_response_ms,
        metrics.p95_response_ms,
        metrics.total_tokens_used,
        metrics.operations_per_minute,
        dbSizeBytes,
        memoryCount,
        memoryTokensSaved,
        hierarchyEffectiveTokens,
        totalEffective,
        JSON.stringify(metrics.by_operation),
      ],
    );

    // Auto-cleanup: keep only last 1000 snapshots
    await db.run(
      `DELETE FROM brain_metrics_snapshots WHERE id NOT IN (
        SELECT id FROM brain_metrics_snapshots ORDER BY timestamp DESC LIMIT 1000
      )`,
    );

    return result.lastID!;
  }

  /**
   * Get historical metrics snapshots for trend analysis.
   */
  static async getSnapshots(options: {
    hours?: number;
    limit?: number;
  } = {}): Promise<StoredMetricsSnapshot[]> {
    await MetricsStorage.ensureTable();
    const db = await BrainStore.get();
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.hours) {
      conditions.push(`timestamp > datetime('now', '-${Math.floor(options.hours)} hours')`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(options.limit ?? 100);

    const rows = await db.all(
      `SELECT * FROM brain_metrics_snapshots ${where} ORDER BY timestamp DESC LIMIT ?`,
      params,
    );

    return rows.map((r: any) => ({
      id: r.id,
      timestamp: r.timestamp,
      total_operations: r.total_operations,
      success_rate: r.success_rate,
      avg_response_ms: r.avg_response_ms,
      p95_response_ms: r.p95_response_ms,
      total_tokens_used: r.total_tokens_used,
      operations_per_minute: r.operations_per_minute,
      db_size_bytes: r.db_size_bytes,
      memory_count: r.memory_count,
      memory_tokens_saved: r.memory_tokens_saved ?? 0,
      hierarchy_effective_tokens: r.hierarchy_effective_tokens ?? 0,
      total_effective: r.total_effective ?? 0,
      by_operation_json: r.by_operation_json,
    }));
  }

  /**
   * Analyze trends from stored metrics.
   */
  static async analyzeTrends(hours: number = 24): Promise<MetricsTrend> {
    const snapshots = await MetricsStorage.getSnapshots({ hours, limit: 500 });

    // Default trends
    let avgResponseTrend: MetricsTrend["avg_response_trend"] = "stable";
    let successRateTrend: MetricsTrend["success_rate_trend"] = "stable";
    let growthRateTrend: MetricsTrend["growth_rate_trend"] = "stable";
    let compressionTrend: MetricsTrend["compression_trend"] = "stable";
    let effectiveContextTrend: MetricsTrend["effective_context_trend"] = "stable";

    if (snapshots.length >= 3) {
      // Compare first third vs last third
      const third = Math.floor(snapshots.length / 3);
      // snapshots are DESC, so last entries are oldest
      const recent = snapshots.slice(0, third);
      const older = snapshots.slice(-third);

      const recentAvgMs = recent.reduce((s, r) => s + r.avg_response_ms, 0) / recent.length;
      const olderAvgMs = older.reduce((s, r) => s + r.avg_response_ms, 0) / older.length;

      if (recentAvgMs < olderAvgMs * 0.9) avgResponseTrend = "improving";
      else if (recentAvgMs > olderAvgMs * 1.1) avgResponseTrend = "degrading";

      const recentSuccessRate = recent.reduce((s, r) => s + r.success_rate, 0) / recent.length;
      const olderSuccessRate = older.reduce((s, r) => s + r.success_rate, 0) / older.length;

      if (recentSuccessRate > olderSuccessRate + 0.02) successRateTrend = "improving";
      else if (recentSuccessRate < olderSuccessRate - 0.02) successRateTrend = "degrading";

      const recentSize = recent.reduce((s, r) => s + r.db_size_bytes, 0) / recent.length;
      const olderSize = older.reduce((s, r) => s + r.db_size_bytes, 0) / older.length;

      if (olderSize > 0) {
        const growthRatio = recentSize / olderSize;
        if (growthRatio > 1.2) growthRateTrend = "accelerating";
        else if (growthRatio > 1.02) growthRateTrend = "growing";
        else if (growthRatio < 0.98) growthRateTrend = "shrinking";
      }

      const recentCompression =
        recent.reduce((s, r) => s + (r.memory_tokens_saved ?? 0), 0) / recent.length;
      const olderCompression =
        older.reduce((s, r) => s + (r.memory_tokens_saved ?? 0), 0) / older.length;
      if (recentCompression > olderCompression * 1.1) compressionTrend = "improving";
      else if (recentCompression < olderCompression * 0.9) compressionTrend = "degrading";

      const recentEffective =
        recent.reduce((s, r) => s + (r.total_effective ?? 0), 0) / recent.length;
      const olderEffective =
        older.reduce((s, r) => s + (r.total_effective ?? 0), 0) / older.length;
      if (recentEffective > olderEffective * 1.05) effectiveContextTrend = "improving";
      else if (recentEffective < olderEffective * 0.95) effectiveContextTrend = "degrading";
    }

    return {
      snapshots,
      period_hours: hours,
      avg_response_trend: avgResponseTrend,
      success_rate_trend: successRateTrend,
      growth_rate_trend: growthRateTrend,
      compression_trend: compressionTrend,
      effective_context_trend: effectiveContextTrend,
    };
  }

  /**
   * Get a compact summary of metrics trends.
   */
  static async getTrendSummary(hours: number = 24): Promise<string> {
    const trend = await MetricsStorage.analyzeTrends(hours);

    if (trend.snapshots.length === 0) {
      return "No metrics snapshots stored yet. Metrics will be stored periodically during operation.";
    }

    const latest = trend.snapshots[0];
    const oldest = trend.snapshots[trend.snapshots.length - 1];
    const dbGrowthKb = (latest.db_size_bytes - oldest.db_size_bytes) / 1024;

    return [
      `Metrics Trend (last ${hours}h, ${trend.snapshots.length} snapshots):`,
      `  Avg response: ${latest.avg_response_ms.toFixed(1)}ms (trend: ${trend.avg_response_trend})`,
      `  Success rate: ${(latest.success_rate * 100).toFixed(1)}% (trend: ${trend.success_rate_trend})`,
      `  DB growth: ${dbGrowthKb >= 0 ? "+" : ""}${dbGrowthKb.toFixed(1)}KB (trend: ${trend.growth_rate_trend})`,
      `  C_effective: ${Math.round(latest.total_effective ?? 0).toLocaleString()} (trend: ${trend.effective_context_trend})`,
      `  Total ops: ${latest.total_operations}`,
      `  Memory count: ${latest.memory_count}`,
    ].join("\n");
  }
}
