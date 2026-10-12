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
  /** MC-17: set by recall when this memory describes a recipe (parsed from its content marker). */
  recipe_id?: string;
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
