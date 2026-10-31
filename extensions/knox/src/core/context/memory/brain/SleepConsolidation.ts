/**
 * SleepConsolidation — REM/NREM-cycle memory replay, strengthening,
 * and episodic-to-semantic distillation.
 *
 * Mirrors Knox-MS NeuralMemory sleep consolidation patterns:
 * - NREM Phase 1: Replay recently accessed hot leaves (count only; no I/S write)
 * - NREM Phase 2: R/Value tiers (MEM-15; no tombstone, no leftover I write)
 * - NREM Phase 3: Compress cold-tier memories
 * - REM Phase: Episodic-to-semantic distillation — find recurring patterns
 *   in episodic memories and extract stable knowledge into semantic memory
 * - Post-sleep: Graph strengthening (reinforce frequently co-activated edges)
 * - φ₇: Refit channel weights w_s and calibrated θ from brain_attribution (MEM-18)
 *
 * This runs as part of the consolidation pipeline (not time-based sleep).
 * Each invocation performs one full "sleep cycle".
 * KN-312: NREM/REM are sleep sub-steps. They must not DELETE. Frozen is
 * archive; tombstone is only forget/TTL/privacy.
 */

import { BrainStore } from "./BrainStore.js";
import { GRAPH_COMMON_NOUN_DENYLIST, isCommonNounEntityName } from "./GraphRetrieval.js";
import {
  CALIBRATED_THETA_DEFAULT,
  computeAttributionRefit,
  emptyChannelWeights,
  loadAttributionRefit,
  type AttributionRefitResult,
} from "./memoryOutcomes.js";
import { contentWords } from "./RetrievalQuery.js";
import { recomputeMemoryTiers } from "./store/tiers.js";
import { checkStoreInvariants, type StoreInvariantReport } from "./invariants.js";
import type {
  ConsolidationResult,
  SleepSubPhaseCounts,
} from "./types.js";

export interface SleepCycleResult extends ConsolidationResult {
  replayed: number;
  strengthened: number;
  distilled: number;
  edges_strengthened: number;
  compressed: number;
  /** Breakdown of each sleep sub-phase (IMP-06). */
  sub_phases: SleepSubPhaseCounts;
  /** φ₇ attribution refit of w_s and calibrated θ (MEM-18). */
  refit?: AttributionRefitResult;
  /** Reachability ∧ Losslessness after this cycle (MEM-32). */
  invariants?: StoreInvariantReport;
}

/** Work that runs after each sleep cycle (MC-40). Hooks must not throw into the cycle; failures are logged. */
export type SleepCycleHook = (result: SleepCycleResult) => Promise<void>;
const cycleHooks = new Map<string, SleepCycleHook>();

/** Register (or replace) a post-cycle hook by name. Returns an unregister function. */
export function registerSleepCycleHook(name: string, hook: SleepCycleHook): () => void {
  cycleHooks.set(name, hook);
  return () => {
    if (cycleHooks.get(name) === hook) cycleHooks.delete(name);
  };
}

export class SleepConsolidation {

