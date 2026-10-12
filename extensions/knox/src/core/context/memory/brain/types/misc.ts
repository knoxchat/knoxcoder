/** Memory Brain types: misc. Re-exported from ../types.ts. */

import type { EpisodicMemory, SemanticMemory } from "./entities.js";

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
