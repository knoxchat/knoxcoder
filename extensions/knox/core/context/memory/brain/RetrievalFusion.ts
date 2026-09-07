import { BrainStore } from "./BrainStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import {
  detectFusionWeights,
  getFusionParams,
  getMemoryConfig,
  type FusionWeights,
} from "./memoryConfigAccess.js";
import { expandQuerySynonyms, getSynonymAdditions } from "./EnhancedSemantic.js";
import {
  capGraphContribution,
  entityNameMatchesMemory,
  hasGraphExpandableTokens,
  shouldJoinEntityToMemories,
} from "./GraphRetrieval.js";
import { evaluateRelevanceGate, LEXICAL_SCORE_MIN, resolveQueryEntities, applyMismatchPenalty, isMismatchActive } from "./RelevanceGate.js";
import { buildFts5Query as buildRetrievalFts5Query, contentWords, FTS5_AND_TERM_CAP } from "./RetrievalQuery.js";
import type { RetrievalIntent } from "./RetrievalQuery.js";
export type { FusionWeights } from "./memoryConfigAccess.js";
import type { SemanticMemory, EpisodicMemory, SemanticCategory } from "./types.js";
import type { DatabaseConnection } from "../../../util/refreshIndex.js";

/**
 * RetrievalFusion — Multi-strategy local retrieval (BM25 + trigram + graph).
 *
 * Combines proven text-retrieval strategies — no vector stores or ML models:
 *
 * 1. **FTS5 BM25** — SQLite full-text search with Okapi BM25 ranking
 * 2. **Trigram Similarity** — Character-level n-gram overlap for fuzzy matching
 * 3. **Graph Traversal** — Spreading activation through the knowledge graph
 * 4. **Recency Decay** — Exponential time-based weighting
 * 5. **Importance Boost** — User-assigned and system-scored importance
 *
 * Score scale (REL-02): every component is in [0, 1] with an *absolute* mapping
 * so θ is comparable across queries. BM25 is `1 - e^(-k·raw)` on negated FTS5
 * bm25() — never min-max stretched within the current hit list. Recency and
 * importance may rank but cannot qualify a miss: their weighted sum is capped
 * at θ − 0.05. Graph is also capped unless fts5+trigram already meets the
 * REL-03 lexical floor, so a common-noun graph hit cannot clear θ alone.
 *
 * Final score: S = w1·BM25 + w2·Trigram + cap(w3·Graph) + min(w4·Recency + w5·Importance, θ−0.05)
 *
 * REL-11: graph cannot lift a weak/zero-lexical candidate over θ. Neighbor→memory
 * joins use word-boundary matches and skip common-noun names (`file`, `config`, …).
 *
 * REL-09 weight profiles: recency + importance is always < θ, so a mismatch
 * cannot qualify. Continuation uses a dedicated profile (high recency *within*
 * the gated set). Conversational favors lexical (fts5) over recency.
 *
 * Works fully offline with zero model loading.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface FusionResult {
  id: number;
  type: "semantic" | "episodic";
  score: number;
  scores: {
    fts5: number;
    trigram: number;
    graph: number;
    recency: number;
    importance: number;
  };
  data: SemanticMemory | EpisodicMemory;
}

export interface FusionOptions {
  query: string;
  category?: SemanticCategory;
  sessionId?: string;
  /** When set, restrict results to these session IDs (project scope). */
  projectSessionIds?: string[];
  limit?: number;
  minScore?: number;
  includeEpisodic?: boolean;
  weights?: Partial<FusionWeights>;
  /** REL-05: current topic for same-topic boost. Fetched from session when omitted. */
  currentTopicId?: number | null;
  /** REL-13: current open task for same-task boost. Fetched from session when omitted. */
  currentTaskId?: string | null;
  /** REL-01/REL-09: continuation vs new-task. When omitted, inferred from originalQuery/query. */
  intent?: RetrievalIntent;
  /** Original user text for profile detection (search query may be expanded/stripped). */
  originalQuery?: string;
}