  /**
   * Run a full sleep consolidation cycle.
   * This enhances the basic hot→warm→cold tiering with brain-like phases.
   */
  static async runCycle(): Promise<SleepCycleResult> {
    const result: SleepCycleResult = {
      promoted: 0,
      demoted: 0,
      pruned: 0,
      summaries_created: 0,
      replayed: 0,
      strengthened: 0,
      distilled: 0,
      edges_strengthened: 0,
      compressed: 0,
      sub_phases: {
        nrem_replay: 0,
        nrem_decay_demoted: 0,
        nrem_decay_pruned: 0,
        nrem_compress: 0,
        rem_distill: 0,
        graph_strengthen: 0,
        promote: 0,
        refit: 0,
      },
    };

    // Phase 1 (NREM-1): Replay — count recently accessed hot leaves. No I/S write (MEM-14).
    result.replayed = await SleepConsolidation.nremReplay();
    result.sub_phases.nrem_replay = result.replayed;

    // Phase 2 (NREM-2): R/Value tiers (MEM-15). Never tombstone. Never rewrite leftover I.
    const decayResult = await SleepConsolidation.nremDecay();
    result.demoted = decayResult.demoted;
    result.pruned = 0;
    result.promoted = decayResult.promoted;
    result.sub_phases.nrem_decay_demoted = decayResult.demoted;
    result.sub_phases.nrem_decay_pruned = 0;

    // Phase 3 (NREM-3): Compress — compress cold-tier content
    result.compressed = await SleepConsolidation.nremCompress();
    result.sub_phases.nrem_compress = result.compressed;

    // Phase 4 (REM): Distill — extract recurring patterns from episodic memory
    result.distilled = await SleepConsolidation.remDistill();
    result.sub_phases.rem_distill = result.distilled;

    // Phase 5 (Post-sleep): Strengthen graph edges that co-occur frequently
    result.edges_strengthened = await SleepConsolidation.strengthenGraph();
    result.sub_phases.graph_strengthen = result.edges_strengthened;

    // Phase 6: leftover hook. Tiers already assigned from R/Value in nremDecay.
    await SleepConsolidation.promoteHighValue();
    result.sub_phases.promote = result.promoted;

    // Phase 7 (φ₇): refit channel weights w_s and calibrated θ from attribution.
    result.refit = await SleepConsolidation.refitAttributionPriors();
    result.sub_phases.refit = result.refit?.rows ?? 0;

    for (const [name, hook] of cycleHooks) {
      try {
        await hook(result);
      } catch (error) {
        console.warn(`[Sleep] Hook "${name}" failed:`, error instanceof Error ? error.message : error);
      }
    }

    try {
      result.invariants = await checkStoreInvariants({ audit: true });
    } catch (error) {
      console.warn("[Sleep] Invariant check failed:", error instanceof Error ? error.message : error);
    }

    return result;
  }

  // ── NREM Phase 1: Replay ────────────────────────────────────────────────────

  /**
   * NREM replay: count recently accessed hot leaves. Strength changes only
   * come from attribution (MEM-14 / MEM-16). Sleep must not rewrite leftover I.
   */
  private static async nremReplay(): Promise<number> {
    const db = await BrainStore.get();
    const row = (await db.get(
      `SELECT (
         (SELECT COUNT(*) FROM brain_semantic
           WHERE tombstoned_at IS NULL AND tier = 'hot'
             AND last_accessed_at > datetime('now', '-1 day')
             AND (salience > 0.6 OR importance_score >= 0.7))
         +
         (SELECT COUNT(*) FROM brain_episodic
           WHERE tombstoned_at IS NULL AND tier = 'hot'
             AND salience > 0.7
             AND created_at > datetime('now', '-2 days'))
       ) AS n`,
    )) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }

  // ── NREM Phase 2: Decay ────────────────────────────────────────────────────

  /**
   * Assign tiers from R and Value (MEM-15). Frozen is archive (skip retrieve).
   * Tombstone is only forget/TTL/privacy. Leftover I(m,t) is not written.
   */
  private static async nremDecay(): Promise<{ demoted: number; pruned: number; promoted: number }> {
    const tiers = await recomputeMemoryTiers();
    return { demoted: tiers.demoted, pruned: 0, promoted: tiers.promoted };
  }

  // ── NREM Phase 3: Compress ─────────────────────────────────────────────────

  /**
   * Write summary-tree pointers for cold-tier leaves. Originals stay intact.
   */
  private static async nremCompress(): Promise<number> {
    try {
      return await BrainStore.compressColdTier();
    } catch {
      return 0;
    }
  }

  // ── REM Phase: Episodic-to-Semantic Distillation ───────────────────────────

