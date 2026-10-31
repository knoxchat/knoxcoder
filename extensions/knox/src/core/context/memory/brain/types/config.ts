/** Memory Brain types: config. Re-exported from ../types.ts. */

import type { MemoryMode, MemoryScope } from "./pipeline.js";

/**
 * Leftover stored ceiling (10M). Not live W (MEM-27).
 * W is `resolveContextWindow(llm).contextLength` of the routed model.
 */
export const MEMORY_CONTEXT_TOKEN_CEILING = 10_000_000;

export interface MemoryConfig {
  auto_extract_enabled: boolean;
  auto_extract_min_importance: number;
  consolidation_interval_hours: number;
  max_episodic_per_session: number;
  /** Unused leftover count cap (MEM-15). Tiers come from R / Value, not a 500-hot quota. */
  max_hot_memories: number;
  /** Unused leftover clock (MEM-15). Tiers come from R / Value. */
  hot_to_warm_hours: number;
  /** Unused leftover clock (MEM-15). Tiers come from R / Value. */
  warm_to_cold_days: number;
  /** Unused leftover clock (MEM-15). Tiers come from R / Value. */
  cold_prune_days: number;
  graph_enabled: boolean;
  learning_enabled: boolean;
  /**
   * Leftover stored ceiling. Live W is the routed model's window (MEM-27).
   * Do not use this as the inject budget.
   */
  context_max_tokens: number;
  /** Leftover stored ceiling alias. Not live W (MEM-27). */
  max_context_tokens: number;
  /** Share of context_max_tokens reserved for C_goal. */
  context_goal_budget_ratio: number;
  /** How context is assembled: full, summarized (default), or selective. */
  memory_mode: MemoryMode;
  /** Calibrated P(helpful) cut-off (θ) after the fused-candidate list (MEM-22). */
  retrieval_threshold: number;
  /** Default top-K returned after fused candidates and the θ cut-off (MEM-22). */
  retrieval_top_k: number;
  /** Expand continuation queries with topic + last substantial turn (REL-01). */
  retrieval_continuation_expand: boolean;
  /** AND content words in FTS5 MATCH instead of OR-all-terms (REL-01). */
  fts5_use_and_for_content: boolean;
  /** Jaccard below this vs active topic ⇒ new task (REL-01). */
  topic_shift_jaccard: number;
  /** REL-03 lexical/entity requirement. False = inject more (debug). */
  retrieval_require_lexical: boolean;
  /** REL-06 working-memory mismatch decay per attendTo. */
  wm_mismatch_decay: number;
  /** REL-06 minimum relevance to inject a WM slot. */
  wm_inject_min_relevance: number;
  /** REL-10 session-summary keyword overlap (non-full modes). */
  summary_inject_min_overlap: number;
  /** REL-10 unmatched pinned items kept when none match the query. */
  pinned_unmatched_cap: number;
  /** Unused leftover cap (MEM-25). Graph has no entity capacity. */
  graph_max_entities: number;
  /** Explore display hop cap. Live retrieve is push-PPR, not BFS depth. */
  graph_max_depth: number;
  /** Scope retrieval to current workspace by default. */
  memory_scope: MemoryScope;
  /**
   * Optional M₁ debounce in milliseconds (MEM-33).
   * 0 = flush only on the turn boundary. Not the theorem lifetime.
   */
  sensory_buffer_ms: number;
  /** Auto-summarize sessions on close. */
  auto_summarize: boolean;
  /** Message count before auto-summarize triggers. */
  summarize_threshold: number;
  /** Extract facts/concepts after turns (mirrors Knox extract_knowledge). */
  enable_knowledge_extraction: boolean;
  /** Minimum combined turn length (chars) before post-turn extraction runs. */
  post_turn_min_chars: number;

  // ── Mode limits (multipliers × retrieval_top_k unless noted) ─────────────
  mode_full_semantic_multiplier: number;
  mode_full_episodic_multiplier: number;
  mode_full_min_importance: number;
  mode_full_episodic_snippet_len: number;
  mode_summarized_semantic_multiplier: number;
  mode_summarized_episodic_multiplier: number;
  mode_summarized_min_importance: number;
  mode_summarized_episodic_snippet_len: number;
  mode_selective_semantic_multiplier: number;
  mode_selective_episodic_multiplier: number;
  mode_selective_min_importance: number;
  mode_selective_episodic_snippet_len: number;
  mode_selective_include_episodic: boolean;
  mode_selective_include_procedures: boolean;
  mode_selective_include_patterns: boolean;

