/**
 * Types for the Memory Brain system.
 *
 * Human-brain-like persistent memory that spans all conversation sessions,
 * enabling unlimited context window with any LLM.
 *
 * Modeled after Knox-MS architecture patterns:
 * - Episodic memory (conversation turns / events)
 * - Semantic memory (facts, knowledge, summaries)
 * - Procedural memory (learned patterns, workflows)
 * - Knowledge graph (entities & relationships)
 * - Learning engine (pattern detection & suggestion)
 * - Auto-memory extraction (automatic fact extraction)
 * - Smart context builder (token-budgeted context assembly)
 * - Memory consolidation (hot → warm → cold tiering via importance decay)
 * - Self-management (health checks, optimization, auto-cleanup)
 * - Import/Export (backup & restore)
 */

// ── Core Memory Types ────────────────────────────────────────────────────────

export type MemoryBrainAction =
  | "store"
  | "recall"
  | "search"
  | "summarize_session"
  | "list_sessions"
  | "get_session"
  | "close_session"
  | "delete"
  | "mismatch"
  | "get_stats"
  | "consolidate"
  | "associate"
  // Knowledge Graph actions
  | "add_entity"
  | "search_entities"
  | "add_edge"
  | "explore_graph"
  | "get_graph_stats"
  | "extract_entities"
  // Learning Pattern actions
  | "learn_pattern"
  | "suggest_approach"
  | "get_patterns"
  // Procedural Memory actions
  | "store_procedure"
  | "get_procedures"
  | "execute_procedure"
  // Auto-memory actions
  | "auto_extract"
  // Context actions
  | "build_context"
  | "run_pipeline"
  | "get_phase_status"
  | "get_effective_context"
  // Tagging actions
  | "tag"
  | "untag"
  | "search_by_tag"
  // Collection actions
  | "create_collection"
  | "list_collections"
  | "add_to_collection"
  // Import/Export
  | "export"
  | "import"
  // Self-management
  | "get_health"
  | "optimize"
  | "get_config"
  | "update_config"
  // Cross-session backlog search
  | "search_backlogs"
  // LLM-enhanced actions
  | "llm_extract_entities"
  | "llm_summarize_session"
  | "llm_evaluate_importance"
  | "llm_post_action_memory"
  // Checkpoint/rollback
  | "create_checkpoint"
  | "list_checkpoints"
  | "rollback_checkpoint"
  | "delete_checkpoint"
  // Audit trail
  | "get_audit_log"
  // Session topics
  | "get_session_topics"
  // Performance & self-management (Tier B)
  | "get_metrics"
  | "get_health_score"
  | "get_capacity_forecast"
  | "heal"
  | "get_healing_strategies"
  | "get_consolidation_stats"
  // Checkpoint strategies & lifecycle (Tier C)
  | "checkpoint_strategy_config"
  | "update_checkpoint_strategy"
  | "checkpoint_lifecycle_cleanup"
  | "compress_checkpoint"
  | "diff_checkpoint"
  // Event replay & undo (Tier C)
  | "replay_events"
  | "undo_operation"
  | "get_undoable_operations"
  // Batch operations (Tier C)
  | "batch_delete"
  | "batch_store"
  | "batch_audit_log"
  | "batch_update_importance"
  | "batch_move_tier"
  // Related sessions & hierarchy (Tier D)
  | "find_related_sessions"
  | "five_tier_consolidate"
  | "get_tier_distribution"
  | "get_tier_configs"
  | "update_tier_config"
  // Root cause analysis (Tier D)
  | "root_cause_analysis"
  // Spaced repetition (Tier D)
  | "get_review_due"
  | "boost_memory"
  // LRU cache (Tier D)
  | "get_cache_stats"
  | "clear_cache"
  // Metrics storage (Tier D)
  | "store_metrics_snapshot"
  | "get_metrics_trend";

export type MemoryTier = "active" | "hot" | "warm" | "cold" | "frozen";

export type EpisodicType = "user_message" | "assistant_message" | "tool_call" | "tool_result" | "system";

