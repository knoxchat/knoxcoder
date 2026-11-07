/**
 * SleepConsolidation — φ₇ on schedule and idle (MEM-74).
 *
 * Order: dedup → reconcile / contradiction scan → tree (lazy summary text)
 * → lexical index refresh → archive Value < θ_arch → refit.
 * NREM/REM stay sleep sub-steps (replay, compress, distill, graph). They must
 * not DELETE. Frozen is archive; Tombstone is only forget/TTL/privacy.
 *
 * NREM Phase 1: Replay recently accessed hot leaves (count only; no I/S write)
 * NREM Phase 2: R/Value tiers (MEM-15; no tombstone, no leftover I write)
 * NREM Phase 3: Compress cold-tier memories
 * REM Phase: Episodic-to-semantic distillation
 * Post-sleep: Graph strengthening
 * φ₇: Refit channel weights, isotonic θ, ✓ parameters
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
import { refitCalibration, type CalibrationRefitResult } from "./calibration.js";
import { runRefit, type RefitRunResult } from "./refit.js";
import { contentWords } from "./RetrievalQuery.js";
import { recomputeMemoryTiers } from "./store/tiers.js";
import { forBindChunks, sqlPlaceholders } from "./store/sqlChunks.js";
import { checkStoreInvariants, type StoreInvariantReport } from "./invariants.js";
import type {
  ConsolidationResult,
  SleepSubPhaseCounts,
} from "./types.js";

export type SleepCycleTrigger = "timer" | "idle" | "manual";

export interface SleepCycleOptions {
  trigger?: SleepCycleTrigger;
  sessionId?: string;
}

export interface SleepCycleResult extends ConsolidationResult {
  replayed: number;
  strengthened: number;
  distilled: number;
  edges_strengthened: number;
  compressed: number;
  /** MEM-74: near-duplicates merged this cycle. */
  deduped: number;
  /** MEM-74: contradictions superseded this cycle. */
  contradictions: number;
  /** MEM-74: forests whose lazy summary text was refreshed. */
  tree_refreshed: number;
  trigger: SleepCycleTrigger;
  scope: string | null;
  /** Breakdown of each sleep sub-phase (IMP-06). */
  sub_phases: SleepSubPhaseCounts;
  /** φ₇ attribution refit of w_s and calibrated θ (MEM-18). */
  refit?: AttributionRefitResult;
  /** MEM-61: isotonic fits written this cycle. */
  calibration?: CalibrationRefitResult;
  /** MEM-62: guarded parameter refit report. */
  param_refit?: RefitRunResult;
  /** Reachability ∧ Losslessness ∧ Freshness ∧ Erasure after this cycle. */
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
  static async runCycle(options: SleepCycleOptions = {}): Promise<SleepCycleResult> {
    const trigger = options.trigger ?? "manual";
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
      deduped: 0,
      contradictions: 0,
      tree_refreshed: 0,
      trigger,
      scope: options.sessionId ?? null,
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

    await BrainStore.auditLog("sleep:start", "sleep", options.sessionId ?? null, {
      trigger,
      order: "dedup,reconcile,tree,index,archive,refit",
    }).catch(() => {});

    // φ₇.1 dedup near-duplicates (MERGE). Never DELETE.
    result.deduped = await SleepConsolidation.dedupNearDuplicates(options.sessionId);
    await BrainStore.auditLog("sleep:dedup", "sleep", options.sessionId ?? null, {
      deduped: result.deduped,
    }).catch(() => {});

    // φ₇.2 reconcile / contradiction scan (SUPERSEDE valid_to). Never DELETE.
    result.contradictions = await SleepConsolidation.scanContradictions(options.sessionId);
    await BrainStore.auditLog("sleep:reconcile", "sleep", options.sessionId ?? null, {
      contradictions: result.contradictions,
    }).catch(() => {});

    // φ₇.3 tree: ingest unlinked leaves + lazy summary text (MEM-53 / MEM-74).
    result.tree_refreshed = await SleepConsolidation.refreshTree(options.sessionId);
    await BrainStore.auditLog("sleep:tree", "sleep", options.sessionId ?? null, {
      tree_refreshed: result.tree_refreshed,
    }).catch(() => {});

    // φ₇.4 lexical index refresh (live FTS + Frozen segment).
    await SleepConsolidation.refreshLexicalIndex();
    await BrainStore.auditLog("sleep:index", "sleep", options.sessionId ?? null, {
      ok: true,
    }).catch(() => {});

    // NREM-1 replay (count only).
    result.replayed = await SleepConsolidation.nremReplay();
    result.sub_phases.nrem_replay = result.replayed;

    // φ₇.5 archive Value < θ_arch (Frozen, not tombstone).
    const decayResult = await SleepConsolidation.nremDecay();
    result.demoted = decayResult.demoted;
    result.pruned = 0;
    result.promoted = decayResult.promoted;
    result.sub_phases.nrem_decay_demoted = decayResult.demoted;
    result.sub_phases.nrem_decay_pruned = 0;
    await BrainStore.auditLog("sleep:archive", "sleep", options.sessionId ?? null, {
      demoted: result.demoted,
      promoted: result.promoted,
    }).catch(() => {});

    // NREM-3 / Frozen pointers. Originals stay.
    result.compressed = await SleepConsolidation.nremCompress();
    result.sub_phases.nrem_compress = result.compressed;

    // REM distill.
    result.distilled = await SleepConsolidation.remDistill();
    result.sub_phases.rem_distill = result.distilled;

    result.edges_strengthened = await SleepConsolidation.strengthenGraph();
    result.sub_phases.graph_strengthen = result.edges_strengthened;

    await SleepConsolidation.promoteHighValue();
    result.sub_phases.promote = result.promoted;

    // φ₇.6 refit.
    result.refit = await SleepConsolidation.refitAttributionPriors();
    result.sub_phases.refit = result.refit?.rows ?? 0;

    // MEM-59: finish queued ablation probes (opt-in, budgeted) so their rows
    // are in the log before the calibration and parameter refits read it.
    await SleepConsolidation.drainAblations();

    // MEM-61: isotonic fit of score -> P(helpful), IPW-weighted, per scope + global.
    result.calibration = await SleepConsolidation.refitCalibrationFits();

    // MEM-62: bounded, guarded refit of the ✓ parameters.
    result.param_refit = await SleepConsolidation.refitParameters();

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

  // ── φ₇.1 Dedup ─────────────────────────────────────────────────────────────

  /**
   * MERGE near-duplicates in the same scope. Closes valid_to on the extra
   * row; never DELETEs. Sleep archives by Value; forget is a separate path.
   */
  private static async dedupNearDuplicates(sessionId?: string): Promise<number> {
    try {
      const db = await BrainStore.get();
      const rows = (await db.all(
        sessionId
          ? `SELECT id, category, title, content, keywords, source_session_id, scope_key
             FROM brain_semantic
             WHERE tombstoned_at IS NULL AND valid_to IS NULL AND source_session_id = ?
             ORDER BY id ASC`
          : `SELECT id, category, title, content, keywords, source_session_id, scope_key
             FROM brain_semantic
             WHERE tombstoned_at IS NULL AND valid_to IS NULL
             ORDER BY id ASC LIMIT 400`,
        sessionId ? [sessionId] : [],
      )) as Array<{
        id: number;
        category: string;
        title: string;
        content: string;
        keywords: string;
        source_session_id: string | null;
        scope_key: string | null;
      }>;
      let merged = 0;
      const closed = new Set<number>();
      for (let i = 0; i < rows.length; i++) {
        if (closed.has(rows[i].id)) continue;
        const dups = await BrainStore.findDuplicates(
          rows[i].title,
          rows[i].keywords,
          rows[i].category as never,
        );
        for (const dup of dups) {
          if (dup.id === rows[i].id || closed.has(dup.id)) continue;
          if (dup.similarity < 0.85) continue;
          await db.run(
            `UPDATE brain_semantic SET valid_to = datetime('now') WHERE id = ? AND valid_to IS NULL`,
            [dup.id],
          );
          closed.add(dup.id);
          merged++;
        }
      }
      return merged;
    } catch {
      return 0;
    }
  }

  /**
   * Close valid_to on a live fact that contradicts a later one in the same
   * category. SUPERSEDE, not DELETE.
   */
  private static async scanContradictions(sessionId?: string): Promise<number> {
    try {
      const { CONTRADICTION_CATEGORIES, conflictsWith } = await import("./memoryOutcomes.js");
      const db = await BrainStore.get();
      const rows = (await db.all(
        sessionId
          ? `SELECT id, category, title, content FROM brain_semantic
             WHERE tombstoned_at IS NULL AND valid_to IS NULL AND source_session_id = ?
             ORDER BY id ASC`
          : `SELECT id, category, title, content FROM brain_semantic
             WHERE tombstoned_at IS NULL AND valid_to IS NULL
             ORDER BY id ASC LIMIT 400`,
        sessionId ? [sessionId] : [],
      )) as Array<{ id: number; category: string; title: string; content: string }>;
      let n = 0;
      for (let i = 0; i < rows.length; i++) {
        if (!CONTRADICTION_CATEGORIES.has(rows[i].category as never)) continue;
        for (let j = i + 1; j < rows.length; j++) {
          if (rows[i].category !== rows[j].category) continue;
          if (!conflictsWith(rows[j], rows[i])) continue;
          await db.run(
            `UPDATE brain_semantic SET valid_to = datetime('now') WHERE id = ? AND valid_to IS NULL`,
            [rows[i].id],
          );
          n++;
          break;
        }
      }
      return n;
    } catch {
      return 0;
    }
  }

  private static async refreshTree(sessionId?: string): Promise<number> {
    try {
      const { ingestSessionLeaves, refreshLazySummaryText } = await import("./SummaryTree.js");
      if (sessionId) {
        await ingestSessionLeaves(sessionId);
        return refreshLazySummaryText(sessionId);
      }
      const db = await BrainStore.get();
      const sessions = (await db.all(
        `SELECT id FROM brain_sessions ORDER BY updated_at DESC LIMIT 20`,
      )) as Array<{ id: string }>;
      for (const s of sessions) {
        await ingestSessionLeaves(s.id);
      }
      return refreshLazySummaryText();
    } catch {
      return 0;
    }
  }

  private static async refreshLexicalIndex(): Promise<void> {
    try {
      const db = await BrainStore.get();
      const { RetrievalFusion } = await import("./RetrievalFusion.js");
      await RetrievalFusion.rebuildFts5(db);
      const { syncFrozenSegment } = await import("./store/frozenSegment.js");
      await syncFrozenSegment(db);
    } catch {
      // Index refresh is best-effort; next heal can rebuild.
    }
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
   * Write summary-tree pointers for cold and Frozen leaves. Originals stay intact.
   */
  private static async nremCompress(): Promise<number> {
    let n = 0;
    try {
      n += await BrainStore.compressColdTier();
    } catch {
      // Pointer writes are best-effort.
    }
    try {
      n += await BrainStore.compressFrozenSegment();
    } catch {
      // Frozen pointers are additive.
    }
    return n;
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
          await forBindChunks(ids, 1, async (chunk) => {
            await db.run(
              `UPDATE brain_episodic SET parent_id = ? WHERE id IN (${sqlPlaceholders(chunk.length)}) AND parent_id IS NULL`,
              [insightId, ...chunk],
            );
          });
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
   * Track θ as the running P(helpful | injected) in `calibrated_theta` (diagnostic;
   * MEM-61 replaced the live cut with an isotonic fit).
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
        // Diagnostic only (running P(helpful)). The live cut is the isotonic fit
        // (MEM-61); `retrieval_threshold` is θ in P̂ ≥ θ and only MEM-62 refits it.
        await BrainStore.saveConfig("calibrated_theta", String(result.theta));
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

  private static async drainAblations(): Promise<void> {
    try {
      if (!BrainStore.getConfig().ablation_enabled) return;
      const { drainAblationQueue } = await import("./ablation.js");
      await drainAblationQueue();
    } catch (error) {
      console.warn("[Sleep] Ablation drain failed:", error instanceof Error ? error.message : error);
    }
  }

  private static async refitCalibrationFits(): Promise<CalibrationRefitResult | undefined> {
    try {
      const db = await BrainStore.get();
      const result = await refitCalibration(db);
      await BrainStore.auditLog("refit", "calibration", null, {
        samples: result.samples,
        global_n: result.global_n,
        scopes: result.scopes.length,
      }).catch(() => {});
      return result;
    } catch (error) {
      console.warn("[Sleep] Calibration refit failed:", error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private static async refitParameters(): Promise<RefitRunResult | undefined> {
    try {
      const db = await BrainStore.get();
      const result = await runRefit(db, {
        getConfig: () => BrainStore.getConfig() as unknown as Record<string, unknown>,
        saveConfig: (key, value) => BrainStore.saveConfig(key as never, value),
        auditLog: (action, kind, id, details) => BrainStore.auditLog(action, kind, id, details),
      });
      return result;
    } catch (error) {
      console.warn("[Sleep] Parameter refit failed:", error instanceof Error ? error.message : error);
      return undefined;
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
