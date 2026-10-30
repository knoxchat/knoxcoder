/**
 * MemoryConfigAccess — Single runtime accessor for all memory tunables.
 *
 * Defaults live ONLY in BrainStore.config. Every module reads values here
 * instead of embedding magic numbers. Addressable memory is C_addr = |M₃|+|M₄|+|M₅|
 * (raw tokens). Compression ratios and clock knobs are leftover display;
 * IMP-04 must not treat ratios as rᵢ capacity (MEM-11). Tiers are R/Value (MEM-15).
 */

import { resolvePprAlpha, resolvePprEpsilon } from "./channels/ppr.js";
import { BrainStore } from "./BrainStore.js";
import { detectIntent, type RetrievalIntent } from "./RetrievalQuery.js";
import type { MemoryConfig, MemoryMode } from "./types.js";

export interface ModeSettings {
  semanticLimit: number;
  episodicLimit: number;
  minImportance: number;
  includeEpisodic: boolean;
  includeGraph: boolean;
  includeProcedures: boolean;
  includePatterns: boolean;
  episodicSnippetLen: number;
  preferSummaries: boolean;
}

export interface ContextAssemblyLimits {
  graphEntitySearch: number;
  graphEntityDisplay: number;
  graphEdgePerEntity: number;
  graphEdgeBudgetRatio: number;
  procedureLimit: number;
  patternLimit: number;
  pinnedLimit: number;
  sessionSummaryMinTokens: number;
  lineTruncateChars: number;
  lineCompressChars: number;
  compressKeepLines: number;
}

export interface FusionParams {
  candidateMultiplier: number;
  candidateMin: number;
  graphDepthDecayGamma: number;
  graphMemoryBoostFactor: number;
  graphEntitySearchLimit: number;
  graphNeighborLimit: number;
  recencyDecayLambda: number;
}

export interface BudgetRatios {
  semantic: number;
  episodic: number;
  graph: number;
  procedures: number;
  patterns: number;
}

export interface CompressionRatios {
  active: number;
  hot: number;
  warm: number;
  cold: number;
  frozen: number;
}

export interface WorkingMemoryOptions {
  maxSlots: number;
  tokenBudget: number;
  decayRatePerSecond: number;
  ttlSeconds: number;
}

export interface IntegrationTimeouts {
  memoryBuildMs: number;
  trackSessionMs: number;
}

export type FusionWeightProfile =
  | "default"
  | "factual"
  | "conversational"
  | "procedural"
  | "code"
  | "continuation";

export const FUSION_WEIGHT_PROFILES: readonly FusionWeightProfile[] = [
  "default",
  "factual",
  "conversational",
  "procedural",
  "code",
  "continuation",
] as const;

export interface FusionWeights {
  fts5: number;
  trigram: number;
  graph: number;
  recency: number;
  importance: number;
}

export interface DetectFusionWeightsOptions {
  /** REL-01 intent. Continuation uses its own profile even after query expansion. */
  intent?: RetrievalIntent;
  /** Original user text. Retrieval queries are stopword-stripped and must not drive detection. */
  originalQuery?: string;
}

/** Lookup cues for the factual profile. Length alone must not select this profile (REL-09). */
const FACTUAL_LOOKUP =
  /\b(?:what(?:'s|\s+is|\s+are|\s+was|\s+were)\b|who(?:'s|\s+is|\s+are)\b|define\b|meaning\s+of\b)/i;

/** Read live config (always from BrainStore singleton). */
export function getMemoryConfig(): MemoryConfig {
  return BrainStore.getConfig();
}

/**
 * K-035: hard ceiling on tokens injected into one turn, whatever the stored
 * `context_max_tokens` says (its default ceiling is 10M, i.e. unlimited).
 * Override with `KNOX_MEMORY_INJECT_CAP` (minimum 500).
 */
export const MEMORY_INJECT_HARD_CAP_TOKENS = 8_000;

export function getMemoryInjectHardCap(): number {
  const raw = Number(process.env.KNOX_MEMORY_INJECT_CAP);
  return Number.isFinite(raw) && raw >= 500
    ? Math.floor(raw)
    : MEMORY_INJECT_HARD_CAP_TOKENS;
}

/** Active context window cap (W_max) — primary knob for injection budget. */
export function getContextMaxTokens(override?: number): number {
  const cfg = getMemoryConfig();
  const cap = override ?? cfg.context_max_tokens;
  return Math.min(cap, cfg.max_context_tokens);
}

/** C_goal token budget share. */
export function getGoalBudgetTokens(maxTokens: number): number {
  const cfg = getMemoryConfig();
  return Math.floor(maxTokens * cfg.context_goal_budget_ratio);
}

