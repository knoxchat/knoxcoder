/** Memory Brain types: pipeline. Re-exported from ../types.ts. */

import type { BrainSession, CollectionItem, EpisodicMemory, GraphEdge, GraphEntity, LearningPattern, MemoryAssociation, MemoryCollection, MemoryTag, ProceduralMemory, SemanticMemory } from "./entities.js";
import type { AuditLogEntry, BrainTask, SessionTopic } from "./misc.js";

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

/** Part III 8-phase cycle status (IMP-01 / MEM-32). */
export interface MemoryPhaseStatus {
  active_phase: MemoryPhase | null;
  last_completed: { phase: MemoryPhase; at: number } | null;
  phase_counts: Partial<Record<MemoryPhase, number>>;
  /** Budget ∧ Reachability ∧ Losslessness. Not “a phase ran in the last hour”. */
  cycle_invariant_met: boolean;
  budget_invariant_met: boolean;
  reachability_invariant_met: boolean;
  losslessness_invariant_met: boolean;
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
  /** Routed model handle. W = resolveContextWindow(llm).contextLength (MEM-27). */
  llm?: unknown;
  /** Routed model id when the handle is not yet resolved. */
  model?: string;
  /** Explicit W(Model(x)). */
  w?: number;
  /** Explicit W_out (reserved completion tokens). */
  w_out?: number;
  /** |C_system| already placed in this call (MEM-28). */
  system_tokens?: number;
  /** |C_goal| already reserved for this call (MEM-28). */
  goal_tokens?: number;
  /** |C_recent| already placed in this call (MEM-28). */
  recent_tokens?: number;
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
  /** MEM-17: stable id for this turn's `brain_attribution` rows. */
  turn_id?: string;
  /**
   * MEM-17: cited + succeeded → helpful (h, FSRS useful).
   * When omitted, outcome is inferred from tools or left pending.
   */
  turn_succeeded?: boolean;
  /** MEM-17: this user message corrects a previously cited memory. */
  user_corrected?: boolean;
  /** Injected recipe hint/stub text (cite tokens counted as injected). */
  recipe_hint?: string;
}

export type MemoryMode = "full" | "summarized" | "selective";

export type MemoryScope = "project" | "global";

export interface BuildContextInput {
  message: string;
  session_id?: string;
  /** Optional tighter inject cap. Not W — ignore the 10M stored ceiling (MEM-27). */
  max_tokens?: number;
  /** Routed model handle. W = resolveContextWindow(llm).contextLength (MEM-27). */
  llm?: unknown;
  /** Routed model id when the handle is not yet resolved. */
  model?: string;
  /** Explicit W(Model(x)). */
  w?: number;
  /** Explicit W_out (reserved completion tokens). */
  w_out?: number;
  /** |C_system| already placed in this call (MEM-28). */
  system_tokens?: number;
  /** |C_goal| already reserved for this call (MEM-28). */
  goal_tokens?: number;
  /** |C_recent| already placed in this call (MEM-28). */
  recent_tokens?: number;
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
  /** MEM-17: stable id written onto lastInject for post-turn attribution. */
  turn_id?: string;
}

/** Provenance item returned alongside automatic memory inject. */
export interface InjectedMemoryItem {
  id: number | null;
  kind: "semantic" | "episodic" | "entity" | "procedure" | "pattern" | "working" | "goal" | "recipe";
  /** Stable `[mem:type:id]` token rendered next to the injected line (MEM-17). */
  cite?: string;
  /** String id for recipe hashes (and a text form of numeric leaf ids). */
  mem_id?: string;
  title: string;
  reason: string;
  category?: string;
  score?: number;
  /** Winning retrieval channel at inject time (MEM-18). */
  channel?: "lexical" | "ripgrep" | "graph" | "tree";
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
  /** W(Model(x)) used for this build (MEM-27). */
  w?: number;
  /** W_out reserved for the response (MEM-27). */
  w_out?: number;
  /** Tokens allowed for C_mem this call (`W_mem`, MEM-28). */
  inject_budget?: number;
  /** Same as `inject_budget` — min(w_mem_tokens, remainder). */
  w_mem?: number;
  /** |C(q)| after assemble, before a budget fail-open (MEM-32). */
  c_use?: number;
  /** |C(q)| ≤ W. False means this call returned empty memory. */
  budget_invariant_met?: boolean;
  system_tokens?: number;
  goal_tokens?: number;
  recent_tokens?: number;
  /** Occupancy before MEM-30 overflow collapse. */
  recent_tokens_raw?: number;
  /** C_recent ate its share; old turns were replaced by a session/tree node. */
  recent_overflow?: boolean;
  /** Session summary-tree node injected for overflow (MEM-30). */
  summary_node_id?: number | null;
  /** Original turn ids dropped from this call only. */
  dropped_turn_ids?: number[];
  /** Assembly candidate pool before budgeted select (MEM-42 ε_S). */
  cand?: Array<{
    key: string;
    kind: string;
    id: number | null;
    title: string;
  }>;
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
  /** Attribution rows considered while refitting w_s / θ (MEM-18). */
  refit: number;
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
  /** First-touch hop from the PPR seed (display). IMP-11 / MEM-25 */
  entity_depths: Record<number, number>;
  /** Hub-damped Personalized PageRank π_q. IMP-11 / MEM-25 */
  activation_scores: Record<number, number>;
}

/**
 * Knowledge graph channel gauge (IMP-11 / MEM-08 / MEM-25 / MEM-26).
 * Entity count is canonical channel size (aliases collapsed), not C_addr.
 * There is no entity cap.
 */
export interface GraphCapStatus {
  entity_count: number;
  /** Same as `entity_count`. Canonical entities valid now, not capacity. */
  channel_size: number;
  /** Always 0 — leftover unused cap (MEM-25). */
  max_entities: number;
  /** Always 0 — no capacity policy. */
  cap_utilization: number;
  at_cap: boolean;
  /** Always false: the graph is a retrieval channel, not addressable storage. */
  is_capacity: false;
  max_depth: number;
  /** Leftover unused BFS γ (MEM-25). Live score is PPR. */
  depth_decay_gamma: number;
  /** PPR restart α. Theorem default 0.15. */
  ppr_alpha: number;
  /** Push-PPR residual tolerance ε. */
  ppr_epsilon: number;
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