export type SemanticCategory =
  | "fact"
  | "preference"
  | "decision"
  | "summary"
  | "insight"
  | "code_pattern"
  | "error_fix"
  | "project_context"
  | "workflow";

// ── Emotional / Salience Tagging ─────────────────────────────────────────────

export type EmotionalValence =
  | "positive"     // success, excitement, satisfaction
  | "negative"     // frustration, error, failure
  | "neutral"      // informational, routine
  | "surprise"     // unexpected result, discovery
  | "urgency"      // deadline, critical, must-fix
  | "curiosity";   // exploration, learning, question

// ── Knowledge Graph Types ────────────────────────────────────────────────────

export type EntityType =
  | "person"
  | "organization"
  | "technology"
  | "concept"
  | "project"
  | "file"
  | "function"
  | "class"
  | "variable"
  | "location"
  | "event"
  | "product"
  | "custom";

export interface GraphEntity {
  id: number;
  name: string;
  entity_type: EntityType;
  description: string;
  properties: string; // JSON
  confidence: number;
  mention_count: number;
  created_at: string;
  updated_at: string;
}

export interface GraphEdge {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relationship: string;
  weight: number;
  properties: string; // JSON
  created_at: string;
}

// ── Learning Pattern Types ───────────────────────────────────────────────────

export type GoalType =
  | "coding"
  | "analysis"
  | "research"
  | "creative"
  | "debugging"
  | "documentation"
  | "explanation"
  | "planning"
  | "conversation"
  | "other";

export interface LearningPattern {
  id: number;
  goal_type: GoalType;
  pattern_signature: string;
  description: string;
  success_count: number;
  failure_count: number;
  confidence: number;
  avg_tokens_used: number;
  last_used_at: string;
  created_at: string;
  metadata: string; // JSON
}

// ── Procedural Memory Types ──────────────────────────────────────────────────

export interface ProceduralMemory {
  id: number;
  name: string;
  description: string;
  steps: string; // JSON array of steps
  trigger_pattern: string;
  success_rate: number;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  category: string;
}

// ── Tag & Collection Types ───────────────────────────────────────────────────

export interface MemoryTag {
  id: number;
  memory_type: "semantic" | "episodic" | "entity" | "procedure";
  memory_id: number;
  tag: string;
  created_at: string;
}

