/** Memory Brain types: entities. Re-exported from ../types.ts. */

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

export const SEMANTIC_CATEGORIES: readonly SemanticCategory[] = [
  "fact",
  "preference",
  "decision",
  "summary",
  "insight",
  "code_pattern",
  "error_fix",
  "project_context",
  "workflow",
];

export function isSemanticCategory(value: string): value is SemanticCategory {
  return (SEMANTIC_CATEGORIES as readonly string[]).includes(value);
}

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
  /** MEM-26: alias rows point at the preferred entity. NULL = this row is canonical. */
  canonical_id?: number | null;
  /** MEM-26: open interval. NULL start = unbounded. */
  valid_from?: string | null;
  /** MEM-26: exclusive end. NULL = still valid. */
  valid_to?: string | null;
}

export interface GraphEdge {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relationship: string;
  weight: number;
  properties: string; // JSON
  created_at: string;
  /** MEM-26: unused for merge (entities hold canonical_id). Mapped for completeness. */
  canonical_id?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
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
  /** MEM-05: `brain_summary_tree` node listing this session's original turns. */
  summary_node_id?: number | null;
  is_active: boolean;
}

/** Revised-theorem dashboard metrics: C_addr / C_use / W. Rec / H_0.85 are optional until benches exist. */
export interface EffectiveContextMetrics {
  /** Addressable stored tokens: |M₃| + |M₄| + |M₅| (raw, no / rᵢ). */
  c_addr: number;
  /** Tokens actually injected in the last model call. */
  c_use: number;
  /** W(Model(x)) — routed model contextLength (MEM-27). */
  w: number;
  /** W_out — reserved completion tokens for that model (MEM-27). */
  w_out?: number;
  /** Model id that produced W. */
  routed_model?: string;
  /** Rolling Rec(q) when a bench / attribution window exists. */
  rec_rolling?: number;
  /** Answerable horizon H_0.85 in days (MEM-41). */
  h_0_85?: number;
  /** A1 selectivity σ = mean_q N_q / N (MEM-42). */
  sigma?: number;
  /** A2 per-level beam miss. `null` = n/a — flat FTS. */
  epsilon_b?: number | null;
  epsilon_b_note?: string;
  /** A3 selection / budget miss (MEM-42). */
  epsilon_s?: number;
  /** Finite ε_B and Rec on the theorem floor. */
  theorem_held?: boolean;
  /** Alias of `w`. */
  active_window_tokens?: number;
  /** Alias of `w`. Leftover name; not the 10M stored ceiling. */
  context_max_tokens?: number;
  /** Tokens in the last injected context (same as `c_use`). */
  last_context_tokens_used?: number;
  last_context_max_tokens?: number;
  /** last_context_tokens_used / last build budget (0–1). */
  window_utilization?: number;
  tier_tokens: Record<string, number>;
  memory_levels?: Array<{
    id: string;
    name: string;
    tokens: number;
    ratio?: number;
    effective_tokens?: number;
    role?: "buffer" | "store";
    in_c_addr?: boolean;
    /** M₁ turn / M₂ call / M₃ session / M₄–M₅ stored (MEM-33). */
    lifetime?: "turn" | "call" | "session" | "stored";
  }>;
  working_memory_tokens?: number;
  working_memory_budget?: number;
  sensory_buffer_tokens?: number;
  sensory_buffer_ms?: number;
  /** M₁ theorem lifetime. */
  sensory_lifetime?: "turn";
  /** M₂ theorem lifetime. */
  working_memory_lifetime?: "call";
  /** Graph channel size (entity count). Not C_addr. */
  graph_entity_count?: number;
  graph_channel_size?: number;
  graph_role?: "channel";
  /** Always false: graph is a channel, not addressable storage. */
  graph_is_capacity?: boolean;
  graph_max_entities?: number;
  graph_max_depth?: number;
  graph_depth_decay_gamma?: number;
  graph_ppr_alpha?: number;
  graph_ppr_epsilon?: number;
  /** Always 0 — no entity cap (MEM-25). */
  graph_cap_utilization?: number;
  compression_ratios?: Record<string, number>;
  memory_tokens_saved?: number;
  last_compression_tokens_saved?: number;
  compression_events?: number;
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
  /** MEM-04/06: set only for true deletes (forget/TTL/privacy or age-prune replacement). */
  tombstoned_at?: string | null;
  tombstone_reason?: string | null;
  /** MEM-05: parent summary row, when this leaf was distilled. */
  parent_id?: number | null;
  /** MEM-05: JSON id list if this episodic row is itself a summary. */
  summary_of?: string | null;
  /** MEM-12: power-law stability S (days). */
  stability?: number | null;
  /** MEM-12: FSRS difficulty D. Default 5. */
  difficulty?: number;
  /** MEM-12: initial importance I₀. */
  i0?: number | null;
  /** MEM-13 / MEM-17: helpful attribution count h. */
  helpful_count?: number;
  /** MEM-13 / MEM-17: unhelpful attribution count u. */
  unhelpful_count?: number;
  /** MEM-26: open validity start. NULL = unbounded / legacy. */
  valid_from?: string | null;
  /** MEM-26: exclusive validity end. NULL = still valid. */
  valid_to?: string | null;
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
  /** MEM-16: injects for calibration. Not S or I. */
  inject_count?: number;
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
  /** MC-17: set by recall when this memory describes a recipe (parsed from its content marker). */
  recipe_id?: string;
  /** MEM-04/06: set only for true deletes (forget/TTL/privacy or age-prune replacement). */
  tombstoned_at?: string | null;
  tombstone_reason?: string | null;
  /** MEM-05: parent summary row, when this leaf was pointed at. */
  parent_id?: number | null;
  /** MEM-05: JSON id list of original leaves this row summarizes. */
  summary_of?: string | null;
  /** MEM-12: power-law stability S (days). */
  stability?: number | null;
  /** MEM-12: FSRS difficulty D. Default 5. */
  difficulty?: number;
  /** MEM-12: initial importance I₀. */
  i0?: number | null;
  /** MEM-13 / MEM-17: helpful attribution count h. */
  helpful_count?: number;
  /** MEM-13 / MEM-17: unhelpful attribution count u. */
  unhelpful_count?: number;
  /** MEM-26: open validity start. NULL = unbounded / legacy. */
  valid_from?: string | null;
  /** MEM-26: exclusive validity end. NULL = still valid. */
  valid_to?: string | null;
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
  /** MEM-05: JSON id list (or `{ type, id }` refs) of leaves this row summarizes. */
  summary_of?: string | Array<number | { type?: string; id: number }>;
  parent_id?: number | null;
}

/** In-place edit of an existing semantic row. Does not insert a new table. */
export interface UpdateSemanticInput {
  id: number;
  category: SemanticCategory;
  title: string;
  content: string;
  keywords?: string;
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
  /** MEM-26: set on alias rows. */
  canonical_id?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
}

export interface AddEdgeInput {
  source_entity_id: number;
  target_entity_id: number;
  relationship: string;
  weight?: number;
  properties?: Record<string, any>;
  /** MEM-26: open validity start. Store defaults to now. */
  valid_from?: string | null;
  valid_to?: string | null;
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