  /**
   * REL-15: cluster episodic by topic (or session if untagged), never by a
   * single global keyword. Distilled rows keep topic_id + source_session_id.
   * Common-noun keywords are skipped (REL-11 denylist).
   */
  static async remDistill(): Promise<number> {
    const db = await BrainStore.get();
    let distilled = 0;

    const sessions = await db.all(
      `SELECT DISTINCT session_id FROM brain_episodic
       WHERE tier IN ('warm', 'cold')
       AND created_at > datetime('now', '-30 days')
       LIMIT 20`,
    );

    if (sessions.length < 2) return 0;

    type Cluster = {
      topicId: number | null;
      sessionIds: string[];
      keywordSessions: Map<string, string[]>;
    };
    const clusters = new Map<string, Cluster>();

    for (const s of sessions) {
      const sid = (s as { session_id: string }).session_id;
      const topic = await BrainStore.getLatestSessionTopic(sid);
      const key = SleepConsolidation.distillClusterKey(sid, topic);
      let cluster = clusters.get(key);
      if (!cluster) {
        cluster = {
          topicId: topic?.id ?? null,
          sessionIds: [],
          keywordSessions: new Map(),
        };
        clusters.set(key, cluster);
      }
      cluster.sessionIds.push(sid);

      const messages = await db.all(
        `SELECT content, importance_score FROM brain_episodic
         WHERE session_id = ? AND role IN ('user', 'assistant')
           AND tombstoned_at IS NULL
         ORDER BY importance_score DESC LIMIT 30`,
        [sid],
      );

      const kwFreq = new Map<string, number>();
      for (const m of messages) {
        const words = SleepConsolidation.extractKeywords((m as { content: string }).content);
        for (const w of words) {
          kwFreq.set(w, (kwFreq.get(w) ?? 0) + 1);
        }
      }
      for (const [kw, freq] of kwFreq) {
        if (freq < 2) continue;
        const list = cluster.keywordSessions.get(kw) ?? [];
        list.push(sid);
        cluster.keywordSessions.set(kw, list);
      }
    }

    for (const cluster of clusters.values()) {
      const stable = Array.from(cluster.keywordSessions.entries())
        .filter(([, sids]) => sids.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 10);

      for (const [keyword, sids] of stable) {
        const existing = await db.get(
          `SELECT id FROM brain_semantic
           WHERE LOWER(keywords) LIKE ? AND category = 'insight'
           AND (topic_id IS ? OR (topic_id IS NULL AND ? IS NULL))`,
          [`%${keyword}%`, cluster.topicId, cluster.topicId],
        );
        if (existing) continue;

        const representative: string[] = [];
        const sourceRefs: Array<{ type: "episodic"; id: number; text: string }> = [];
        for (const sid of sids) {
          const topMsgs = await db.all(
            `SELECT id, content FROM brain_episodic
             WHERE session_id = ? AND LOWER(content) LIKE ?
               AND tombstoned_at IS NULL
             ORDER BY importance_score DESC LIMIT 5`,
            [sid, `%${keyword}%`],
          );
          for (const msg of topMsgs as { id: number; content: string }[]) {
            sourceRefs.push({ type: "episodic", id: msg.id, text: msg.content });
            if (representative.length < 3) {
              representative.push(msg.content.substring(0, 200));
            }
          }
        }
        if (representative.length < 2) continue;

        const title = `Recurring pattern: ${keyword}`;
        const content = `This topic appears across ${sids.length} conversation sessions. Key references:\n${representative.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}`;

        const insightId = await BrainStore.storeSemantic({
          category: "insight",
          title,
          content,
          keywords: keyword,
          importance: 0.6 + Math.min(sids.length * 0.05, 0.3),
          session_id: sids[0],
          topic_id: cluster.topicId,
          summary_of: sourceRefs,
        });
        await BrainStore.writeSummaryPointer({
          text: content,
          sources: sourceRefs,
        });
        if (insightId && sourceRefs.length > 0) {
          const ids = [...new Set(sourceRefs.map((s) => s.id))];
          const placeholders = ids.map(() => "?").join(",");
          await db.run(
            `UPDATE brain_episodic SET parent_id = ? WHERE id IN (${placeholders}) AND parent_id IS NULL`,
            [insightId, ...ids],
          );
        }
        distilled++;
      }
    }

    return distilled;
  }