export interface MemoryCollection {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface CollectionItem {
  id: number;
  collection_id: number;
  memory_type: "semantic" | "episodic" | "entity" | "procedure";
  memory_id: number;
  added_at: string;
}

// ── Database Row Types ───────────────────────────────────────────────────────

export interface BrainSession {
  id: string;
  title: string;
  workspace_directory: string;
  /** Hash of workspace_directory — local project scope for retrieval. */
  project_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  summary: string | null;
  is_active: boolean;
}

/** C_effective metrics for local unlimited-context dashboard. */
export interface EffectiveContextMetrics {
  /** W_max — configured active context window budget. */
  active_window_tokens: number;
  context_max_tokens?: number;
  /** Tokens in the last injected context (actual usage). */
  last_context_tokens_used?: number;
  last_context_max_tokens?: number;
  /** last_context_tokens_used / W_max (0–1). */
  window_utilization?: number;
  tier_tokens: Record<string, number>;
  hierarchy_effective_tokens: number;
  memory_levels?: Array<{
    id: string;
    name: string;
    tokens: number;
    ratio: number;
    effective_tokens: number;
  }>;
  working_memory_tokens?: number;
  working_memory_budget?: number;
  sensory_buffer_tokens?: number;
  graph_entity_count: number;
  total_effective: number;
  compression_ratios: Record<string, number>;
  memory_tokens_saved?: number;
}

export interface EpisodicMemory {
  id: number;
  session_id: string;
  type: EpisodicType;
  role: string;
  content: string;
  token_count: number;
  importance_score: number;
  emotional_valence: EmotionalValence;
  salience: number; // 0.0–1.0 emotional intensity/salience
  tier: MemoryTier;
  metadata: string; // JSON
  created_at: string;
}

export interface SemanticMemory {
  id: number;
  category: SemanticCategory;
  title: string;
  content: string;
  source_session_id: string | null;
  keywords: string;
  importance_score: number;
  emotional_valence: EmotionalValence;
  salience: number;
  retrieval_count: number;
  tier: MemoryTier;
  created_at: string;
  last_accessed_at: string;
  expires_at: string | null;
  /** REL-05: session topic this fact was extracted under. Null for legacy rows. */
  topic_id: number | null;
  /** REL-13: open task this fact was extracted under. Null for legacy rows. */
  task_id: string | null;
  /** REL-14: times the user marked this memory "Not relevant". */
  mismatch_count: number;
  /** REL-14: demote expiry (ISO). Null when not demoted. */
  mismatch_until: string | null;
  /** REL-14: topic the demote applies to. Null = all topics for N days. */
  mismatch_topic_id: number | null;
}

export interface MemoryAssociation {
  id: number;
  source_type: "episodic" | "semantic";
  source_id: number;
  target_type: "episodic" | "semantic";
  target_id: number;
  relationship: string;
  strength: number;
  created_at: string;
}

// ── Input Types ──────────────────────────────────────────────────────────────

export interface StoreInput {
  category: SemanticCategory;
  title: string;
  content: string;
  keywords?: string;
  importance?: number;
  session_id?: string;
  ttl_days?: number | null;
  emotional_valence?: EmotionalValence;
  salience?: number;
  /** REL-05: attach to the session's current topic when omitted. */
  topic_id?: number | null;
  /** REL-13: attach to the session's open task when omitted. */
  task_id?: string | null;
}

export interface RecallInput {
  query: string;
  category?: SemanticCategory;
  session_id?: string;
  limit?: number;
  include_episodic?: boolean;
}

export interface SessionSummaryInput {
  session_id: string;
}

export interface AssociateInput {
  source_type: "episodic" | "semantic";
  source_id: number;
  target_type: "episodic" | "semantic";
  target_id: number;
  relationship: string;
  strength?: number;
}

export interface AddEntityInput {
  name: string;
  entity_type: EntityType;
  description?: string;
  properties?: Record<string, any>;
  confidence?: number;
}

export interface AddEdgeInput {
  source_entity_id: number;
  target_entity_id: number;
  relationship: string;
  weight?: number;
  properties?: Record<string, any>;
}

export interface ExploreGraphInput {
  entity_id: number;
  depth?: number; // default 2
  limit?: number;
}

export interface LearnPatternInput {
  goal_type: GoalType;
  pattern_signature: string;
  description: string;
  success: boolean;
  tokens_used?: number;
  metadata?: Record<string, any>;
}

export interface StoreProcedureInput {
  name: string;
  description: string;
  steps: string[]; // ordered steps
  trigger_pattern: string;
  category?: string;
}

export interface TagInput {
  memory_type: "semantic" | "episodic" | "entity" | "procedure";
  memory_id: number;
  tag: string;
}

export interface CollectionInput {
  name: string;
  description?: string;
}

export interface AddToCollectionInput {
  collection_id: number;
  memory_type: "semantic" | "episodic" | "entity" | "procedure";
  memory_id: number;
}

export type MemoryPhase =
  | "sensory_input"
  | "encoding"
  | "working_memory"
  | "consolidation"
  | "long_term_storage"
  | "retrieval"
  | "sleep_consolidation"
  | "output_generation";

export interface PipelinePhaseResult {
  phase: MemoryPhase;
  duration_ms: number;
  success: boolean;
  detail?: string;
  /** Structured extras merged into `brain_audit_log.details` (REL-19). */
  audit?: Record<string, unknown>;
}

/** Part III 8-phase cycle status (IMP-01). */
export interface MemoryPhaseStatus {
  active_phase: MemoryPhase | null;
  last_completed: { phase: MemoryPhase; at: number } | null;
  phase_counts: Partial<Record<MemoryPhase, number>>;
  /** ∀t: Σ 1[active(φᵢ,t)] ≥ 1 — true when a phase ran recently or φ₇ scheduler is active. */
  cycle_invariant_met: boolean;
  background_sleep_active: boolean;
  canonical_order: MemoryPhase[];
}

/** φ₆ fusion candidate consumed by φ₈ assembly (REL-04). */
export interface FusionHit {
  id: number;
  type: "semantic" | "episodic";
  score: number;
  scores?: {
    fts5: number;
    trigram: number;
    graph: number;
    recency: number;
    importance: number;
  };
  data: SemanticMemory | EpisodicMemory;
}

export interface PipelineInput {
  message: string;
  session_id?: string;
  role?: string;
  goal?: string;
  max_tokens?: number;
  /** Combined user+assistant text for post-turn extraction */
  turn_content?: string;
  /** REL-08: extract these separately when present instead of one blob. */
  user_message?: string;
  assistant_message?: string;
  tool_summary?: string;
  /** Extraction counts from φ₄ passed into φ₅ */
  extracted?: { semantic_count: number; entity_count: number };
  /**
   * Expanded retrieval query (REL-01). Distinct from `message` / C_goal.
   * When omitted, the pipeline expands continuation/follow-up text itself.
   */
  retrieval_query?: string;
  /** φ₆ hits forwarded to φ₈ when phases run separately (REL-04). */
  fusion_hits?: FusionHit[];
}

export type MemoryMode = "full" | "summarized" | "selective";

export type MemoryScope = "project" | "global";

export interface BuildContextInput {
  message: string;
  session_id?: string;
  max_tokens?: number;
  memory_mode?: MemoryMode;
  /** Current task / goal (C_goal in Knox-MS context assembly). */
  goal?: string;
  /**
   * Query used for fusion / FTS / LIKE (REL-01).
   * When omitted, ContextBuilder expands `message` (continuation vs new task).
   * C_goal still uses `goal` / `message`, never this field.
   */
  retrieval_query?: string;
  /**
   * φ₆ fusion hits for φ₈ assembly (REL-04).
   * When provided, ContextBuilder does not search fusion again.
   * LIKE fallback runs only if this array is empty.
   */
  fusion_hits?: FusionHit[];
  include_graph?: boolean;
  include_procedures?: boolean;
  include_patterns?: boolean;
}

/** Provenance item returned alongside automatic memory inject. */
export interface InjectedMemoryItem {
  id: number | null;
  kind: "semantic" | "episodic" | "entity" | "procedure" | "pattern" | "working" | "goal";
  title: string;
  reason: string;
  category?: string;
  score?: number;
  pinned?: boolean;
  fts5?: number;
  trigram?: number;
  graph?: number;
  recency?: number;
  importance?: number;
  topic_id?: number | null;
  task_id?: string | null;
  gate_passed?: boolean;
  evidence?: string[];
}

export interface BuildContextResult {
  context: string;
  items: InjectedMemoryItem[];
  /** Tokens saved via compression during assembly. */
  memory_tokens_saved?: number;
}

/** Envelope for password-protected local brain backups. */
export interface EncryptedBrainExport {
  version: "knox-brain-encrypted-v1";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface MemoryConfigInput {
  key: string;
  value: string;
}

// ── Output Types ─────────────────────────────────────────────────────────────

export interface RecallResult {
  semantic: SemanticMemory[];
  episodic: EpisodicMemory[];
  associations: MemoryAssociation[];
}

export interface BrainStats {
  total_sessions: number;
  total_episodic: number;
  total_semantic: number;
  total_associations: number;
  total_entities: number;
  total_edges: number;
  total_patterns: number;
  total_procedures: number;
  total_tags: number;
  total_collections: number;
  tier_counts: {
    hot: number;
    warm: number;
    cold: number;
  };
  category_counts: Record<string, number>;
  entity_type_counts: Record<string, number>;
  oldest_memory: string | null;
  newest_memory: string | null;
  db_size_bytes: number;
}

export interface ConsolidationResult {
  promoted: number;
  demoted: number;
  pruned: number;
  summaries_created: number;
}

/** Per-phase counts from φ₇ sleep consolidation (IMP-06). */
export interface SleepSubPhaseCounts {
  nrem_replay: number;
  nrem_decay_demoted: number;
  nrem_decay_pruned: number;
  nrem_compress: number;
  rem_distill: number;
  graph_strengthen: number;
  promote: number;
}

export interface SessionHistoryResult {
  session: BrainSession | null;
  episodic: EpisodicMemory[];
  semantic: SemanticMemory[];
  topics: SessionTopic[];
  token_estimate: number;
  message_count: number;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "critical";
  db_size_bytes: number;
  total_memories: number;
  fragmentation_ratio: number;
  oldest_unaccessed_days: number;
  issues: string[];
  recommendations: string[];
}

export interface GraphExploreResult {
  center: GraphEntity;
  entities: GraphEntity[];
  edges: GraphEdge[];
  depth_reached: number;
  /** BFS depth from center for spreading activation (γ^depth). IMP-11 */
  entity_depths: Record<number, number>;
  /** Spreading activation score per entity: confidence × γ^depth. IMP-11 */
  activation_scores: Record<number, number>;
}

/** Knowledge graph capacity & spreading-activation config (IMP-11). */
export interface GraphCapStatus {
  entity_count: number;
  max_entities: number;
  cap_utilization: number;
  at_cap: boolean;
  max_depth: number;
  depth_decay_gamma: number;
  edges: number;
  entity_types: Record<string, number>;
}

export interface PatternSuggestion {
  pattern: LearningPattern;
  relevance_score: number;
  reason: string;
}

export interface MemoryExport {
  version: string;
  exported_at: string;
  sessions: BrainSession[];
  semantic: SemanticMemory[];
  episodic: EpisodicMemory[];
  associations: MemoryAssociation[];
  entities: GraphEntity[];
  edges: GraphEdge[];
  patterns: LearningPattern[];
  procedures: ProceduralMemory[];
  tags: MemoryTag[];
  collections: MemoryCollection[];
  collection_items?: CollectionItem[];
  audit_log?: AuditLogEntry[];
  session_topics?: SessionTopic[];
  tasks?: BrainTask[];
  config?: Record<string, string>;
}

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
}

// ── Cross-Session Backlog Search ─────────────────────────────────────────────

export interface BacklogSearchInput {
  query: string;
  limit?: number;
  session_ids?: string[];
  /** Scope backlog search to this session's project when memory_scope is project. */
  session_id?: string;
  /** Workspace root for project scope when session row is unavailable. */
  workspace_dir?: string;
  date_from?: string;
  date_to?: string;
  roles?: string[];
  include_semantic?: boolean;
  include_episodic?: boolean;
}

export interface BacklogSearchResult {
  semantic: SemanticMemory[];
  episodic: EpisodicMemory[];
  sessions_searched: number;
  total_matches: number;
}

// ── Checkpoint / Rollback Types ──────────────────────────────────────────────

export interface MemoryCheckpoint {
  id: number;
  label: string;
  created_at: string;
  semantic_count: number;
  entity_count: number;
  pattern_count: number;
  snapshot_path: string;
  workspace_checkpoint_id?: string;
}

export interface CreateCheckpointInput {
  label: string;
}

// ── LLM-Enhanced Types ───────────────────────────────────────────────────────

export interface LlmExtractEntitiesInput {
  text: string;
  session_id?: string;
}

export interface LlmSummarizeSessionInput {
  session_id: string;
  detail_level?: "brief" | "detailed";
}

export interface LlmEvaluateImportanceInput {
  content: string;
  role?: string;
  context?: string;
}

export interface LlmPostActionMemoryInput {
  action_description: string;
  action_result: string;
  session_id?: string;
}

// ── Rate Limiting State ──────────────────────────────────────────────────────

export interface RateLimitState {
  calls_this_hour: number;
  tokens_this_hour: number;
  hour_start: number;
  denied_count: number;
}

// ── Memory Event Broadcasting ────────────────────────────────────────────────

export type MemoryEventType =
  | "memory:stored"
  | "memory:deleted"
  | "memory:mismatched"
  | "memory:recalled"
  | "session:created"
  | "session:updated"
  | "session:deleted"
  | "session:summarized"
  | "entity:added"
  | "entity:updated"
  | "entity:deleted"
  | "edge:added"
  | "pattern:learned"
  | "procedure:stored"
  | "procedure:executed"
  | "consolidation:completed"
  | "checkpoint:created"
  | "checkpoint:rolled_back"
  | "checkpoint:deleted"
  | "tag:added"
  | "tag:removed"
  | "collection:created"
  | "collection:item_added"
  | "auto_extract:completed"
  | "topic:detected"
  | "llm:entities_extracted"
  | "llm:session_summarized"
  | "llm:importance_evaluated"
  | "llm:post_action_completed"
  | "autonomous:started"
  | "autonomous:iteration"
  | "autonomous:assistant"
  | "autonomous:tool_start"
  | "autonomous:tool_ask"
  | "autonomous:tool_end"
  | "autonomous:completed"
  | "autonomous:cancelled";

export interface MemoryEvent {
  type: MemoryEventType;
  timestamp: string;
  data: Record<string, any>;
}

export type MemoryEventListener = (event: MemoryEvent) => void;

// ── Audit Trail ──────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: number;
  action: string;
  target_type: string;
  target_id: number | string | null;
  details: string; // JSON
  created_at: string;
}

