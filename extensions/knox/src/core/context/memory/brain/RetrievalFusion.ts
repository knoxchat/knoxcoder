import { BrainStore } from "./BrainStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import {
  getFusionParams,
  getMemoryConfig,
  getTheoremParams,
  getTheoremParamsV2,
  type FusionWeights,
} from "./memoryConfigAccess.js";
import { planAdmission, type AdmissionItem, type AdmissionRanked } from "./admission.js";
import {
  applyCalibratedCut,
  loadCalibration,
  predictIsotonic,
  type CalibrationSelection,
} from "./calibration.js";
import { scopeKeyForSession } from "./reconcile.js";
import { explorationAllowed, getExplorationRng, thompsonUtility, type Rng } from "./thompson.js";
import { expandQuerySynonyms, getSynonymAdditions } from "./EnhancedSemantic.js";
import {
  hasGraphExpandableTokens,
} from "./GraphRetrieval.js";
import { recipeMemoryIsVerified } from "../recipes/memoryLink.js";
import {
  FUSION_CHANNELS,
  loadOutcomes,
  loadSupersededIds,
  type ChannelWeights,
  type FusionChannel,
} from "./memoryOutcomes.js";
import { evaluateRelevanceGate, LEXICAL_SCORE_MIN, resolveQueryEntities, applyMismatchPenalty, isMismatchActive } from "./RelevanceGate.js";
import { cjkExpandSql } from "./cjkFts.js";
import { buildFts5Query as buildRetrievalFts5Query, contentWords, FTS5_AND_TERM_CAP } from "./RetrievalQuery.js";
import type { RetrievalIntent } from "./RetrievalQuery.js";
export type { FusionWeights } from "./memoryConfigAccess.js";
export type { ChannelWeights, FusionChannel } from "./memoryOutcomes.js";
import { isValidAt } from "./entityResolution.js";
import type { SemanticMemory, EpisodicMemory, SemanticCategory } from "./types.js";
import type { DatabaseConnection } from "../../../util/refreshIndex.js";
import { isLiveRetrieveRow } from "./store/tombstone.js";
import {
  getValueParams,
  isDefaultRetrieveValue,
  modulateRelevance,
  priorModulation,
  resolveInitialImportance,
  retrievabilityFromSource,
  utilityFromSource,
} from "./Value.js";
import { hasRipgrepHit, searchRipgrepChannel } from "./channels/ripgrep.js";
import { searchTreeChannel } from "./SummaryTree.js";
import { appendRelevanceScope, isUserGlobalCategory } from "./projectScope.js";
import { queryScopeClause } from "./store/validity.js";
import { mergeReservedCandidates, resolveReservedTreeSlots } from "./reservedSlots.js";
import {
  emptyChannelCost,
  setLastSearchMeta,
  timed,
  type ChannelCost,
} from "./channelCost.js";

/**
 * RetrievalFusion — Reciprocal Rank Fusion over lexical channels (MEM-20).
 *
 * Channels return ranked lists over the same rows. They are never added as
 * raw scores (BM25, trigram, graph activation, recency, and importance live
 * on different scales). Fusion is rank-only:
 *
 *   rel(m,q) = Σ_s w_s / (k₀ + rank_s(m)),  k₀ = 60
 *
 * A channel that did not return `m` contributes 0. REL-03: if the lexical
 * gate fails, rel = 0 (relevance-dominance — importance cannot resurrect a
 * miss). Synonym expansion stays inside the lexical channel.
 *
 * Live channels today: lexical (BM25-then-trigram), ripgrep (exact /
 * identifier hits on stored text + project files), graph (hub-damped PPR,
 * MEM-25), and the summary
 * tree (searchTreeChannel: beam over session pointers, MEM-24). Priors modulate, they do not
 * compete:
 * score = rel · (1 + η_U U) · (1 + η_R R) (MEM-21). Topic/task bias is a
 * small multiplier after the gate and cannot resurrect rel=0.
 * MEM-22 takes the top `fusion_candidate_cutoff` (50) fused candidates, then
 * cuts by calibrated θ (default 0.35). Raw RRF is ~1/61 at rank 1, so θ is
 * applied as a fraction of the active-channel RRF ceiling: keep
 * `score ≥ θ · Σ_s w_s/(k₀+1)` for channels that ranked this query.
 *
 * Works fully offline with zero model loading. No embeddings or neural rerank.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChannelRanks {
  lexical?: number;
  ripgrep?: number;
  graph?: number;
  tree?: number;
}

export interface FusionResult {
  id: number;
  type: "semantic" | "episodic";
  score: number;
  /** Raw RRF relevance before priors, mismatch, and topic/task. */
  rel?: number;
  /** Bounded utility U(m) used in MEM-21 prior modulation. */
  utility?: number;
  /** Retrievability R(t, S) used in MEM-21 prior modulation. */
  retrievability?: number;
  /** (1 + η_U U) · (1 + η_R R), in [1, (1+η_U)(1+η_R)]. */
  priorFactor?: number;
  /** Greedy U from counts, even on a call that explored with a Thompson draw (MEM-60). */
  utilityGreedy?: number;
  /** This call replaced U with a Thompson draw (MEM-60). */
  explored?: boolean;
  /** P(selected) under the greedy/Thompson mixture, logged for IPW (MEM-60). */
  propensity?: number;
  /** iso(score) when a fitted calibration cut this call (MEM-61). */
  calibrated_p?: number;
  /** MEM-66: kept because the tree routed it, not because it made the fused head. */
  reserved?: boolean;
  ranks?: ChannelRanks;
  channel?: FusionChannel;
  scores: {
    fts5: number;
    trigram: number;
    graph: number;
    recency: number;
    importance: number;
    /** MEM-23 ripgrep channel strength. Missing / 0 = not in the channel. */
    ripgrep?: number;
    /** MEM-24 summary-tree beam strength. Missing / 0 = not in the channel. */
    tree?: number;
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
  /** Override theorem channel weights for this search. */
  channelWeights?: Partial<ChannelWeights>;
  /** Override RRF k₀ for this search. */
  rrfK0?: number;
  /** REL-05: current topic for same-topic boost. Fetched from session when omitted. */
  currentTopicId?: number | null;
  /** REL-13: current open task for same-task boost. Fetched from session when omitted. */
  currentTaskId?: string | null;
  /** REL-01/REL-09: continuation vs new-task. When omitted, inferred from originalQuery/query. */
  intent?: RetrievalIntent;
  /** Original user text for profile detection (search query may be expanded/stripped). */
  originalQuery?: string;
  /** Workspace root for the ripgrep file channel. Session workspace is used when omitted. */
  workspaceDir?: string;
  /** MEM-26: Ω(q) validity clock. Default is now. */
  queryTime?: Date | string | number;
  /** MEM-65: sqlite datetime for as-of mode. Implies include-superseded. */
  asOf?: string;
  /** MEM-60: override the exploration rate / RNG (tests inject a seeded RNG). */
  explore?: { rate?: number; rng?: Rng };
  /** Skip inject_count write (A4 first hop). Default true. */
  recordInject?: boolean;
  /** Extra FTS5 OR terms (MEM-68 second hop). Never AND'd into the MATCH. */
  extraOrTerms?: string[];
}