/** Mode-specific retrieval limits derived from retrieval_top_k. */
export function getModeSettings(mode: MemoryMode): ModeSettings {
  const cfg = getMemoryConfig();
  const k = cfg.retrieval_top_k;

  switch (mode) {
    case "full":
      return {
        semanticLimit: Math.ceil(k * cfg.mode_full_semantic_multiplier),
        episodicLimit: Math.ceil(k * cfg.mode_full_episodic_multiplier),
        minImportance: cfg.mode_full_min_importance,
        includeEpisodic: true,
        includeGraph: true,
        includeProcedures: true,
        includePatterns: true,
        episodicSnippetLen: cfg.mode_full_episodic_snippet_len,
        preferSummaries: false,
      };
    case "selective":
      return {
        semanticLimit: Math.ceil(k * cfg.mode_selective_semantic_multiplier),
        episodicLimit: Math.ceil(k * cfg.mode_selective_episodic_multiplier),
        minImportance: cfg.mode_selective_min_importance,
        includeEpisodic: cfg.mode_selective_include_episodic,
        includeGraph: true,
        includeProcedures: cfg.mode_selective_include_procedures,
        includePatterns: cfg.mode_selective_include_patterns,
        episodicSnippetLen: cfg.mode_selective_episodic_snippet_len,
        preferSummaries: false,
      };
    case "summarized":
    default:
      return {
        semanticLimit: Math.ceil(k * cfg.mode_summarized_semantic_multiplier),
        episodicLimit: Math.ceil(k * cfg.mode_summarized_episodic_multiplier),
        minImportance: cfg.mode_summarized_min_importance,
        includeEpisodic: true,
        includeGraph: true,
        includeProcedures: true,
        includePatterns: true,
        episodicSnippetLen: cfg.mode_summarized_episodic_snippet_len,
        preferSummaries: true,
      };
  }
}

export function getContextAssemblyLimits(): ContextAssemblyLimits {
  const cfg = getMemoryConfig();
  return {
    graphEntitySearch: cfg.context_graph_entity_search,
    graphEntityDisplay: cfg.context_graph_entity_display,
    graphEdgePerEntity: cfg.context_graph_edge_per_entity,
    graphEdgeBudgetRatio: cfg.context_graph_edge_budget_ratio,
    procedureLimit: cfg.context_procedure_limit,
    patternLimit: cfg.context_pattern_limit,
    pinnedLimit: cfg.context_pinned_limit,
    sessionSummaryMinTokens: cfg.context_session_summary_min_tokens,
    lineTruncateChars: cfg.context_line_truncate_chars,
    lineCompressChars: cfg.context_line_compress_chars,
    compressKeepLines: cfg.context_compress_keep_lines,
  };
}

export function getFusionParams(): FusionParams {
  const cfg = getMemoryConfig();
  return {
    candidateMultiplier: cfg.fusion_candidate_multiplier,
    candidateMin: cfg.fusion_candidate_min,
    graphDepthDecayGamma: cfg.graph_depth_decay_gamma,
    graphMemoryBoostFactor: cfg.graph_memory_boost_factor,
    graphEntitySearchLimit: cfg.graph_entity_search_limit,
    graphNeighborLimit: cfg.graph_neighbor_limit,
    recencyDecayLambda: cfg.recency_decay_lambda,
  };
}

export function getBudgetRatios(): BudgetRatios {
  const cfg = getMemoryConfig();
  return {
    semantic: cfg.budget_semantic_ratio,
    episodic: cfg.budget_episodic_ratio,
    graph: cfg.budget_graph_ratio,
    procedures: cfg.budget_procedures_ratio,
    patterns: cfg.budget_patterns_ratio,
  };
}

/** Normalize leftover rᵢ knobs. Legacy configs stored a divisor (2 → 0.5). Not C_addr. */
export function normalizeCompressionRatio(value: number): number {
  if (value > 1) return 1 / value;
  return Math.max(0.01, value);
}

/** Leftover hierarchy compression factors (rᵢ). Display-only; never divide C_addr. */
export function getCompressionRatios(): CompressionRatios {
  const cfg = getMemoryConfig();
  return {
    active: normalizeCompressionRatio(cfg.compression_ratio_active),
    hot: normalizeCompressionRatio(cfg.compression_ratio_hot),
    warm: normalizeCompressionRatio(cfg.compression_ratio_warm),
    cold: normalizeCompressionRatio(cfg.compression_ratio_cold),
    frozen: normalizeCompressionRatio(cfg.compression_ratio_frozen),
  };
}

/** Raw sum of SQLite tier token counts. Not C_addr and not Σ |Mᵢ|/rᵢ. */
export function calculateEffectiveContext(tierTokens: Record<string, number>): number {
  let total = 0;
  for (const count of Object.values(tierTokens)) {
    if (typeof count === "number" && count > 0) total += count;
  }
  return total;
}

