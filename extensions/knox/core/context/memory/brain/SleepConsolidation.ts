/**
 * SleepConsolidation — REM/NREM-cycle memory replay, strengthening,
 * and episodic-to-semantic distillation.
 *
 * Mirrors Knox-MS NeuralMemory sleep consolidation patterns:
 * - NREM Phase 1: Replay and strengthen high-importance memories
 * - NREM Phase 2: Decay low-importance memories (Ebbinghaus curve)
 * - NREM Phase 3: Compress cold-tier memories
 * - REM Phase: Episodic-to-semantic distillation — find recurring patterns
 *   in episodic memories and extract stable knowledge into semantic memory
 * - Post-sleep: Graph strengthening (reinforce frequently co-activated edges)
 *
 * This runs as part of the consolidation pipeline (not time-based sleep).
 * Each invocation performs one full "sleep cycle".
 */

import { BrainStore } from "./BrainStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import { Ebbinghaus } from "./Ebbinghaus.js";
import { GRAPH_COMMON_NOUN_DENYLIST, isCommonNounEntityName } from "./GraphRetrieval.js";
import { contentWords } from "./RetrievalQuery.js";
import type {
  ConsolidationResult,
  EpisodicMemory,
  SemanticMemory,
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
      },
    };

    // Phase 1 (NREM-1): Replay — boost recently accessed important memories
    result.replayed = await SleepConsolidation.nremReplay();
    result.sub_phases.nrem_replay = result.replayed;

    // Phase 2 (NREM-2): Decay — apply Ebbinghaus forgetting curve
    const decayResult = await SleepConsolidation.nremDecay();
    result.demoted = decayResult.demoted;
    result.pruned = decayResult.pruned;
    result.sub_phases.nrem_decay_demoted = decayResult.demoted;
    result.sub_phases.nrem_decay_pruned = decayResult.pruned;

    // Phase 3 (NREM-3): Compress — compress cold-tier content
    result.compressed = await SleepConsolidation.nremCompress();
    result.sub_phases.nrem_compress = result.compressed;

    // Phase 4 (REM): Distill — extract recurring patterns from episodic memory
    result.distilled = await SleepConsolidation.remDistill();
    result.sub_phases.rem_distill = result.distilled;

    // Phase 5 (Post-sleep): Strengthen graph edges that co-occur frequently
    result.edges_strengthened = await SleepConsolidation.strengthenGraph();
    result.sub_phases.graph_strengthen = result.edges_strengthened;

    // Phase 6: Promote hot memories based on retrieval and salience
    result.promoted = await SleepConsolidation.promoteHighValue();
    result.sub_phases.promote = result.promoted;

    return result;
  }

  // ── NREM Phase 1: Replay ────────────────────────────────────────────────────

  /**
   * "Replay" recently accessed important memories by boosting their importance.
   * Simulates hippocampal replay during NREM sleep where important memories
   * get strengthened through reactivation.
   */
  private static async nremReplay(): Promise<number> {
    const db = await BrainStore.get();

    // Boost semantic memories that were accessed recently AND have high salience
    const result = await db.run(
      `UPDATE brain_semantic
       SET importance_score = MIN(1.0, importance_score + 0.05)
       WHERE tier = 'hot'
       AND last_accessed_at > datetime('now', '-1 day')
       AND retrieval_count >= 2
       AND (salience > 0.6 OR importance_score >= 0.7)`,
    );

    // Also boost high-salience episodic memories (emotional memories consolidate faster)
    const epResult = await db.run(
      `UPDATE brain_episodic
       SET importance_score = MIN(1.0, importance_score + 0.03)
       WHERE tier = 'hot'
       AND salience > 0.7
       AND created_at > datetime('now', '-2 days')`,
    );

    return (result.changes ?? 0) + (epResult.changes ?? 0);
  }

  // ── NREM Phase 2: Decay ────────────────────────────────────────────────────

  /**
   * Apply Ebbinghaus forgetting curve: R(t) = e^(-λt/S(m)).
   * Updates importance from retention; prunes when R(t) < θ_prune.
   */
  private static async nremDecay(): Promise<{ demoted: number; pruned: number }> {
    const db = await BrainStore.get();
    let demoted = 0;
    let pruned = 0;

    const notPinned = `id NOT IN (SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned')`;

    // Semantic: apply R(t) to importance_score
    const semanticRows = await db.all(
      `SELECT id, importance_score, retrieval_count, last_accessed_at, salience, tier
       FROM brain_semantic
       WHERE tier IN ('hot', 'warm') AND ${notPinned}`,
    );
    for (const row of semanticRows) {
      const r = row as any;
      const salience = r.salience ?? 0.5;
      const importance = r.importance_score ?? 0.5;
      const newImportance = Ebbinghaus.importanceFromRetention(
        importance,
        r.last_accessed_at,
        r.retrieval_count ?? 0,
        salience,
      );
      if (Math.abs(newImportance - importance) > 0.001) {
        await db.run(
          "UPDATE brain_semantic SET importance_score = ? WHERE id = ?",
          [newImportance, r.id],
        );
      }
      if (
        Ebbinghaus.shouldPrune(r.last_accessed_at, r.retrieval_count ?? 0, salience, importance)
        && r.tier === "warm"
      ) {
        await db.run("UPDATE brain_semantic SET tier = 'cold' WHERE id = ?", [r.id]);
        demoted++;
      }
    }

    // Episodic tier demotion (age + importance gates)
    const hotToWarm = await db.run(
      `UPDATE brain_episodic SET tier = 'warm'
       WHERE tier = 'hot' AND importance_score < 0.7
       AND COALESCE(salience, 0.5) < 0.7
       AND created_at < datetime('now', '-1 day')`,
    );
    demoted += hotToWarm.changes ?? 0;

    const warmToCold = await db.run(
      `UPDATE brain_episodic SET tier = 'cold'
       WHERE tier = 'warm' AND importance_score < 0.5
       AND created_at < datetime('now', '-7 days')`,
    );
    demoted += warmToCold.changes ?? 0;

    // Episodic prune: R(t) < θ_prune on cold tier
    const coldEpisodic = await db.all(
      `SELECT id, importance_score, salience, created_at FROM brain_episodic
       WHERE tier = 'cold' AND created_at < datetime('now', '-30 days')`,
    );
    for (const row of coldEpisodic) {
      const r = row as any;
      if (
        Ebbinghaus.shouldPrune(
          r.created_at,
          0,
          r.salience ?? 0.5,
          r.importance_score ?? 0.5,
        )
      ) {
        await db.run("DELETE FROM brain_episodic WHERE id = ?", [r.id]);
        pruned++;
      }
    }

    // Semantic: Hot → Warm (stale access)
    const semHotToWarm = await db.run(
      `UPDATE brain_semantic SET tier = 'warm'
       WHERE tier = 'hot' AND importance_score < 0.6
       AND last_accessed_at < datetime('now', '-7 days')
       AND ${notPinned}`,
    );
    demoted += semHotToWarm.changes ?? 0;

    // Semantic: retention-based prune on cold tier
    const coldSemantic = await db.all(
      `SELECT id, importance_score, retrieval_count, last_accessed_at, salience
       FROM brain_semantic WHERE tier = 'cold' AND ${notPinned}`,
    );
    for (const row of coldSemantic) {
      const r = row as any;
      if (
        Ebbinghaus.shouldPrune(
          r.last_accessed_at,
          r.retrieval_count ?? 0,
          r.salience ?? 0.5,
          r.importance_score ?? 0.5,
        )
      ) {
        await db.run("DELETE FROM brain_semantic WHERE id = ?", [r.id]);
        pruned++;
      }
    }

    // Prune expired semantic
    const prunedSemantic = await db.run(
      `DELETE FROM brain_semantic
       WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
       AND ${notPinned}`,
    );
    pruned += prunedSemantic.changes ?? 0;

    return { demoted, pruned };
  }

  // ── NREM Phase 3: Compress ─────────────────────────────────────────────────

  /**
   * Compress cold-tier memory content to save space.
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
        for (const sid of sids.slice(0, 3)) {
          const topMsg = await db.get(
            `SELECT content FROM brain_episodic
             WHERE session_id = ? AND LOWER(content) LIKE ?
             ORDER BY importance_score DESC LIMIT 1`,
            [sid, `%${keyword}%`],
          );
          if (topMsg) {
            representative.push((topMsg as { content: string }).content.substring(0, 200));
          }
        }
        if (representative.length < 2) continue;

        const title = `Recurring pattern: ${keyword}`;
        const content = `This topic appears across ${sids.length} conversation sessions. Key references:\n${representative.map((r, i) => `  ${i + 1}. ${r}`).join("\n")}`;

        await BrainStore.storeSemantic({
          category: "insight",
          title,
          content,
          keywords: keyword,
          importance: 0.6 + Math.min(sids.length * 0.05, 0.3),
          session_id: sids[0],
          topic_id: cluster.topicId,
        });
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

  // ── Post-Sleep: Promote High-Value ─────────────────────────────────────────

  /**
   * Promote high-value cold/warm memories back to hot tier.
   * Memories that are frequently accessed or have high salience get promoted.
   */
  private static async promoteHighValue(): Promise<number> {
    const db = await BrainStore.get();

    const result = await db.run(
      `UPDATE brain_semantic SET tier = 'hot'
       WHERE tier IN ('warm', 'cold')
       AND (
         (retrieval_count >= 5 AND last_accessed_at > datetime('now', '-3 days'))
         OR (COALESCE(salience, 0.5) >= 0.85 AND importance_score >= 0.8)
       )`,
    );

    return result.changes ?? 0;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private static extractKeywords(text: string): string[] {
    return contentWords(text).filter(
      (w) => w.length > 3 && !GRAPH_COMMON_NOUN_DENYLIST.has(w) && !isCommonNounEntityName(w),
    );
  }
}