/**
 * REL-05 same-topic multiplier increment: score *= (1 + TOPIC_SAME_BOOST).
 * Must stay multiplicative so it cannot dominate raw RRF or resurrect rel=0.
 */
export const TOPIC_SAME_BOOST = 0.12;
/**
 * REL-05 other-topic multiplier decrement: score *= (1 − TOPIC_OTHER_PENALTY).
 * Does not drop the candidate.
 */
export const TOPIC_OTHER_PENALTY = 0.08;
/**
 * REL-13 same-task multiplier increment: score *= (1 + TASK_SAME_BOOST).
 * After the gate; cannot resurrect rel=0.
 */
export const TASK_SAME_BOOST = 0.18;

/**
 * Scale for `normalizeBm25`: S = 1 − e^(−k·raw) on negated FTS5 bm25().
 * k=1 maps raw≈0.7 → ~0.5, raw≈2.3 → ~0.9. Independent of hit-list size.
 */
export const BM25_SCALE_K = 1.0;

/** Theorem default RRF constant k₀. */
export const RRF_K0_DEFAULT = 60;

export const RRF_CHANNEL_WEIGHTS_DEFAULT: ChannelWeights = {
  lexical: 1,
  ripgrep: 1,
  graph: 1,
  tree: 1,
};

/** Theorem default fused-candidate count before the calibrated θ cut-off. */
export const FUSION_CANDIDATE_CUTOFF_DEFAULT = 50;

/** Theorem default calibrated P(helpful) cut-off. */
export const RETRIEVAL_THRESHOLD_DEFAULT = 0.35;

/** First MATCH window vs the JOIN `LIMIT` (tombstones / other projects drop in JOIN). */
const FTS_MATCH_OVERFETCH = 10;
/** Cap on MATCH over-fetch retries so a 100k tombstone pile cannot scan forever. */
const FTS_MATCH_OVERFETCH_MAX = 8;
/** MEM-67: hard MATCH window. Equivalent to WAND/MaxScore top-k; never a table scan. */
export const FTS_MATCH_HARD_CAP = 2048;

type LexicalScope = {
  projectSessionIds?: string[];
  asOf?: string;
};

function pushQueryScope(
  extra: string[],
  params: unknown[],
  kind: "semantic" | "episodic",
  alias: string | undefined,
  asOf?: string,
): void {
  const clause = queryScopeClause(kind, alias, asOf ? { asOf } : {});
  extra.push(clause.sql);
  params.push(...clause.params);
}

async function loadRowsByIds(
  db: DatabaseConnection,
  kind: "semantic" | "episodic",
  ids: number[],
  asOf?: string,
): Promise<any[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const table = kind === "semantic" ? "brain_semantic" : "brain_episodic";
  const clause = queryScopeClause(kind, undefined, asOf ? { asOf } : {});
  return db.all(
    `SELECT * FROM ${table} WHERE id IN (${placeholders}) AND ${clause.sql}`,
    [...ids, ...clause.params],
  );
}

/**
 * MATCH first (P1-5), then JOIN Ω(q). If tombstones / other-project rows fill
 * the MATCH window, grow it until we have `resultLimit` live hits or the cap.
 */
async function fts5MatchJoin(
  db: DatabaseConnection,
  sql: string,
  matchQuery: string,
  extraParams: unknown[],
  resultLimit: number,
): Promise<any[]> {
  let fetch = Math.max(resultLimit * FTS_MATCH_OVERFETCH, resultLimit);
  const cap = Math.min(FTS_MATCH_HARD_CAP, Math.max(resultLimit * FTS_MATCH_OVERFETCH_MAX, resultLimit));
  let prevLive = -1;
  while (true) {
    const rows = await db.all(sql, [matchQuery, fetch, ...extraParams, resultLimit]);
    if (rows.length >= resultLimit || rows.length === prevLive || fetch >= cap) {
      return rows;
    }
    prevLive = rows.length;
    fetch = Math.min(Math.max(fetch * 2, fetch + 1), cap);
  }
}

/**
 * Absolute BM25 → [0, 1]. Does not depend on other hits in the result set.
 */
export function normalizeBm25(raw: number, k = BM25_SCALE_K): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const scaled = 1 - Math.exp(-k * raw);
  return scaled > 1 ? 1 : scaled;
}

export function candidateKey(result: Pick<FusionResult, "type" | "id">): string {
  return `${result.type}:${result.id}`;
}

/**
 * Reciprocal Rank Fusion: rel(m,q) = Σ_s w_s / (k₀ + rank_s(m)).
 * Missing / invalid ranks contribute 0. Ranks are 1-indexed.
 */
export function rrfScore(
  ranks: ChannelRanks,
  weights: ChannelWeights = RRF_CHANNEL_WEIGHTS_DEFAULT,
  k0: number = RRF_K0_DEFAULT,
): number {
  if (!Number.isFinite(k0) || k0 <= 0) return 0;
  let rel = 0;
  for (const channel of FUSION_CHANNELS) {
    const rank = ranks[channel];
    if (rank == null || !Number.isFinite(rank) || rank < 1) continue;
    const w = weights[channel];
    if (!Number.isFinite(w) || w === 0) continue;
    rel += w / (k0 + rank);
  }
  return rel;
}

/** Channel with the largest RRF term. Used for attribution w_s. */
export function winningRrfChannel(
  ranks: ChannelRanks,
  weights: ChannelWeights = RRF_CHANNEL_WEIGHTS_DEFAULT,
  k0: number = RRF_K0_DEFAULT,
): FusionChannel | null {
  if (!Number.isFinite(k0) || k0 <= 0) return null;
  let best: FusionChannel | null = null;
  let bestTerm = 0;
  for (const channel of FUSION_CHANNELS) {
    const rank = ranks[channel];
    if (rank == null || !Number.isFinite(rank) || rank < 1) continue;
    const w = weights[channel];
    if (!Number.isFinite(w) || w === 0) continue;
    const term = w / (k0 + rank);
    if (term > bestTerm) {
      best = channel;
      bestTerm = term;
    }
  }
  return best;
}

/**
 * Single lexical list: BM25 first, then trigram. Items with neither score
 * are not in the channel (contribute 0).
 */
export function assignLexicalRanks(candidates: Iterable<FusionResult>): Map<string, number> {
  const items = [...candidates].filter((c) => c.scores.fts5 > 0 || c.scores.trigram > 0);
  items.sort((a, b) => {
    if (b.scores.fts5 !== a.scores.fts5) return b.scores.fts5 - a.scores.fts5;
    if (b.scores.trigram !== a.scores.trigram) return b.scores.trigram - a.scores.trigram;
    return candidateKey(a).localeCompare(candidateKey(b));
  });
  const ranks = new Map<string, number>();
  items.forEach((c, i) => ranks.set(candidateKey(c), i + 1));
  return ranks;
}