  // ── Context assembly limits ─────────────────────────────────────────────
  context_graph_entity_search: number;
  context_graph_entity_display: number;
  context_graph_edge_per_entity: number;
  context_graph_edge_budget_ratio: number;
  context_procedure_limit: number;
  context_pattern_limit: number;
  context_pinned_limit: number;
  context_session_summary_min_tokens: number;
  context_line_truncate_chars: number;
  context_line_compress_chars: number;
  context_compress_keep_lines: number;

  // ── Token budget ratios (base allocation) ─────────────────────────────────
  budget_semantic_ratio: number;
  budget_episodic_ratio: number;
  budget_graph_ratio: number;
  budget_procedures_ratio: number;
  budget_patterns_ratio: number;
  budget_min_semantic_ratio: number;
  budget_min_episodic_ratio: number;
  budget_min_graph_ratio: number;
  budget_min_procedures_ratio: number;
  budget_min_patterns_ratio: number;
  budget_query_procedural_boost: number;
  budget_query_graph_boost: number;
  budget_query_patterns_boost: number;
  budget_query_episodic_long_boost: number;
  budget_query_semantic_short_boost: number;
  budget_query_long_threshold_chars: number;
  budget_query_short_threshold_chars: number;

  // ── Fusion retrieval ────────────────────────────────────────────────────
  fusion_candidate_multiplier: number;
  fusion_candidate_min: number;
  /** Unused leftover BFS γ (MEM-25). Live graph score is hub-damped PPR. */
  graph_depth_decay_gamma: number;
  /** Unused leftover additive graph boost (MEM-25). S_graph is max π. */
  graph_memory_boost_factor: number;
  graph_entity_search_limit: number;
  graph_neighbor_limit: number;
  graph_neighbor_memory_limit: number;
  graph_indirect_neighbor_factor: number;
  recency_decay_lambda: number;
  fusion_conversational_min_chars: number;
  fusion_factual_max_chars: number;
  fusion_default_fts5: number;
  fusion_default_trigram: number;
  fusion_default_graph: number;
  fusion_default_recency: number;
  fusion_default_importance: number;
  fusion_factual_fts5: number;
  fusion_factual_trigram: number;
  fusion_factual_graph: number;
  fusion_factual_recency: number;
  fusion_factual_importance: number;
  fusion_conversational_fts5: number;
  fusion_conversational_trigram: number;
  fusion_conversational_graph: number;
  fusion_conversational_recency: number;
  fusion_conversational_importance: number;
  fusion_procedural_fts5: number;
  fusion_procedural_trigram: number;
  fusion_procedural_graph: number;
  fusion_procedural_recency: number;
  fusion_procedural_importance: number;
  fusion_code_fts5: number;
  fusion_code_trigram: number;
  fusion_code_graph: number;
  fusion_code_recency: number;
  fusion_code_importance: number;
  fusion_continuation_fts5: number;
  fusion_continuation_trigram: number;
  fusion_continuation_graph: number;
  fusion_continuation_recency: number;
  fusion_continuation_importance: number;
  /** Rule-based synonym/concept expansion for fusion (no ML). */
  enable_enhanced_semantic: boolean;

  // Leftover rᵢ knobs (hidden). Not C_addr. IMP-04 asserts raw |M₃|+|M₄|+|M₅|.
  compression_ratio_active: number;
  compression_ratio_hot: number;
  compression_ratio_warm: number;
  compression_ratio_cold: number;
  compression_ratio_frozen: number;

  // ── Working memory (M₂) ───────────────────────────────────────────────────
  /** UX scratchpad slot count for this call. Not W_mem. */
  working_memory_max_slots: number;
  /**
   * M₂ scratchpad token cap. 0 = derive from live W × ratio.
   * Not W_mem (inject budget) and not a 30K theorem spec (MEM-33).
   */
  working_memory_token_budget: number;
  working_memory_token_ratio: number;
  working_memory_decay_rate: number;
  /**
   * Optional leftover eviction clock in seconds (MEM-33).
   * 0 = session/call lifetime (no wall-clock TTL). Not a 30s spec.
   */
  working_memory_ttl_seconds: number;

  // ── Task difficulty routing (IMP-17) ──────────────────────────────────────
  /** Model ID for easy sub-tasks (empty = use current model). */
  easy_model: string;
  /** Model ID for medium sub-tasks. */
  medium_model: string;
  /** Model ID for hard sub-tasks. */
  hard_model: string;
  /** Max outer iterations for local autonomous loop. 0 = unlimited (stop with Cancel). */
  autonomous_max_iterations: number;