/** Additive score for memories tagged with the active topic (after REL-03 gate). */
export const TOPIC_SAME_BOOST = 0.12;
/** Penalty for other topics in the same session. Does not drop the candidate. */
export const TOPIC_OTHER_PENALTY = 0.08;
/** Additive score for memories tagged with the open task (after REL-03 / REL-05). */
export const TASK_SAME_BOOST = 0.18;

/**
 * Scale for `normalizeBm25`: S = 1 − e^(−k·raw) on negated FTS5 bm25().
 * k=1 maps raw≈0.7 → ~0.5, raw≈2.3 → ~0.9. Independent of hit-list size.
 */
export const BM25_SCALE_K = 1.0;

/** Recency+importance may not reach θ by themselves (REL-02). */
export const RECENCY_IMPORTANCE_THETA_MARGIN = 0.05;

/**
 * Absolute BM25 → [0, 1]. Does not depend on other hits in the result set.
 */
export function normalizeBm25(raw: number, k = BM25_SCALE_K): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const scaled = 1 - Math.exp(-k * raw);
  return scaled > 1 ? 1 : scaled;
}

/**
 * Weighted fusion with recency/importance cap at θ − margin.
 * Lexical (fts5 + trigram) or graph must supply the rest to clear θ.
 */
export function fuseCandidateScore(
  scores: FusionResult["scores"],
  weights: FusionWeights,
  theta: number,
): number {
  const textLexical = weights.fts5 * scores.fts5 + weights.trigram * scores.trigram;
  const recencyImportance =
    weights.recency * scores.recency + weights.importance * scores.importance;
  const riCap = Math.max(0, theta - RECENCY_IMPORTANCE_THETA_MARGIN);
  const ri = Math.min(recencyImportance, riCap);
  const graphPart = capGraphContribution(
    textLexical,
    weights.graph * scores.graph,
    ri,
    theta,
    scores.fts5,
    scores.trigram,
    LEXICAL_SCORE_MIN,
    RECENCY_IMPORTANCE_THETA_MARGIN,
  );
  return textLexical + graphPart + ri;
}

/**
 * REL-05: after the mismatch gate, boost the current topic and penalize
 * other topics in the same session. Never hard-excludes (user may refer back).
 */