// ── Session Topic Detection ──────────────────────────────────────────────────

export interface SessionTopic {
  id: number;
  session_id: string;
  topic: string;
  keywords: string;
  message_range_start: number;
  message_range_end: number;
  confidence: number;
  created_at: string;
}

/** REL-13: multi-turn task identity until a topic shift or new-task turn. */
export interface BrainTask {
  id: string;
  session_id: string;
  topic_id: number | null;
  title: string;
  opened_at: string;
  closed_at: string | null;
}

// ── P1.3 Split-Tool Action Groups ───────────────────────────────────────────

/** Actions for the core memory tool (store/recall/search/context) */
export type MemoryCoreAction =
  | "store"
  | "recall"
  | "search"
  | "delete"
  | "build_context"
  | "auto_extract"
  | "associate"
  | "tag"
  | "untag"
  | "search_by_tag"
  | "create_collection"
  | "list_collections"
  | "add_to_collection"
  | "export"
  | "import"
  | "get_stats"
  | "consolidate";

/** Actions for the knowledge graph tool */
export type MemoryGraphAction =
  | "add_entity"
  | "search_entities"
  | "add_edge"
  | "explore_graph"
  | "get_graph_stats"
  | "extract_entities"
  | "llm_extract_entities";

/** Actions for session management tool */
export type MemorySessionsAction =
  | "list_sessions"
  | "get_session"
  | "close_session"
  | "summarize_session"
  | "search_backlogs"
  | "get_session_topics"
  | "find_related_sessions";