export function assignScoreRanks(
  entries: Array<{ key: string; score: number }>,
): Map<string, number> {
  const items = entries.filter((e) => Number.isFinite(e.score) && e.score > 0);
  items.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const ranks = new Map<string, number>();
  items.forEach((e, i) => ranks.set(e.key, i + 1));
  return ranks;
}

/**
 * Map leftover component scores onto rank-1 channel presence for unit tests.
 * Recency / importance are not channels. REL-03: no lexical floor → rel=0.
 */
export function channelRanksFromComponentScores(
  scores: FusionResult["scores"],
): ChannelRanks {
  const lexical = (scores.fts5 ?? 0) + (scores.trigram ?? 0);
  const ranks: ChannelRanks = {};
  if (lexical >= LEXICAL_SCORE_MIN) ranks.lexical = 1;
  if ((scores.ripgrep ?? 0) > 0) ranks.ripgrep = 1;
  if ((scores.tree ?? 0) > 0) ranks.tree = 1;
  if ((scores.graph ?? 0) > 0 && lexical >= LEXICAL_SCORE_MIN) ranks.graph = 1;
  return ranks;
}

/**
 * MEM-20: `fuseCandidateScore` is now RRF from channel presence.
 * Recency and importance do not score (relevance-dominance).
 */
export function fuseCandidateScore(
  scores: FusionResult["scores"],
  _weights?: FusionWeights,
  _theta?: number,
): number {
  return rrfScore(channelRanksFromComponentScores(scores));
}

/**
 * Max RRF if every listed channel ranks m #1: Σ_s w_s / (k₀+1).
 * Unused / zero-weight channels contribute 0. Live retrieve compares θ
 * against this ceiling so 0.35 is not applied to raw 1/61.
 */
export function rrfCeiling(
  weights: ChannelWeights = RRF_CHANNEL_WEIGHTS_DEFAULT,
  k0: number = RRF_K0_DEFAULT,
  channels: readonly FusionChannel[] = FUSION_CHANNELS,
): number {
  if (!Number.isFinite(k0) || k0 <= 0) return 0;
  let max = 0;
  for (const channel of channels) {
    const w = weights[channel];
    if (!Number.isFinite(w) || w <= 0) continue;
    max += w / (k0 + 1);
  }
  return max;
}

/** Channels that assigned a 1-indexed rank to at least one candidate. */
export function activeFusionChannels(
  results: Iterable<Pick<FusionResult, "ranks">>,
): FusionChannel[] {
  const seen = new Set<FusionChannel>();
  for (const result of results) {
    const ranks = result.ranks;
    if (!ranks) continue;
    for (const channel of FUSION_CHANNELS) {
      const rank = ranks[channel];
      if (rank == null || !Number.isFinite(rank) || rank < 1) continue;
      seen.add(channel);
    }
  }
  return FUSION_CHANNELS.filter((channel) => seen.has(channel));
}

/**
 * Calibrated cut-off on the fused score: θ · rrfCeiling(active channels).
 * θ is P(helpful | m,q); the ceiling maps it onto RRF scale.
 */
export function calibratedScoreCutoff(
  theta: number,
  weights: ChannelWeights = RRF_CHANNEL_WEIGHTS_DEFAULT,
  k0: number = RRF_K0_DEFAULT,
  channels: readonly FusionChannel[] = FUSION_CHANNELS,
): number {
  if (!Number.isFinite(theta) || theta <= 0) return 0;
  return theta * rrfCeiling(weights, k0, channels);
}

/** Fused score as a fraction of the active-channel RRF ceiling. */
export function normalizeFusedScore(score: number, ceiling: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (!Number.isFinite(ceiling) || ceiling <= 0) return 0;
  return score / ceiling;
}

/**
 * MEM-22 admission: score > 0 (REL-03) and score ≥ θ · ceiling.
 * Pinned rows that already have a fused score skip the θ cut.
 */
export function passesCalibratedTheta(
  score: number,
  theta: number,
  ceiling: number,
  pinned = false,
): boolean {
  if (!Number.isFinite(score) || score <= 0) return false;
  if (pinned) return true;
  if (!Number.isFinite(theta) || theta <= 0) return true;
  if (!Number.isFinite(ceiling) || ceiling <= 0) return true;
  return score >= theta * ceiling;
}

/** Multiplier for REL-05/13. 0 · factor stays 0 (cannot resurrect a miss). */
export function scopeBiasMultiplier(delta: number): number {
  if (!Number.isFinite(delta)) return 1;
  return Math.max(0, 1 + delta);
}

/**
 * REL-05: after the mismatch gate, multiply the current topic and scale down
 * other topics in the same session. Never hard-excludes (user may refer back).
 * A zero-rel miss stays 0 — do not add raw +0.12 after fusion (MEM-21).
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
      result.score *= scopeBiasMultiplier(TOPIC_SAME_BOOST);
    } else if (data.source_session_id === opts.sessionId) {
      result.score *= scopeBiasMultiplier(-TOPIC_OTHER_PENALTY);
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

/**
 * REL-13: after the gate (and topic bias), multiply the open task above the
 * current topic. Never hard-excludes other tasks. Cannot resurrect rel=0.
 */