export function getWorkingMemoryOptions(): WorkingMemoryOptions {
  const cfg = getMemoryConfig();
  const derived =
    cfg.working_memory_token_budget > 0
      ? cfg.working_memory_token_budget
      : Math.floor(cfg.context_max_tokens * cfg.working_memory_token_ratio);
  /** Knox-MS M₂ spec cap: 30K tokens (IMP-05). */
  const tokenBudget = Math.min(derived, 30_000);
  return {
    maxSlots: cfg.working_memory_max_slots,
    tokenBudget,
    decayRatePerSecond: cfg.working_memory_decay_rate,
    ttlSeconds: cfg.working_memory_ttl_seconds,
  };
}

export function getIntegrationTimeouts(): IntegrationTimeouts {
  const cfg = getMemoryConfig();
  return {
    memoryBuildMs: cfg.memory_build_timeout_ms,
    trackSessionMs: cfg.memory_track_session_timeout_ms,
  };
}

/** Minimum combined turn length before post-turn extraction (IMP-21/E). */
export function getPostTurnMinChars(): number {
  const cfg = getMemoryConfig();
  return Math.max(0, cfg.post_turn_min_chars ?? 80);
}

export interface EbbinghausConfig {
  baseStrength: number;
  lambda: number;
  pruneThreshold: number;
  reviewThreshold: number;
  strengtheningAlpha: number;
  repetitionBeta: number;
  salienceWeight: number;
  importanceWeight: number;
}

export function getEbbinghausConfig(): EbbinghausConfig {
  const cfg = getMemoryConfig();
  return {
    baseStrength: cfg.ebbinghaus_base_strength,
    lambda: cfg.ebbinghaus_lambda,
    pruneThreshold: cfg.ebbinghaus_prune_threshold,
    reviewThreshold: cfg.ebbinghaus_review_threshold,
    strengtheningAlpha: cfg.ebbinghaus_strengthening_alpha,
    repetitionBeta: cfg.ebbinghaus_repetition_beta,
    salienceWeight: cfg.ebbinghaus_salience_weight,
    importanceWeight: cfg.ebbinghaus_importance_weight,
  };
}

/** Revised Knox-MS parameter table. forgetting_F / forgetting_c (MEM-12), FSRS a/b/g (MEM-14), κ / θ_arch (MEM-13), RRF k₀ / w_s (MEM-20), η_U / η_R (MEM-21), fused-candidate / θ cut-off (MEM-22), and PPR α / ε (MEM-25) are live. */
export interface TheoremParams {
  forgettingF: number;
  forgettingC: number;
  fsrsA: number;
  fsrsB: number;
  fsrsG: number;
  utilityKappa: number;
  archiveValueThreshold: number;
  rrfK0: number;
  etaUtility: number;
  etaRetrievability: number;
  treeBranchingB: number;
  treeBeamB: number;
  coverageLambda: number;
  wMemTokens: number;
  fusionCandidateCutoff: number;
  calibratedTheta: number;
  pprAlpha: number;
  pprEpsilon: number;
  channelWeights: { lexical: number; ripgrep: number; graph: number; tree: number };
}

export function getTheoremParams(): TheoremParams {
  const cfg = getMemoryConfig();
  return {
    forgettingF: cfg.forgetting_F,
    forgettingC: cfg.forgetting_c,
    fsrsA: cfg.fsrs_a,
    fsrsB: cfg.fsrs_b,
    fsrsG: cfg.fsrs_g,
    utilityKappa: cfg.utility_kappa,
    archiveValueThreshold: cfg.archive_value_threshold,
    rrfK0: cfg.rrf_k0,
    etaUtility: cfg.eta_utility,
    etaRetrievability: cfg.eta_retrievability,
    treeBranchingB: cfg.tree_branching_b,
    treeBeamB: cfg.tree_beam_B,
    coverageLambda: cfg.coverage_lambda,
    wMemTokens: cfg.w_mem_tokens,
    fusionCandidateCutoff: cfg.fusion_candidate_cutoff,
    calibratedTheta: cfg.calibrated_theta,
    pprAlpha: resolvePprAlpha(cfg.ppr_alpha),
    pprEpsilon: resolvePprEpsilon(cfg.ppr_epsilon),
    channelWeights: {
      lexical: cfg.w_lexical,
      ripgrep: cfg.w_ripgrep,
      graph: cfg.w_graph,
      tree: cfg.w_tree,
    },
  };
}