/** Actions for memory maintenance/management tool */
export type MemoryManageAction =
  | "create_checkpoint"
  | "list_checkpoints"
  | "rollback_checkpoint"
  | "delete_checkpoint"
  | "checkpoint_strategy_config"
  | "update_checkpoint_strategy"
  | "checkpoint_lifecycle_cleanup"
  | "compress_checkpoint"
  | "diff_checkpoint"
  | "replay_events"
  | "undo_operation"
  | "get_undoable_operations"
  | "batch_delete"
  | "batch_store"
  | "batch_audit_log"
  | "batch_update_importance"
  | "batch_move_tier"
  | "five_tier_consolidate"
  | "get_tier_distribution"
  | "get_tier_configs"
  | "update_tier_config"
  | "root_cause_analysis"
  | "get_audit_log"
  | "get_health"
  | "optimize"
  | "get_config"
  | "update_config"
  | "get_metrics"
  | "get_health_score"
  | "get_capacity_forecast"
  | "heal"
  | "get_healing_strategies"
  | "get_consolidation_stats"
  | "get_cache_stats"
  | "clear_cache"
  | "store_metrics_snapshot"
  | "get_metrics_trend"
  | "run_pipeline"
  | "get_effective_context"
  | "get_phase_status";

/** Actions for the learning engine tool */
export type MemoryLearnAction =
  | "learn_pattern"
  | "suggest_approach"
  | "get_patterns"
  | "store_procedure"
  | "get_procedures"
  | "execute_procedure"
  | "get_review_due"
  | "boost_memory"
  | "llm_evaluate_importance"
  | "llm_summarize_session"
  | "llm_post_action_memory";