  /** Same topic label+keywords cluster together; untagged sessions never merge. */
  private static distillClusterKey(
    sessionId: string,
    topic: { topic: string; keywords: string } | null,
  ): string {
    if (!topic) return `session:${sessionId}`;
    const label = topic.topic.trim().toLowerCase().replace(/\s+/g, " ");
    const kws = topic.keywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join(",");
    return `topic:${label}|${kws}`;
  }

  // ── Post-Sleep: Graph Strengthening ────────────────────────────────────────

  /**
   * Strengthen knowledge graph edges between entities that frequently co-occur.
   * This models synaptic strengthening during sleep.
   */
  private static async strengthenGraph(): Promise<number> {
    const db = await BrainStore.get();

    // Boost edges that connect frequently-mentioned entities
    const result = await db.run(
      `UPDATE brain_graph_edges
       SET weight = MIN(1.0, weight + 0.05)
       WHERE id IN (
         SELECT e.id FROM brain_graph_edges e
         JOIN brain_entities src ON e.source_entity_id = src.id
         JOIN brain_entities tgt ON e.target_entity_id = tgt.id
         WHERE src.mention_count >= 5 AND tgt.mention_count >= 5
         AND e.weight < 0.95
       )`,
    );

    // Decay edges between rarely-mentioned entities
    await db.run(
      `UPDATE brain_graph_edges
       SET weight = MAX(0.1, weight - 0.02)
       WHERE id IN (
         SELECT e.id FROM brain_graph_edges e
         JOIN brain_entities src ON e.source_entity_id = src.id
         JOIN brain_entities tgt ON e.target_entity_id = tgt.id
         WHERE src.mention_count <= 1 AND tgt.mention_count <= 1
         AND e.weight > 0.15
       )`,
    );

    return result.changes ?? 0;
  }

  // ── φ₇: Refit w_s and θ ────────────────────────────────────────────────────

  /**
   * Increment the winning channel's w_s from cited+helpful vs unhelpful.
   * Calibrate θ as the running P(helpful | injected) and copy it into live
   * `retrieval_threshold` (MEM-22).
   */
  private static async refitAttributionPriors(): Promise<AttributionRefitResult> {
    const empty = computeAttributionRefit([], {
      theta: CALIBRATED_THETA_DEFAULT,
      weights: emptyChannelWeights(),
    });
    try {
      const db = await BrainStore.get();
      const cfg = BrainStore.getConfig();
      const result = await loadAttributionRefit(db, {
        theta: cfg.calibrated_theta,
        weights: {
          lexical: cfg.w_lexical,
          ripgrep: cfg.w_ripgrep,
          graph: cfg.w_graph,
          tree: cfg.w_tree,
        },
      });
      if (result.channel_updated) {
        await BrainStore.saveConfig("w_lexical", String(result.channel_weights.lexical));
        await BrainStore.saveConfig("w_ripgrep", String(result.channel_weights.ripgrep));
        await BrainStore.saveConfig("w_graph", String(result.channel_weights.graph));
        await BrainStore.saveConfig("w_tree", String(result.channel_weights.tree));
      }
      if (result.theta_updated) {
        await BrainStore.saveConfig("calibrated_theta", String(result.theta));
        await BrainStore.saveConfig("retrieval_threshold", String(result.theta));
      }
      await BrainStore.auditLog("refit", "sleep", null, {
        calibration_n: result.calibration_n,
        helpful_rate: result.helpful_rate,
        theta: result.theta,
        theta_updated: result.theta_updated,
        channel_weights: result.channel_weights,
        channel_updated: result.channel_updated,
      }).catch(() => {});
      return result;
    } catch (error) {
      console.warn("[Sleep] Attribution refit failed:", error instanceof Error ? error.message : error);
      return empty;
    }
  }

  // ── Post-Sleep: Promote High-Value ─────────────────────────────────────────

  /**
   * Leftover sleep hook. Hot is R ≥ 0.9 from nremDecay, not retrieval_count.
   */
  private static async promoteHighValue(): Promise<number> {
    return 0;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private static extractKeywords(text: string): string[] {
    return contentWords(text).filter(
      (w) => w.length > 3 && !GRAPH_COMMON_NOUN_DENYLIST.has(w) && !isCommonNounEntityName(w),
    );
  }
}