export function getFusionWeights(profile: FusionWeightProfile): FusionWeights {
  const cfg = getMemoryConfig();
  switch (profile) {
    case "factual":
      return {
        fts5: cfg.fusion_factual_fts5,
        trigram: cfg.fusion_factual_trigram,
        graph: cfg.fusion_factual_graph,
        recency: cfg.fusion_factual_recency,
        importance: cfg.fusion_factual_importance,
      };
    case "conversational":
      return {
        fts5: cfg.fusion_conversational_fts5,
        trigram: cfg.fusion_conversational_trigram,
        graph: cfg.fusion_conversational_graph,
        recency: cfg.fusion_conversational_recency,
        importance: cfg.fusion_conversational_importance,
      };
    case "procedural":
      return {
        fts5: cfg.fusion_procedural_fts5,
        trigram: cfg.fusion_procedural_trigram,
        graph: cfg.fusion_procedural_graph,
        recency: cfg.fusion_procedural_recency,
        importance: cfg.fusion_procedural_importance,
      };
    case "code":
      return {
        fts5: cfg.fusion_code_fts5,
        trigram: cfg.fusion_code_trigram,
        graph: cfg.fusion_code_graph,
        recency: cfg.fusion_code_recency,
        importance: cfg.fusion_code_importance,
      };
    case "continuation":
      return {
        fts5: cfg.fusion_continuation_fts5,
        trigram: cfg.fusion_continuation_trigram,
        graph: cfg.fusion_continuation_graph,
        recency: cfg.fusion_continuation_recency,
        importance: cfg.fusion_continuation_importance,
      };
    case "default":
    default:
      return {
        fts5: cfg.fusion_default_fts5,
        trigram: cfg.fusion_default_trigram,
        graph: cfg.fusion_default_graph,
        recency: cfg.fusion_default_recency,
        importance: cfg.fusion_default_importance,
      };
  }
}

/**
 * Leftover additive-profile safety (REL-09). Live retrieve scores by RRF
 * (MEM-20); recency + importance are not channels.
 */
export function fusionWeightsAreSafe(
  weights: FusionWeights,
  retrievalThreshold: number,
): boolean {
  return weights.recency + weights.importance < retrievalThreshold;
}

/** Auto-detect which fusion weight profile a query should use. */
export function detectFusionProfile(
  query: string,
  options?: DetectFusionWeightsOptions,
): FusionWeightProfile {
  const cfg = getMemoryConfig();
  const source = options?.originalQuery ?? query;
  const intent = options?.intent ?? detectIntent(source);
  if (intent === "continuation") {
    return "continuation";
  }

  const lower = source.toLowerCase();

  if (/\b(how\s+to|steps|workflow|procedure|guide|process|setup)\b/.test(lower)) {
    return "procedural";
  }

  if (
    source.includes("```") ||
    source.includes("()") ||
    source.includes("=>") ||
    /\b(error|bug|fix|debug|exception|crash|function|class|method)\b/.test(lower)
  ) {
    return "code";
  }

  if (
    source.length > cfg.fusion_conversational_min_chars ||
    (source.includes("?") && source.length > cfg.budget_query_short_threshold_chars)
  ) {
    return "conversational";
  }

  // Factual lookups only — never classify on length < 80 alone (REL-09).
  if (FACTUAL_LOOKUP.test(lower) && source.length <= cfg.fusion_factual_max_chars) {
    return "factual";
  }

  return "default";
}

/** Auto-detect query type and return config-driven fusion weights. */
export function detectFusionWeights(
  query: string,
  options?: DetectFusionWeightsOptions,
): FusionWeights {
  return getFusionWeights(detectFusionProfile(query, options));
}

export interface BudgetQueryAdjustments {
  proceduralBoost: number;
  graphBoost: number;
  patternsBoost: number;
  episodicLongBoost: number;
  semanticShortBoost: number;
  longThresholdChars: number;
  shortThresholdChars: number;
  minSemantic: number;
  minEpisodic: number;
  minGraph: number;
  minProcedures: number;
  minPatterns: number;
}

export function getBudgetQueryAdjustments(): BudgetQueryAdjustments {
  const cfg = getMemoryConfig();
  return {
    proceduralBoost: cfg.budget_query_procedural_boost,
    graphBoost: cfg.budget_query_graph_boost,
    patternsBoost: cfg.budget_query_patterns_boost,
    episodicLongBoost: cfg.budget_query_episodic_long_boost,
    semanticShortBoost: cfg.budget_query_semantic_short_boost,
    longThresholdChars: cfg.budget_query_long_threshold_chars,
    shortThresholdChars: cfg.budget_query_short_threshold_chars,
    minSemantic: cfg.budget_min_semantic_ratio,
    minEpisodic: cfg.budget_min_episodic_ratio,
    minGraph: cfg.budget_min_graph_ratio,
    minProcedures: cfg.budget_min_procedures_ratio,
    minPatterns: cfg.budget_min_patterns_ratio,
  };
}