export function applyTaskBias(
  results: FusionResult[],
  opts: { currentTaskId: string },
): FusionResult[] {
  for (const result of results) {
    if (result.type !== "semantic") continue;
    const data = result.data as SemanticMemory;
    if (data.task_id === opts.currentTaskId) {
      result.score *= scopeBiasMultiplier(TASK_SAME_BOOST);
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

    const prev = await db.get<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type='trigger' AND name='brain_semantic_fts_insert'`,
    );
    const needsRebuild = Boolean(prev?.sql && !prev.sql.includes("cjk_seq"));

    await db.exec(`DROP TRIGGER IF EXISTS brain_semantic_fts_insert`);
    await db.exec(`DROP TRIGGER IF EXISTS brain_semantic_fts_delete`);
    await db.exec(`DROP TRIGGER IF EXISTS brain_semantic_fts_update`);
    await db.exec(`DROP TRIGGER IF EXISTS brain_episodic_fts_insert`);
    await db.exec(`DROP TRIGGER IF EXISTS brain_episodic_fts_delete`);
    await db.exec(`DROP TRIGGER IF EXISTS brain_episodic_fts_update`);

    await db.exec(`
      CREATE TRIGGER brain_semantic_fts_insert AFTER INSERT ON brain_semantic BEGIN
        INSERT INTO brain_semantic_fts(rowid, title, content, keywords)
        VALUES (new.id, ${cjkExpandSql("new.title")}, ${cjkExpandSql("new.content")}, ${cjkExpandSql("new.keywords")});
      END
    `);

    await db.exec(`
      CREATE TRIGGER brain_semantic_fts_delete AFTER DELETE ON brain_semantic BEGIN
        INSERT INTO brain_semantic_fts(brain_semantic_fts, rowid, title, content, keywords)
        VALUES ('delete', old.id, ${cjkExpandSql("old.title")}, ${cjkExpandSql("old.content")}, ${cjkExpandSql("old.keywords")});
      END
    `);

    await db.exec(`
      CREATE TRIGGER brain_semantic_fts_update AFTER UPDATE ON brain_semantic BEGIN
        INSERT INTO brain_semantic_fts(brain_semantic_fts, rowid, title, content, keywords)
        VALUES ('delete', old.id, ${cjkExpandSql("old.title")}, ${cjkExpandSql("old.content")}, ${cjkExpandSql("old.keywords")});
        INSERT INTO brain_semantic_fts(rowid, title, content, keywords)
        VALUES (new.id, ${cjkExpandSql("new.title")}, ${cjkExpandSql("new.content")}, ${cjkExpandSql("new.keywords")});
      END
    `);

    await db.exec(`
      CREATE TRIGGER brain_episodic_fts_insert AFTER INSERT ON brain_episodic BEGIN
        INSERT INTO brain_episodic_fts(rowid, content)
        VALUES (new.id, ${cjkExpandSql("new.content")});
      END
    `);

    await db.exec(`
      CREATE TRIGGER brain_episodic_fts_delete AFTER DELETE ON brain_episodic BEGIN
        INSERT INTO brain_episodic_fts(brain_episodic_fts, rowid, content)
        VALUES ('delete', old.id, ${cjkExpandSql("old.content")});
      END
    `);

    await db.exec(`
      CREATE TRIGGER brain_episodic_fts_update AFTER UPDATE ON brain_episodic BEGIN
        INSERT INTO brain_episodic_fts(brain_episodic_fts, rowid, content)
        VALUES ('delete', old.id, ${cjkExpandSql("old.content")});
        INSERT INTO brain_episodic_fts(rowid, content)
        VALUES (new.id, ${cjkExpandSql("new.content")});
      END
    `);

    if (needsRebuild) {
      await RetrievalFusion.rebuildFts5(db);
    }
    try {
      const { ensureFrozenFtsTables } = await import("./store/frozenSegment.js");
      await ensureFrozenFtsTables(db);
    } catch {
      // Frozen FTS is additive.
    }
  }

  /**
   * Rebuild FTS5 indexes from scratch (for migration from pre-FTS5 data).
   *
   * `delete-all` is not valid on content= FTS5 tables — it corrupts the
   * index. Drop and recreate, then repopulate from the content tables.
   */
  static async rebuildFts5(db: DatabaseConnection): Promise<{ semantic: number; episodic: number }> {
    await db.exec(`DROP TABLE IF EXISTS brain_semantic_fts`);
    await db.exec(`DROP TABLE IF EXISTS brain_episodic_fts`);
    await db.exec(`
      CREATE VIRTUAL TABLE brain_semantic_fts USING fts5(
        title,
        content,
        keywords,
        content='brain_semantic',
        content_rowid='id',
        tokenize='porter unicode61 remove_diacritics 2'
      )
    `);
    await db.exec(`
      CREATE VIRTUAL TABLE brain_episodic_fts USING fts5(
        content,
        content='brain_episodic',
        content_rowid='id',
        tokenize='porter unicode61 remove_diacritics 2'
      )
    `);

    const semResult = await db.run(`
      INSERT INTO brain_semantic_fts(rowid, title, content, keywords)
      SELECT id, ${cjkExpandSql("title")}, ${cjkExpandSql("content")}, ${cjkExpandSql("keywords")}
      FROM brain_semantic
    `);
    const epResult = await db.run(`
      INSERT INTO brain_episodic_fts(rowid, content)
      SELECT id, ${cjkExpandSql("content")} FROM brain_episodic
    `);

    try {
      const { rebuildFrozenFts, ensureFrozenFtsTables } = await import("./store/frozenSegment.js");
      await ensureFrozenFtsTables(db);
      await rebuildFrozenFts(db);
    } catch {
      // Frozen segment is optional on a fresh migrate.
    }

    return {
      semantic: semResult.changes ?? 0,
      episodic: epResult.changes ?? 0,
    };
  }

  // ── Multi-Strategy Fusion Search ───────────────────────────────────────────

  /**
   * Main fusion search. RRF over lexical (BM25-then-trigram + synonyms),
   * ripgrep (MEM-23), graph, and the summary tree (MEM-24).
   */
  static async search(options: FusionOptions): Promise<FusionResult[]> {
    const db = await BrainStore.get();
    const config = getMemoryConfig();
    const fusionParams = getFusionParams();
    const theorem = getTheoremParams();
    const limit = options.limit ?? config.retrieval_top_k;
    const minScore = options.minScore;
    const fusedCap = Math.max(1, theorem.fusionCandidateCutoff || FUSION_CANDIDATE_CUTOFF_DEFAULT);
    const candidateLimit = Math.max(
      Math.max(limit, fusedCap) * fusionParams.candidateMultiplier,
      fusionParams.candidateMin,
    );
    const channelWeights: ChannelWeights = {
      ...theorem.channelWeights,
      ...options.channelWeights,
    };
    const k0 = options.rrfK0 ?? theorem.rrfK0;
    const etaU = theorem.etaUtility;
    const etaR = theorem.etaRetrievability;
    const theta = minScore ?? config.retrieval_threshold;
    const theoremV2 = getTheoremParamsV2();
    const kappa = getValueParams().kappa;
    // MEM-60: explore_rate of calls replace U with a Thompson draw.
    const exploreRng = options.explore?.rng ?? getExplorationRng();
    const exploreRate = explorationAllowed(options.explore?.rng)
      ? Math.max(0, options.explore?.rate ?? theoremV2.exploreRate)
      : 0;
    const exploring = exploreRate > 0 && exploreRng() < exploreRate;

    // REL-01: never concatenate synonyms into the AND query. OR them in FTS5 only.
    const searchQuery = options.query;
    const synonymExtras = [
      ...(config.enable_enhanced_semantic
        ? getSynonymAdditions(searchQuery, { continuation: options.intent === "continuation" })
        : []),
      ...(options.extraOrTerms ?? []).map((t) => t.trim()).filter(Boolean),
    ];
    const trigramQuery = synonymExtras.length > 0
      ? expandQuerySynonyms(searchQuery, { continuation: options.intent === "continuation" })
      : searchQuery;

    const asOf = options.asOf?.trim() || undefined;
    const lexicalScope: LexicalScope = { projectSessionIds: options.projectSessionIds, asOf };
    const channelCosts: ChannelCost[] = [];

    // 1–2. Lexical: FTS5 BM25 then trigram over the MATCH window (MEM-67: no table scan).
    const lexicalTimed = await timed("lexical", async () => {
      const fts5Semantic = await RetrievalFusion.fts5SearchSemantic(
        db, searchQuery, options.category, candidateLimit, synonymExtras, lexicalScope,
      );
      const fts5Episodic = options.includeEpisodic !== false
        ? await RetrievalFusion.fts5SearchEpisodic(
            db, searchQuery, options.sessionId, candidateLimit, synonymExtras, lexicalScope,
          )
        : [];
      const trigramSemantic = await RetrievalFusion.trigramSearchSemantic(
        db, trigramQuery, options.category, Math.floor(candidateLimit / 2), lexicalScope,
      );
      return { fts5Semantic, fts5Episodic, trigramSemantic };
    }, (r) => r.fts5Semantic.length + r.fts5Episodic.length + r.trigramSemantic.length);
    channelCosts.push(lexicalTimed.cost);
    const { fts5Semantic, fts5Episodic, trigramSemantic } = lexicalTimed.result;

    // 3. Graph + ripgrep + tree. Independent lists, each with a hard cost cap.
    const workspaceDir = await RetrievalFusion.resolveWorkspaceDir(options);
    const searchWorkspace =
      config.memory_scope === "project" && Boolean(workspaceDir);
    const [graphTimed, ripgrepTimed, treeTimed] = await Promise.all([
      timed("graph", () => RetrievalFusion.graphExpansion(searchQuery, lexicalScope), (r) => r.visited),
      timed("ripgrep", () => searchRipgrepChannel({
        query: searchQuery,
        db,
        includeEpisodic: options.includeEpisodic !== false,
        category: options.category,
        sessionId: options.sessionId,
        projectSessionIds: options.projectSessionIds,
        workspaceDir,
        searchWorkspace,
        limit: candidateLimit,
        asOf,
        timeoutMs: theoremV2.ripgrepTimeoutMs,
      }), (r) => r.visited),
      timed("tree", () => searchTreeChannel({
        query: searchQuery,
        db,
        includeEpisodic: options.includeEpisodic !== false,
        sessionId: options.sessionId,
        projectSessionIds: options.projectSessionIds,
        limit: candidateLimit,
      }), (r) => r.visited),
    ]);
    const graphRun = graphTimed.result;
    const graphIds = graphRun.scores;
    const ripgrepHits = ripgrepTimed.result.hits;
    const treeHits = treeTimed.result.hits;
    const ripgrepCost: ChannelCost = { ...ripgrepTimed.cost, timed_out: ripgrepTimed.result.timed_out || undefined };
    channelCosts.push(graphTimed.cost, ripgrepCost, treeTimed.cost);

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

    // Apply graph scores. Graph is its own channel: hits that lexical missed
    // still enter the pool (gate may still drop them).
    const pendingGraphOnly: Array<[number, number]> = [];
    for (const [memId, graphScore] of graphIds) {
      const key = `semantic:${memId}`;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.scores.graph = graphScore;
      } else {
        pendingGraphOnly.push([memId, graphScore]);
      }
    }
    if (pendingGraphOnly.length > 0) {
      const ids = pendingGraphOnly.map(([id]) => id);
      const rows = await loadRowsByIds(db, "semantic", ids, asOf);
      const scoreById = new Map(pendingGraphOnly);
      for (const r of rows) {
        const memory = RetrievalFusion.rowToSemantic(r);
        candidateMap.set(`semantic:${memory.id}`, {
          id: memory.id,
          type: "semantic",
          score: 0,
          scores: {
            fts5: 0,
            trigram: 0,
            graph: scoreById.get(memory.id) ?? 0,
            recency: 0,
            importance: 0,
          },
          data: memory,
        });
      }
    }

    // Apply ripgrep scores. Corpus hits and file-mapped rows enter the pool
    // the same way graph-only hits do (gate may still drop them).
    const pendingRipgrepOnly: Array<{
      type: "semantic" | "episodic";
      id: number;
      score: number;
    }> = [];
    for (const hit of ripgrepHits) {
      const key = `${hit.type}:${hit.id}`;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.scores.ripgrep = hit.score;
      } else {
        pendingRipgrepOnly.push(hit);
      }
    }
    if (pendingRipgrepOnly.length > 0) {
      const semIds = pendingRipgrepOnly.filter((h) => h.type === "semantic").map((h) => h.id);
      const epIds = pendingRipgrepOnly.filter((h) => h.type === "episodic").map((h) => h.id);
      const scoreByKey = new Map<string, number>(
        pendingRipgrepOnly.map((h) => [`${h.type}:${h.id}`, h.score]),
      );
      if (semIds.length > 0) {
        const rows = await loadRowsByIds(db, "semantic", semIds, asOf);
        for (const r of rows) {
          const memory = RetrievalFusion.rowToSemantic(r);
          const key = `semantic:${memory.id}`;
          candidateMap.set(key, {
            id: memory.id,
            type: "semantic",
            score: 0,
            scores: {
              fts5: 0,
              trigram: 0,
              graph: 0,
              recency: 0,
              importance: 0,
              ripgrep: scoreByKey.get(key) ?? 0,
            },
            data: memory,
          });
        }
      }
      if (epIds.length > 0 && options.includeEpisodic !== false) {
        const rows = await loadRowsByIds(db, "episodic", epIds, asOf);
        for (const r of rows) {
          const memory = RetrievalFusion.rowToEpisodic(r);
          const key = `episodic:${memory.id}`;
          candidateMap.set(key, {
            id: memory.id,
            type: "episodic",
            score: 0,
            scores: {
              fts5: 0,
              trigram: 0,
              graph: 0,
              recency: 0,
              importance: 0,
              ripgrep: scoreByKey.get(key) ?? 0,
            },
            data: memory,
          });
        }
      }
    }

    const pendingTreeOnly: Array<{
      type: "semantic" | "episodic";
      id: number;
      score: number;
    }> = [];
    for (const hit of treeHits) {
      const key = `${hit.type}:${hit.id}`;
      const existing = candidateMap.get(key);
      if (existing) {
        existing.scores.tree = hit.score;
      } else {
        pendingTreeOnly.push(hit);
      }
    }
    if (pendingTreeOnly.length > 0) {
      const semIds = pendingTreeOnly.filter((h) => h.type === "semantic").map((h) => h.id);
      const epIds = pendingTreeOnly.filter((h) => h.type === "episodic").map((h) => h.id);
      const scoreByKey = new Map<string, number>(
        pendingTreeOnly.map((h) => [`${h.type}:${h.id}`, h.score]),
      );
      if (semIds.length > 0) {
        const rows = await loadRowsByIds(db, "semantic", semIds, asOf);
        for (const r of rows) {
          const memory = RetrievalFusion.rowToSemantic(r);
          const key = `semantic:${memory.id}`;
          candidateMap.set(key, {
            id: memory.id,
            type: "semantic",
            score: 0,
            scores: {
              fts5: 0,
              trigram: 0,
              graph: 0,
              recency: 0,
              importance: 0,
              tree: scoreByKey.get(key) ?? 0,
            },
            data: memory,
          });
        }
      }
      if (epIds.length > 0 && options.includeEpisodic !== false) {
        const rows = await loadRowsByIds(db, "episodic", epIds, asOf);
        for (const r of rows) {
          const memory = RetrievalFusion.rowToEpisodic(r);
          const key = `episodic:${memory.id}`;
          candidateMap.set(key, {
            id: memory.id,
            type: "episodic",
            score: 0,
            scores: {
              fts5: 0,
              trigram: 0,
              graph: 0,
              recency: 0,
              importance: 0,
              tree: scoreByKey.get(key) ?? 0,
            },
            data: memory,
          });
        }
      }
    }

    // MEM-04: frozen / tombstoned stay SELECTable but drop from default fusion
    for (const [key, candidate] of candidateMap) {
      if (!isLiveRetrieveRow(candidate.data)) candidateMap.delete(key);
    }

    // MEM-26 / MEM-65: Ω(q) — valid at query time. As-of keeps superseded facts.
    const queryTime = options.queryTime ?? asOf;
    for (const [key, candidate] of candidateMap) {
      if (!isValidAt(candidate.data, queryTime)) candidateMap.delete(key);
    }
    if (!asOf) {
      const candidateSemanticIdsEarly = [...candidateMap.values()]
        .filter((c) => c.type === "semantic")
        .map((c) => c.id);
      try {
        const superseded = await loadSupersededIds(db, candidateSemanticIdsEarly);
        for (const id of superseded) candidateMap.delete(`semantic:${id}`);
      } catch {
        // older DB without the table
      }
    }

    const pinnedIds = new Set(
      (await BrainStore.searchByTag("pinned", "semantic", 500)).map((t) => t.memory_id),
    );

    // MEM-13: Value < θ_arch archives from default retrieve (row stays, no DELETE)
    for (const [key, candidate] of candidateMap) {
      const pinned = candidate.type === "semantic" && pinnedIds.has(candidate.id);
      if (!isDefaultRetrieveValue(candidate.data, { pinned })) candidateMap.delete(key);
    }

    // Recency / importance stay on the candidate for diagnostics. They do not
    // enter rel (MEM-20). U and R modulate rel (MEM-21); they cannot add to it.
    const now = Date.now();
    const lexicalRanks = assignLexicalRanks(candidateMap.values());
    const graphRanks = assignScoreRanks(
      [...candidateMap.values()]
        .filter((c) => c.type === "semantic" && c.scores.graph > 0)
        .map((c) => ({ key: candidateKey(c), score: c.scores.graph })),
    );
    const ripgrepRanks = assignScoreRanks(
      [...candidateMap.values()]
        .filter((c) => (c.scores.ripgrep ?? 0) > 0)
        .map((c) => ({ key: candidateKey(c), score: c.scores.ripgrep ?? 0 })),
    );
    const treeRanks = assignScoreRanks(
      [...candidateMap.values()]
        .filter((c) => (c.scores.tree ?? 0) > 0)
        .map((c) => ({ key: candidateKey(c), score: c.scores.tree ?? 0 })),
    );
    for (const candidate of candidateMap.values()) {
      const data = candidate.data;
      const createdAt = new Date(data.created_at).getTime();
      const ageHours = (now - createdAt) / 3600000;
      candidate.scores.recency = Math.exp(-fusionParams.recencyDecayLambda * ageHours);
      candidate.scores.importance = data.importance_score ?? 0.5;

      const key = candidateKey(candidate);
      const ranks: ChannelRanks = {};
      const lexicalRank = lexicalRanks.get(key);
      const graphRank = graphRanks.get(key);
      const ripgrepRank = ripgrepRanks.get(key);
      const treeRank = treeRanks.get(key);
      if (lexicalRank != null) ranks.lexical = lexicalRank;
      if (ripgrepRank != null) ranks.ripgrep = ripgrepRank;
      if (treeRank != null) ranks.tree = treeRank;
      if (graphRank != null) ranks.graph = graphRank;
      candidate.ranks = ranks;
      const rel = rrfScore(ranks, channelWeights, k0);
      const greedyU = utilityFromSource(data);
      const U = exploring
        ? thompsonUtility(
            data.helpful_count ?? 0,
            data.unhelpful_count ?? 0,
            resolveInitialImportance(data),
            kappa,
            exploreRng,
          )
        : greedyU;
      const R = retrievabilityFromSource(data, undefined, now);
      candidate.rel = rel;
      candidate.utility = U;
      candidate.utilityGreedy = greedyU;
      candidate.explored = exploring;
      candidate.retrievability = R;
      candidate.priorFactor = priorModulation(U, R, etaU, etaR);
      candidate.score = modulateRelevance(rel, U, R, etaU, etaR);
      candidate.channel = winningRrfChannel(ranks, channelWeights, k0) ?? undefined;
    }
    const currentTopicId =
      options.currentTopicId ??
      (options.sessionId
        ? (await BrainStore.getLatestSessionTopic(options.sessionId))?.id ?? null
        : null);

    // MC-51 / MC-52: outcome history and supersession. Tables are additive; a failure here must
    // never break recall, so it degrades to "no outcome data".
    const candidateSemanticIds = [...candidateMap.values()].filter((c) => c.type === "semantic").map((c) => c.id);
    let outcomes = new Map<number, { verified: number; reverted: number }>();
    try {
      outcomes = await loadOutcomes(db, candidateSemanticIds);
    } catch {
      // older DB without the table
    }

    const activeChannels = activeFusionChannels(candidateMap.values());
    const scoreCeiling = rrfCeiling(channelWeights, k0, activeChannels);

    for (const candidate of candidateMap.values()) {
      if (candidate.type !== "semantic") continue;
      const sem = candidate.data as SemanticMemory;
      const pinned = pinnedIds.has(sem.id);
      candidate.score = applyMismatchPenalty(
        candidate.score,
        sem.mismatch_count,
        pinned,
        isMismatchActive(sem, currentTopicId) && !pinned,
      );
    }

    // Sort by modulated score, then REL-03 mismatch gate (rel=0 if the gate
    // fails), then top fused-candidates, then calibrated θ (MEM-22).
    let results = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);

    // MEM-64: access + relevance. User-global categories cross projects.
    if (options.projectSessionIds !== undefined) {
      const allowed = new Set(options.projectSessionIds);
      results = results.filter((r) => {
        if (r.type === "episodic") {
          return allowed.has((r.data as EpisodicMemory).session_id);
        }
        const sem = r.data as SemanticMemory;
        if (isUserGlobalCategory(sem.category)) return true;
        return Boolean(sem.source_session_id && allowed.has(sem.source_session_id));
      });
    }

    const queryEntities = await resolveQueryEntities(searchQuery);
    const requireLexical = config.retrieval_require_lexical !== false;
    for (const r of results) {
      const sem = r.type === "semantic" ? (r.data as SemanticMemory) : undefined;
      const ep = r.type === "episodic" ? (r.data as EpisodicMemory) : undefined;
      const pinned = sem ? pinnedIds.has(sem.id) : false;
      const demoted = sem ? isMismatchActive(sem, currentTopicId) && !pinned : false;
      const gate = evaluateRelevanceGate({
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
        ripgrepHit: hasRipgrepHit(r),
        // MC-50: verified-ness and prior mismatch raise/lower the bar (see RelevanceGate).
        verified: sem ? recipeMemoryIsVerified(sem.content, outcomes.get(sem.id)) : undefined,
        mismatchCount: sem?.mismatch_count,
      });
      // REL-03: gate fail → rel=0 (relevance-dominance).
      if (!gate.passed) {
        r.rel = 0;
        r.score = 0;
      }
    }
    results = results.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);

    // REL-05: topic boost/penalty after the gate, before the fused cut-off
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

    // MEM-61: cut = iso(score) ≥ θ (scope fit, else global fit, else top-k).
    // An explicit `minScore` keeps the leftover θ · rrfCeiling cut for callers that ask for it.
    const legacyCut = minScore !== undefined;
    let calibration: CalibrationSelection = { mode: "cold", fit: null, n: 0 };
    if (!legacyCut) {
      const scopeKey = await scopeKeyForSession(db, options.sessionId);
      calibration = await loadCalibration(db, scopeKey, theoremV2.calibrationMinInjections);
    }
    const coldTopK = Math.min(fusedCap, Math.max(1, theoremV2.calibrationFallbackTopK));
    const reservedCap = resolveReservedTreeSlots({
      configured: theoremV2.treeReservedSlots,
      beam: theorem.treeBeamB,
      branching: theorem.treeBranchingB,
    });
    const treeKeys = new Set(
      results.filter((r) => (r.scores.tree ?? 0) > 0).map((r) => candidateKey(r)),
    );
    const admissionCut = (ranked: AdmissionRanked[]): AdmissionRanked[] => {
      const head = mergeReservedCandidates(ranked, fusedCap, treeKeys, reservedCap);
      if (legacyCut) {
        return head.filter((r) => passesCalibratedTheta(r.score, theta, scoreCeiling, r.pinned));
      }
      return applyCalibratedCut(head, calibration, theta, coldTopK);
    };

    const byKey = new Map<string, FusionResult>();
    const items: AdmissionItem[] = [];
    for (const r of results) {
      const key = candidateKey(r);
      byKey.set(key, r);
      const data = r.data;
      items.push({
        key,
        score: r.score,
        priorFactor: r.priorFactor ?? 1,
        retrievability: r.retrievability ?? 0,
        utilityUsed: r.utility ?? 0,
        utilityGreedy: r.utilityGreedy ?? r.utility ?? 0,
        helpful: data.helpful_count ?? 0,
        unhelpful: data.unhelpful_count ?? 0,
        i0: resolveInitialImportance(data),
        pinned: r.type === "semantic" && pinnedIds.has(r.id),
      });
    }
    const plan = planAdmission({
      items,
      etaU,
      etaR,
      kappa,
      cut: admissionCut,
      limit,
      rate: exploreRate,
      rng: exploreRng,
      explored: exploring,
    });
    results = [];
    const fusedHead = new Set(
      [...byKey.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, fusedCap)
        .map((r) => candidateKey(r)),
    );
    let reservedTreeKept = 0;
    for (const key of plan.final) {
      const r = byKey.get(key);
      if (!r) continue;
      r.propensity = plan.propensity.get(key);
      if (calibration.fit) r.calibrated_p = predictIsotonic(calibration.fit, r.score);
      if (treeKeys.has(key) && !fusedHead.has(key)) {
        r.reserved = true;
        reservedTreeKept++;
      }
      results.push(r);
    }

    // REL-12 / MEM-16: calibration inject_count only — not retrieval_count
    // (leftover S / I) and not last_accessed_at (R clock). Returned hits
    // already passed the gate and the calibrated θ cut-off.
    if (options.recordInject !== false) {
      const semanticIds = results
        .filter((r) => r.type === "semantic" && r.score > 0)
        .map((r) => r.id);
      await BrainStore.recordSemanticInject(semanticIds);
    }

    setLastSearchMeta({
      channels: channelCosts.length ? channelCosts : [
        emptyChannelCost("lexical"),
        emptyChannelCost("ripgrep"),
        emptyChannelCost("graph"),
        emptyChannelCost("tree"),
      ],
      asOf,
      reservedTreeKept,
      hops: 1,
      gwOverBeam: false,
    });

    return results;
  }

  // ── FTS5 Search Strategies ─────────────────────────────────────────────────

  private static async fts5SearchSemantic(
    db: DatabaseConnection,
    query: string,
    category: SemanticCategory | undefined,
    limit: number,
    extraOrTerms: string[] = [],
    scope: LexicalScope = {},
  ): Promise<Array<{ id: number; bm25Score: number; memory: SemanticMemory }>> {
    const ftsQuery = RetrievalFusion.buildFts5Query(query, extraOrTerms);
    if (!ftsQuery) return [];

    try {
      const extra: string[] = [
        "(s.expires_at IS NULL OR s.expires_at > datetime('now'))",
      ];
      const extraParams: any[] = [];
      pushQueryScope(extra, extraParams, "semantic", "s", scope.asOf);

      if (category) {
        extra.push("s.category = ?");
        extraParams.push(category);
      }
      if (appendRelevanceScope(extra, extraParams, "s.source_session_id", scope.projectSessionIds, "s.category") === "none") {
        return [];
      }

      // MATCH first: a tombstoned_at / expires filter on the JOIN can make SQLite
      // walk idx_semantic_tombstoned (almost every row) and probe FTS per row at 100k.
      const rows = await fts5MatchJoin(
        db,
        `
        WITH hits AS (
          SELECT rowid AS id, -bm25(brain_semantic_fts, 5.0, 1.0, 3.0) AS bm25_score
          FROM brain_semantic_fts
          WHERE brain_semantic_fts MATCH ?
          ORDER BY bm25_score DESC
          LIMIT ?
        )
        SELECT s.*, hits.bm25_score AS bm25_score
        FROM hits JOIN brain_semantic s ON s.id = hits.id
        WHERE ${extra.join(" AND ")}
        ORDER BY hits.bm25_score DESC
        LIMIT ?
      `,
        ftsQuery,
        extraParams,
        limit,
      );

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
    scope: LexicalScope = {},
  ): Promise<Array<{ id: number; bm25Score: number; memory: EpisodicMemory }>> {
    const ftsQuery = RetrievalFusion.buildFts5Query(query, extraOrTerms);
    if (!ftsQuery) return [];

    try {
      // Parameters must follow placeholder order: MATCH ?, then extra
      // conditions, then LIMIT ?.
      const extraConditions: string[] = [];
      const extraParams: any[] = [];
      pushQueryScope(extraConditions, extraParams, "episodic", "e", scope.asOf);

      if (sessionId) {
        extraConditions.push("e.session_id = ?");
        extraParams.push(sessionId);
      } else if (appendRelevanceScope(extraConditions, extraParams, "e.session_id", scope.projectSessionIds) === "none") {
        return [];
      }

      const whereExtra = extraConditions.length > 0 ? ` AND ${extraConditions.join(" AND ")}` : "";

      // MATCH first, in a CTE: with a session filter SQLite otherwise walks the session index and
      // probes the FTS table once per episodic row, which takes seconds at ~10k rows.
      const rows = await fts5MatchJoin(
        db,
        `
        WITH hits AS (
          SELECT rowid AS id, -bm25(brain_episodic_fts) AS bm25_score FROM brain_episodic_fts
          WHERE brain_episodic_fts MATCH ? ORDER BY bm25_score DESC LIMIT ?
        )
        SELECT e.*, hits.bm25_score AS bm25_score
        FROM hits JOIN brain_episodic e ON e.id = hits.id
        WHERE 1 = 1${whereExtra}
        ORDER BY hits.bm25_score DESC
        LIMIT ?
      `,
        ftsQuery,
        extraParams,
        limit,
      );

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
    scope: LexicalScope = {},
  ): Promise<Array<{ id: number; similarity: number; memory: SemanticMemory }>> {
    const queryTrigrams = RetrievalFusion.generateTrigrams(query.toLowerCase());
    if (queryTrigrams.size === 0) return [];

    // Fetch candidate rows (use existing indexes for pre-filtering)
    const conditions = [
      "(expires_at IS NULL OR expires_at > datetime('now'))",
    ];
    const params: any[] = [];
    pushQueryScope(conditions, params, "semantic", undefined, scope.asOf);

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }
    if (appendRelevanceScope(conditions, params, "source_session_id", scope.projectSessionIds, "category") === "none") {
      return [];
    }

    // Pre-filter with simple LIKE on first few meaningful terms to avoid scanning entire table
    const terms = contentWords(query).filter((t) => t.length > 2).slice(0, 3);
    if (terms.length > 0) {
      const likeConditions = terms.map(() => "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)");
      conditions.push(`(${likeConditions.join(" OR ")})`);
      for (const term of terms) {
        const like = `%${term}%`;
        params.push(like, like, like);
      }
    }

    const poolSize = limit * 3;

    // Candidate pool, best lexical match first. Ordering the LIKE pool by importance alone lets
    // common words in unrelated rows crowd out the one relevant memory once the brain holds
    // thousands of items (P1-5 scale bench), so FTS5 BM25 picks the pool. LIKE is FTS-less
    // only (MEM-67): never COUNT(*) and never scan Ω(q) after a successful MATCH.
    let rows: any[] = [];
    let ftsUsed = false;
    const ftsQuery = RetrievalFusion.buildFts5Query(query);
    if (ftsQuery) {
      try {
        const ftsConditions = [
          "(s.expires_at IS NULL OR s.expires_at > datetime('now'))",
        ];
        const ftsParams: any[] = [];
        pushQueryScope(ftsConditions, ftsParams, "semantic", "s", scope.asOf);
        if (category) {
          ftsConditions.push("s.category = ?");
          ftsParams.push(category);
        }
        if (appendRelevanceScope(ftsConditions, ftsParams, "s.source_session_id", scope.projectSessionIds, "s.category") === "none") {
          return [];
        }
        rows = await fts5MatchJoin(
          db,
          `WITH hits AS (
             SELECT rowid AS id, bm25(brain_semantic_fts, 5.0, 1.0, 3.0) AS rank
             FROM brain_semantic_fts
             WHERE brain_semantic_fts MATCH ?
             ORDER BY rank
             LIMIT ?
           )
           SELECT s.* FROM hits JOIN brain_semantic s ON s.id = hits.id
           WHERE ${ftsConditions.join(" AND ")}
           ORDER BY hits.rank
           LIMIT ?`,
          ftsQuery,
          ftsParams,
          poolSize,
        );
        ftsUsed = true;
      } catch {
        rows = []; // FTS5 unavailable: LIKE pool below
      }
    }

    // MEM-67: substring top-up is a table scan. Allow it only when FTS5 is
    // unavailable. Do not COUNT(*) the store to decide; that walk is O(N).
    if (rows.length < poolSize && !ftsUsed) {
      const seen = new Set<number>(rows.map((r: any) => r.id));
      params.push(poolSize);
      const likeRows = await db.all(`
        SELECT * FROM brain_semantic
        WHERE ${conditions.join(" AND ")}
        ORDER BY id DESC
        LIMIT ?
      `, params);
      for (const r of likeRows) {
        if (rows.length >= poolSize) break;
        if (!seen.has((r as any).id)) rows.push(r);
      }
    }

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
   * Graph channel: hub-damped PPR from query entities, then
   * S_graph(m,q) = max_e π_q(e) for entities mentioned in m.
   */
  private static async graphExpansion(
    query: string,
    scope: LexicalScope = {},
  ): Promise<{ scores: Map<number, number>; visited: number }> {
    const empty = { scores: new Map<number, number>(), visited: 0 };
    if (!hasGraphExpandableTokens(query)) return empty;
    try {
      return await KnowledgeGraph.searchMemoriesByPpr(query, {
        projectSessionIds: scope.projectSessionIds,
        asOf: scope.asOf,
      });
    } catch {
      return empty;
    }
  }

  private static async resolveWorkspaceDir(
    options: FusionOptions,
  ): Promise<string | undefined> {
    const explicit = options.workspaceDir?.trim();
    if (explicit) return explicit;
    if (!options.sessionId) return undefined;
    try {
      const session = await BrainStore.getSession(options.sessionId);
      const dir = session?.workspace_directory?.trim();
      return dir || undefined;
    } catch {
      return undefined;
    }
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
      inject_count: r.inject_count ?? 0,
      tier: r.tier,
      created_at: r.created_at,
      last_accessed_at: r.last_accessed_at,
      expires_at: r.expires_at,
      topic_id: r.topic_id ?? null,
      task_id: r.task_id ?? null,
      mismatch_count: r.mismatch_count ?? 0,
      mismatch_until: r.mismatch_until ?? null,
      mismatch_topic_id: r.mismatch_topic_id ?? null,
      tombstoned_at: r.tombstoned_at ?? null,
      tombstone_reason: r.tombstone_reason ?? null,
      stability: r.stability ?? null,
      difficulty: r.difficulty ?? 5,
      i0: r.i0 ?? null,
      helpful_count: r.helpful_count ?? 0,
      unhelpful_count: r.unhelpful_count ?? 0,
      valid_from: r.valid_from ?? null,
      valid_to: r.valid_to ?? null,
      src: r.src ?? null,
      recorded_at: r.recorded_at ?? null,
      closed_at: r.closed_at ?? null,
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
      tombstoned_at: r.tombstoned_at ?? null,
      tombstone_reason: r.tombstone_reason ?? null,
      stability: r.stability ?? null,
      difficulty: r.difficulty ?? 5,
      i0: r.i0 ?? null,
      helpful_count: r.helpful_count ?? 0,
      unhelpful_count: r.unhelpful_count ?? 0,
      valid_from: r.valid_from ?? null,
      valid_to: r.valid_to ?? null,
    };
  }

}