export function applyTopicBias(
  results: FusionResult[],
  opts: { currentTopicId: number; sessionId: string },
): FusionResult[] {
  for (const result of results) {
    if (result.type !== "semantic") continue;
    const data = result.data as SemanticMemory;
    const topicId = data.topic_id;
    if (topicId == null) continue;
    if (topicId === opts.currentTopicId) {
      result.score += TOPIC_SAME_BOOST;
    } else if (data.source_session_id === opts.sessionId) {
      result.score = Math.max(0, result.score - TOPIC_OTHER_PENALTY);
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

/**
 * REL-13: after the gate (and topic bias), boost the open task above the
 * current topic. Never hard-excludes other tasks.
 */
export function applyTaskBias(
  results: FusionResult[],
  opts: { currentTaskId: string },
): FusionResult[] {
  for (const result of results) {
    if (result.type !== "semantic") continue;
    const data = result.data as SemanticMemory;
    if (data.task_id === opts.currentTaskId) {
      result.score += TASK_SAME_BOOST;
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

// ── Retrieval Fusion Engine ──────────────────────────────────────────────────

export class RetrievalFusion {

  // ── FTS5 Table Management ──────────────────────────────────────────────────

  /**
   * Create FTS5 virtual tables for full-text search.
   * Called during BrainStore initialization.
   */
  static async initFts5Tables(db: DatabaseConnection): Promise<void> {
    // FTS5 for semantic memory
    await db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS brain_semantic_fts USING fts5(
        title,
        content,
        keywords,
        content='brain_semantic',
        content_rowid='id',
        tokenize='porter unicode61 remove_diacritics 2'
      )
    `);

    // FTS5 for episodic memory
    await db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS brain_episodic_fts USING fts5(
        content,
        content='brain_episodic',
        content_rowid='id',
        tokenize='porter unicode61 remove_diacritics 2'
      )
    `);

    // Triggers to keep FTS5 tables in sync with source tables
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS brain_semantic_fts_insert AFTER INSERT ON brain_semantic BEGIN
        INSERT INTO brain_semantic_fts(rowid, title, content, keywords) VALUES (new.id, new.title, new.content, new.keywords);
      END
    `);

    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS brain_semantic_fts_delete AFTER DELETE ON brain_semantic BEGIN
        INSERT INTO brain_semantic_fts(brain_semantic_fts, rowid, title, content, keywords) VALUES ('delete', old.id, old.title, old.content, old.keywords);
      END
    `);

    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS brain_semantic_fts_update AFTER UPDATE ON brain_semantic BEGIN
        INSERT INTO brain_semantic_fts(brain_semantic_fts, rowid, title, content, keywords) VALUES ('delete', old.id, old.title, old.content, old.keywords);
        INSERT INTO brain_semantic_fts(rowid, title, content, keywords) VALUES (new.id, new.title, new.content, new.keywords);
      END
    `);

    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS brain_episodic_fts_insert AFTER INSERT ON brain_episodic BEGIN
        INSERT INTO brain_episodic_fts(rowid, content) VALUES (new.id, new.content);
      END
    `);

    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS brain_episodic_fts_delete AFTER DELETE ON brain_episodic BEGIN
        INSERT INTO brain_episodic_fts(brain_episodic_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END
    `);

    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS brain_episodic_fts_update AFTER UPDATE ON brain_episodic BEGIN
        INSERT INTO brain_episodic_fts(brain_episodic_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO brain_episodic_fts(rowid, content) VALUES (new.id, new.content);
      END
    `);
  }

  /**
   * Rebuild FTS5 indexes from scratch (for migration from pre-FTS5 data).
   */
  static async rebuildFts5(db: DatabaseConnection): Promise<{ semantic: number; episodic: number }> {
    // Clear and repopulate semantic FTS
    await db.exec(`INSERT INTO brain_semantic_fts(brain_semantic_fts) VALUES ('delete-all')`);
    const semResult = await db.run(`
      INSERT INTO brain_semantic_fts(rowid, title, content, keywords)
      SELECT id, title, content, keywords FROM brain_semantic
    `);

    // Clear and repopulate episodic FTS
    await db.exec(`INSERT INTO brain_episodic_fts(brain_episodic_fts) VALUES ('delete-all')`);
    const epResult = await db.run(`
      INSERT INTO brain_episodic_fts(rowid, content)
      SELECT id, content FROM brain_episodic
    `);

    return {
      semantic: semResult.changes ?? 0,
      episodic: epResult.changes ?? 0,
    };
  }

  // ── Multi-Strategy Fusion Search ───────────────────────────────────────────

  /**
   * Main fusion search entry point.
   * Combines FTS5, trigram, graph, recency, and importance scores.
   */
  static async search(options: FusionOptions): Promise<FusionResult[]> {
    const db = await BrainStore.get();
    const config = getMemoryConfig();
    const fusionParams = getFusionParams();
    const limit = options.limit ?? config.retrieval_top_k;
    const minScore = options.minScore;
    const candidateLimit = Math.max(
      limit * fusionParams.candidateMultiplier,
      fusionParams.candidateMin,
    );

    // REL-01: never concatenate synonyms into the AND query. OR them in FTS5 only.
    const searchQuery = options.query;
    const synonymExtras = config.enable_enhanced_semantic
      ? getSynonymAdditions(searchQuery, { continuation: options.intent === "continuation" })
      : [];
    const trigramQuery = synonymExtras.length > 0
      ? expandQuerySynonyms(searchQuery, { continuation: options.intent === "continuation" })
      : searchQuery;

    const detected = detectFusionWeights(searchQuery, {
      intent: options.intent,
      originalQuery: options.originalQuery,
    });
    const weights = options.weights
      ? { ...detected, ...options.weights }
      : detected;

    // 1. FTS5 BM25 search
    const fts5Semantic = await RetrievalFusion.fts5SearchSemantic(
      db, searchQuery, options.category, candidateLimit, synonymExtras,
    );

    const fts5Episodic = options.includeEpisodic !== false
      ? await RetrievalFusion.fts5SearchEpisodic(
          db, searchQuery, options.sessionId, candidateLimit, synonymExtras,
        )
      : [];

    // 2. Trigram fuzzy search (for candidates not found by FTS5)
    const trigramSemantic = await RetrievalFusion.trigramSearchSemantic(
      db, trigramQuery, options.category, Math.floor(candidateLimit / 2),
    );

    // 3. Graph-based expansion
    const graphIds = await RetrievalFusion.graphExpansion(searchQuery);

    // 4. Merge and score all candidates
    const candidateMap = new Map<string, FusionResult>();

    // Add FTS5 semantic results
    for (const item of fts5Semantic) {
      const key = `semantic:${item.id}`;
      candidateMap.set(key, {
        id: item.id,
        type: "semantic",
        score: 0,
        scores: { fts5: item.bm25Score, trigram: 0, graph: 0, recency: 0, importance: 0 },
        data: item.memory,
      });
    }

    // Add FTS5 episodic results
    for (const item of fts5Episodic) {
      const key = `episodic:${item.id}`;
      candidateMap.set(key, {
        id: item.id,
        type: "episodic",
        score: 0,
        scores: { fts5: item.bm25Score, trigram: 0, graph: 0, recency: 0, importance: 0 },
        data: item.memory,
      });
    }

    // Merge trigram results
    for (const item of trigramSemantic) {
      const key = `semantic:${item.id}`;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.scores.trigram = item.similarity;
      } else {
        candidateMap.set(key, {
          id: item.id,
          type: "semantic",
          score: 0,
          scores: { fts5: 0, trigram: item.similarity, graph: 0, recency: 0, importance: 0 },
          data: item.memory,
        });
      }
    }

    // Apply graph scores
    for (const [memId, graphScore] of graphIds) {
      const key = `semantic:${memId}`;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.scores.graph = graphScore;
      }
    }

    // Compute recency and importance for all candidates
    const now = Date.now();
    const theta = minScore ?? config.retrieval_threshold;
    for (const candidate of candidateMap.values()) {
      const data = candidate.data;
      const createdAt = new Date(data.created_at).getTime();
      const ageHours = (now - createdAt) / 3600000;

      // Exponential recency decay: score = e^(-λt)
      candidate.scores.recency = Math.exp(-fusionParams.recencyDecayLambda * ageHours);

      // Importance from data
      candidate.scores.importance = data.importance_score ?? 0.5;

      candidate.score = fuseCandidateScore(candidate.scores, weights, theta);
    }

    const pinnedIds = new Set(
      (await BrainStore.searchByTag("pinned", "semantic", 500)).map((t) => t.memory_id),
    );
    const currentTopicId =
      options.currentTopicId ??
      (options.sessionId
        ? (await BrainStore.getLatestSessionTopic(options.sessionId))?.id ?? null
        : null);

    for (const candidate of candidateMap.values()) {
      if (candidate.type !== "semantic") continue;
      const sem = candidate.data as SemanticMemory;
      candidate.score = applyMismatchPenalty(
        candidate.score,
        sem.mismatch_count,
        pinnedIds.has(sem.id),
      );
    }

    // Sort by fusion score, apply θ threshold, then REL-03 mismatch gate, then top-K
    let results = Array.from(candidateMap.values())
      .sort((a, b) => b.score - a.score)
      .filter((r) => minScore === undefined || r.score >= minScore);

    // Project scope (IMP-25): episodic must belong to project sessions; semantic must have project source_session_id
    if (options.projectSessionIds !== undefined) {
      const allowed = new Set(options.projectSessionIds);
      if (allowed.size === 0) {
        results = [];
      } else {
        results = results.filter((r) => {
          if (r.type === "episodic") {
            return allowed.has((r.data as EpisodicMemory).session_id);
          }
          const sourceSession = (r.data as SemanticMemory).source_session_id;
          return Boolean(sourceSession && allowed.has(sourceSession));
        });
      }
    }

    const queryEntities = await resolveQueryEntities(searchQuery);
    const requireLexical = config.retrieval_require_lexical !== false;
    results = results.filter((r) => {
      const sem = r.type === "semantic" ? (r.data as SemanticMemory) : undefined;
      const ep = r.type === "episodic" ? (r.data as EpisodicMemory) : undefined;
      const pinned = sem ? pinnedIds.has(sem.id) : false;
      const demoted = sem ? isMismatchActive(sem, currentTopicId) && !pinned : false;
      return evaluateRelevanceGate({
        query: searchQuery,
        title: sem?.title,
        keywords: sem?.keywords,
        content: sem?.content ?? ep?.content,
        fts5: r.scores.fts5,
        trigram: r.scores.trigram,
        queryEntities,
        pinned,
        requireLexical,
        demoted,
      }).passed;
    });

    // REL-05: topic boost/penalty after the gate, before top-K
    if (config.memory_scope === "project" && options.sessionId) {
      if (currentTopicId != null) {
        results = applyTopicBias(results, {
          currentTopicId,
          sessionId: options.sessionId,
        });
      }
    }

    // REL-13: current task outranks topic (after the gate)
    const taskId =
      options.currentTaskId ??
      (options.sessionId
        ? (await BrainStore.getOpenTask(options.sessionId))?.id ?? null
        : null);
    if (taskId) {
      results = applyTaskBias(results, { currentTaskId: taskId });
    }

    results = results.slice(0, limit);

    // REL-12: bump only semantic hits that passed REL-03 and still score ≥ θ
    // (topic bias may drop a gated hit below θ — those must not pollute rank).
    const bumpThreshold = config.retrieval_threshold;
    const semanticIds = results
      .filter((r) => r.type === "semantic" && r.score >= bumpThreshold)
      .map((r) => r.id);
    await BrainStore.touchSemanticRetrieval(semanticIds);

    return results;
  }

  // ── FTS5 Search Strategies ─────────────────────────────────────────────────

  private static async fts5SearchSemantic(
    db: DatabaseConnection,
    query: string,
    category: SemanticCategory | undefined,
    limit: number,
    extraOrTerms: string[] = [],
  ): Promise<Array<{ id: number; bm25Score: number; memory: SemanticMemory }>> {
    const ftsQuery = RetrievalFusion.buildFts5Query(query, extraOrTerms);
    if (!ftsQuery) return [];

    try {
      const conditions = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
      const params: any[] = [];

      if (category) {
        conditions.push("s.category = ?");
        params.push(category);
      }

      params.push(ftsQuery, limit);

      // Use FTS5 with BM25 ranking
      // bm25() returns negative values (more negative = more relevant), so we negate
      const rows = await db.all(`
        SELECT s.*, -bm25(brain_semantic_fts, 5.0, 1.0, 3.0) AS bm25_score
        FROM brain_semantic s
        JOIN brain_semantic_fts fts ON s.id = fts.rowid
        WHERE ${conditions.join(" AND ")}
          AND brain_semantic_fts MATCH ?
        ORDER BY bm25_score DESC
        LIMIT ?
      `, params);

      return rows.map((r: any) => ({
        id: r.id,
        bm25Score: normalizeBm25(Number(r.bm25_score) || 0),
        memory: RetrievalFusion.rowToSemantic(r),
      }));
    } catch {
      // FTS5 might not be available (older SQLite), fall back to LIKE
      return [];
    }
  }

  private static async fts5SearchEpisodic(
    db: DatabaseConnection,
    query: string,
    sessionId: string | undefined,
    limit: number,
    extraOrTerms: string[] = [],
  ): Promise<Array<{ id: number; bm25Score: number; memory: EpisodicMemory }>> {
    const ftsQuery = RetrievalFusion.buildFts5Query(query, extraOrTerms);
    if (!ftsQuery) return [];

    try {
      // Parameters must follow placeholder order: MATCH ?, then extra
      // conditions, then LIMIT ?.
      const extraConditions: string[] = [];
      const extraParams: any[] = [];

      if (sessionId) {
        extraConditions.push("e.session_id = ?");
        extraParams.push(sessionId);
      }

      const whereExtra = extraConditions.length > 0 ? ` AND ${extraConditions.join(" AND ")}` : "";

      const rows = await db.all(`
        SELECT e.*, -bm25(brain_episodic_fts) AS bm25_score
        FROM brain_episodic e
        JOIN brain_episodic_fts fts ON e.id = fts.rowid
        WHERE brain_episodic_fts MATCH ?${whereExtra}
        ORDER BY bm25_score DESC
        LIMIT ?
      `, [ftsQuery, ...extraParams, limit]);

      return rows.map((r: any) => ({
        id: r.id,
        bm25Score: normalizeBm25(Number(r.bm25_score) || 0),
        memory: RetrievalFusion.rowToEpisodic(r),
      }));
    } catch {
      return [];
    }
  }

  // ── Trigram Similarity ─────────────────────────────────────────────────────

  /**
   * Trigram similarity search — fuzzy matching at the character level.
   * Generates 3-character sliding windows and computes Jaccard similarity.
   * Excellent for code identifiers, partial matches, and typo tolerance.
   */
  private static async trigramSearchSemantic(
    db: DatabaseConnection,
    query: string,
    category: SemanticCategory | undefined,
    limit: number,
  ): Promise<Array<{ id: number; similarity: number; memory: SemanticMemory }>> {
    const queryTrigrams = RetrievalFusion.generateTrigrams(query.toLowerCase());
    if (queryTrigrams.size === 0) return [];

    // Fetch candidate rows (use existing indexes for pre-filtering)
    const conditions = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
    const params: any[] = [];

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    // Pre-filter with simple LIKE on first few meaningful terms to avoid scanning entire table
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2).slice(0, 3);
    if (terms.length > 0) {
      const likeConditions = terms.map(() => "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)");
      conditions.push(`(${likeConditions.join(" OR ")})`);
      for (const term of terms) {
        const like = `%${term}%`;
        params.push(like, like, like);
      }
    }

    params.push(limit * 3);

    const rows = await db.all(`
      SELECT * FROM brain_semantic
      WHERE ${conditions.join(" AND ")}
      ORDER BY importance_score DESC
      LIMIT ?
    `, params);

    // Compute trigram similarity for each candidate
    const scored = rows.map((r: any) => {
      const docText = `${r.title} ${r.content} ${r.keywords}`.toLowerCase();
      const docTrigrams = RetrievalFusion.generateTrigrams(docText);
      const similarity = RetrievalFusion.jaccardSimilarity(queryTrigrams, docTrigrams);
      return { id: r.id, similarity, memory: RetrievalFusion.rowToSemantic(r) };
    });

    return scored
      .filter((s) => s.similarity > 0.05)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  // ── Graph Expansion ────────────────────────────────────────────────────────

  /**
   * Find memories related through the knowledge graph.
   * Extracts entities from the query, then follows graph edges
   * to find semantically related memories.
   *
   * Returns a map of semantic memory IDs to graph relevance scores.
   */
  private static async graphExpansion(query: string): Promise<Map<number, number>> {
    const graphScores = new Map<number, number>();
    if (!hasGraphExpandableTokens(query)) return graphScores;

    const config = getMemoryConfig();
    const fusionParams = getFusionParams();
    const maxDepth = config.graph_max_depth;

    try {
      const entities = await KnowledgeGraph.searchEntities(
        query,
        undefined,
        fusionParams.graphEntitySearchLimit,
      );
      if (entities.length === 0) return graphScores;

      for (const entity of entities) {
        void BrainStore.touchEntity(entity.id);
        const neighbors = await KnowledgeGraph.explore({
          entity_id: entity.id,
          depth: maxDepth,
          limit: fusionParams.graphNeighborLimit,
        });

        const db = await BrainStore.get();
        const fetchLimit = Math.max(config.graph_neighbor_memory_limit * 3, 15);

        for (const neighbor of neighbors.entities) {
          if (!shouldJoinEntityToMemories(query, neighbor.name)) continue;

          const depth = neighbors.entity_depths[neighbor.id] ?? 0;
          const activation =
            neighbors.activation_scores[neighbor.id] ??
            neighbor.confidence * Math.pow(fusionParams.graphDepthDecayGamma, depth);

          const needle = neighbor.name.toLowerCase();
          const related = await db.all(
            `SELECT id, title, content, keywords FROM brain_semantic
             WHERE (LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)
             AND (expires_at IS NULL OR expires_at > datetime('now'))
             LIMIT ?`,
            [`%${needle}%`, `%${needle}%`, `%${needle}%`, fetchLimit],
          );

          let kept = 0;
          for (const r of related) {
            const row = r as { id: number; title?: string; content?: string; keywords?: string };
            const haystack = `${row.title ?? ""} ${row.content ?? ""} ${row.keywords ?? ""}`;
            if (!entityNameMatchesMemory(haystack, neighbor.name)) continue;
            const currentScore = graphScores.get(row.id) ?? 0;
            const neighborFactor = depth === 0
              ? 1.0
              : config.graph_indirect_neighbor_factor;
            const boost = activation * neighborFactor;
            graphScores.set(
              row.id,
              Math.min(1.0, currentScore + boost * fusionParams.graphMemoryBoostFactor),
            );
            kept++;
            if (kept >= config.graph_neighbor_memory_limit) break;
          }
        }
      }
    } catch {
      // Graph expansion is best-effort
    }

    return graphScores;
  }

  // ── Query Type Detection (delegates to config) ─────────────────────────────

  // ── FTS5 Query Builder ─────────────────────────────────────────────────────

  /**
   * Build a FTS5 MATCH query (REL-01): AND content words, strip stopwords,
   * quote hyphenated terms, OR optional synonym extras.
   */
  private static buildFts5Query(query: string, extraOrTerms: string[] = []): string | null {
    const config = getMemoryConfig();
    const termCount = contentWords(query).length;
    const useAnd =
      config.fts5_use_and_for_content !== false &&
      termCount > 0 &&
      termCount <= FTS5_AND_TERM_CAP;
    return buildRetrievalFts5Query(query, {
      useAnd,
      extraOrTerms,
    });
  }

  // ── Trigram Utilities ──────────────────────────────────────────────────────

  /**
   * Generate character trigrams from text.
   * Pads with spaces for prefix/suffix trigrams.
   */
  private static generateTrigrams(text: string): Set<string> {
    const trigrams = new Set<string>();
    const normalized = ` ${text.replace(/\s+/g, " ").trim()} `;
    for (let i = 0; i < normalized.length - 2; i++) {
      trigrams.add(normalized.substring(i, i + 3));
    }
    return trigrams;
  }

  /**
   * Jaccard similarity between two trigram sets.
   */
  private static jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const trigram of a) {
      if (b.has(trigram)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  // ── Row Mappers ────────────────────────────────────────────────────────────

  private static rowToSemantic(r: any): SemanticMemory {
    return {
      id: r.id,
      category: r.category,
      title: r.title,
      content: r.content,
      source_session_id: r.source_session_id,
      keywords: r.keywords,
      importance_score: r.importance_score,
      emotional_valence: r.emotional_valence ?? "neutral",
      salience: r.salience ?? 0.5,
      retrieval_count: r.retrieval_count,
      tier: r.tier,
      created_at: r.created_at,
      last_accessed_at: r.last_accessed_at,
      expires_at: r.expires_at,
      topic_id: r.topic_id ?? null,
      task_id: r.task_id ?? null,
      mismatch_count: r.mismatch_count ?? 0,
      mismatch_until: r.mismatch_until ?? null,
      mismatch_topic_id: r.mismatch_topic_id ?? null,
    };
  }

  private static rowToEpisodic(r: any): EpisodicMemory {
    return {
      id: r.id,
      session_id: r.session_id,
      type: r.type,
      role: r.role,
      content: r.content,
      token_count: r.token_count,
      importance_score: r.importance_score,
      emotional_valence: r.emotional_valence ?? "neutral",
      salience: r.salience ?? 0.5,
      tier: r.tier,
      metadata: r.metadata ?? "{}",
      created_at: r.created_at,
    };
  }

}
