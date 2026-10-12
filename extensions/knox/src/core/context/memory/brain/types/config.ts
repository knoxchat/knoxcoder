/** Memory Brain types: config. Re-exported from ../types.ts. */

import type { MemoryMode, MemoryScope } from "./pipeline.js";

/** Maximum memory context token ceiling (10M). W_max for injection budget. */
export const MEMORY_CONTEXT_TOKEN_CEILING = 10_000_000;

export interface MemoryConfig {
  auto_extract_enabled: boolean;
  auto_extract_min_importance: number;
  consolidation_interval_hours: number;
  max_episodic_per_session: number;
  max_hot_memories: number;
  hot_to_warm_hours: number;
  warm_to_cold_days: number;
  cold_prune_days: number;
  graph_enabled: boolean;
  learning_enabled: boolean;
  /** Active injection budget per turn (W_active). */
  context_max_tokens: number;
  /** Hard ceiling for context window (W_max). Default: 10M tokens. */
  max_context_tokens: number;
  /** Share of context_max_tokens reserved for C_goal. */
  context_goal_budget_ratio: number;
  /** How context is assembled: full, summarized (default), or selective. */
  memory_mode: MemoryMode;
  /** Minimum fusion score (θ) for retrieval. */
  retrieval_threshold: number;
  /** Default top-K for fusion retrieval. */
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
  /** Max knowledge graph entities before LRU refresh. */
  graph_max_entities: number;
  /** Max graph traversal depth. */
  graph_max_depth: number;
  /** Scope retrieval to current workspace by default. */
  memory_scope: MemoryScope;
  /** M₁ sensory buffer flush delay in milliseconds. */
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
  graph_depth_decay_gamma: number;
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

  // ── Hierarchy compression (C_effective = Σ |Mᵢ| / rᵢ) ───────────────────
  compression_ratio_active: number;
  compression_ratio_hot: number;
  compression_ratio_warm: number;
  compression_ratio_cold: number;
  compression_ratio_frozen: number;

  // ── Working memory (M₂) ───────────────────────────────────────────────────
  working_memory_max_slots: number;
  /** Fixed token budget; 0 = derive from context_max_tokens × working_memory_token_ratio */
  working_memory_token_budget: number;
  working_memory_token_ratio: number;
  working_memory_decay_rate: number;
  /** Item TTL in seconds (~30s per Knox-MS M₂ spec). */
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

  // ── Ebbinghaus forgetting curve (Part IV) ───────────────────────────────
  /** Base memory strength S₀ (days) — denominator baseline for R(t). */
  ebbinghaus_base_strength: number;
  /** Decay multiplier λ in R(t) = e^(-λt/S). Default 0.03 ≈ 3%/day. */
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