  // ── Revised theorem parameters (MEM-02). forgetting_F / forgetting_c (MEM-12), FSRS a/b/g (MEM-14), and κ / θ_arch (MEM-13) are live. ──
  /** Power-law F in R(t,S)=(1+F·t/S)^(-c). Theorem default 19/81. */
  forgetting_F: number;
  /** Power-law exponent c. Theorem default 0.5. */
  forgetting_c: number;
  /** FSRS stability-gain a (e^1.5). */
  fsrs_a: number;
  /** FSRS saturation exponent b. */
  fsrs_b: number;
  /** FSRS spacing gain g. */
  fsrs_g: number;
  /** Utility prior strength κ in U=(h+κ I₀)/(h+u+κ). */
  utility_kappa: number;
  /** Archive when Value < θ_arch (do not DELETE). */
  archive_value_threshold: number;
  /** Reciprocal Rank Fusion k₀ (live in MEM-20). */
  rrf_k0: number;
  /** Prior modulation η_U on U (live in MEM-21). */
  eta_utility: number;
  /** Prior modulation η_R on retrievability R (live in MEM-21). */
  eta_retrievability: number;
  /** Summary-tree branching factor b. */
  tree_branching_b: number;
  /** Summary-tree beam width B. */
  tree_beam_B: number;
  /** Submodular coverage weight λ. Live in MEM-29. */
  coverage_lambda: number;
  /** Local C_mem cap (tokens). Live in MEM-28 when the W remainder is larger. */
  w_mem_tokens: number;
  /** Fused candidates before the calibrated θ cut-off (MEM-22). */
  fusion_candidate_cutoff: number;
  /**
   * Fitted P(helpful | injected) from `brain_attribution` (MEM-18).
   * Sleep copies this into live `retrieval_threshold` (MEM-22).
   */
  calibrated_theta: number;
  /** RRF channel weight — lexical (BM25 + trigram + synonyms). */
  w_lexical: number;
  /** RRF channel weight — ripgrep. */
  w_ripgrep: number;
  /** PPR restart α. Theorem default 0.15 (MEM-25). */
  ppr_alpha: number;
  /** Push-PPR residual tolerance ε. Cost is O(1/(αε)). */
  ppr_epsilon: number;
  /** RRF channel weight — graph PPR. */
  w_graph: number;
  /** RRF channel weight — summary tree. */
  w_tree: number;

  // ── Leftover Ebbinghaus knobs (live R is power-law F/c + category S₀) ──
  /** Leftover S₀ for memoryStrength. Live S is stored stability / FSRS. */
  ebbinghaus_base_strength: number;
  /** Leftover exponential λ. Live R uses forgetting_F / forgetting_c. */
  ebbinghaus_lambda: number;
  /** Prune threshold θ_prune — memories below this retention are candidates for removal. */
  ebbinghaus_prune_threshold: number;
  /** Review threshold — spaced repetition surfaces memories below this retention. */
  ebbinghaus_review_threshold: number;
  /** α — access strengthening factor in I(m,t) = I₀·R(t)·(1+α·access_count). */
  ebbinghaus_strengthening_alpha: number;
  /** β — strength gain per access in S_new = S_old + β. */
  ebbinghaus_repetition_beta: number;
  /** Salience contribution to S(m). */
  ebbinghaus_salience_weight: number;
  /** Importance contribution to S(m). */
  ebbinghaus_importance_weight: number;

  // ── IDE integration timeouts ──────────────────────────────────────────────
  memory_build_timeout_ms: number;
  memory_track_session_timeout_ms: number;

  // LLM-enhanced features
  llm_entity_extraction_enabled: boolean;
  llm_summarization_enabled: boolean;
  llm_importance_scoring_enabled: boolean;
  llm_post_action_memory_enabled: boolean;
  // Rate limiting for LLM memory calls
  llm_calls_per_hour_limit: number;
  llm_tokens_per_hour_limit: number;
  // User preferences
  preferred_summary_detail: "brief" | "detailed";
  auto_checkpoint_interval: number; // 0 = disabled, N = every N consolidations
  /** Cap on `brain.sqlite` (+ WAL) in bytes. `0` disables. Env `KNOX_BRAIN_MAX_BYTES` overrides. */
  max_bytes: number;
}
