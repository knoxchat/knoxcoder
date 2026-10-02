/** SQLite row → typed memory records. */

import type {
  AuditLogEntry,
  BrainSession,
  BrainTask,
  CollectionItem,
  EmotionalValence,
  EntityType,
  EpisodicMemory,
  EpisodicType,
  GoalType,
  GraphEdge,
  GraphEntity,
  LearningPattern,
  MemoryAssociation,
  MemoryCollection,
  MemoryTag,
  MemoryTier,
  ProceduralMemory,
  SemanticCategory,
  SemanticMemory,
  SessionTopic
} from "../types.js";
import { decompressContent } from "./compression.js";

export function rowToTask(row: any): BrainTask {
  return {
    id: row.id,
    session_id: row.session_id,
    topic_id: row.topic_id ?? null,
    title: row.title,
    opened_at: row.opened_at,
    closed_at: row.closed_at ?? null,
  };
}

// ── Row Mappers ────────────────────────────────────────────────────────────

export function rowToSession(row: any): BrainSession {
  return {
    id: row.id,
    title: row.title,
    workspace_directory: row.workspace_directory,
    project_id: row.project_id ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    message_count: row.message_count,
    summary: row.summary,
    is_active: !!row.is_active,
  };
}

export function rowToEpisodic(row: any): EpisodicMemory {
  return {
    id: row.id,
    session_id: row.session_id,
    type: row.type as EpisodicType,
    role: row.role,
    content: decompressContent(row.content),
    token_count: row.token_count,
    importance_score: row.importance_score,
    emotional_valence: (row.emotional_valence ?? "neutral") as EmotionalValence,
    salience: row.salience ?? 0.5,
    tier: row.tier as MemoryTier,
    metadata: row.metadata,
    created_at: row.created_at,
  };
}

export function rowToSemantic(row: any): SemanticMemory {
  return {
    id: row.id,
    category: row.category as SemanticCategory,
    title: row.title,
    content: decompressContent(row.content),
    source_session_id: row.source_session_id,
    keywords: row.keywords,
    importance_score: row.importance_score,
    emotional_valence: (row.emotional_valence ?? "neutral") as EmotionalValence,
    salience: row.salience ?? 0.5,
    retrieval_count: row.retrieval_count,
    tier: row.tier as MemoryTier,
    created_at: row.created_at,
    last_accessed_at: row.last_accessed_at,
    expires_at: row.expires_at,
    topic_id: row.topic_id ?? null,
    task_id: row.task_id ?? null,
    mismatch_count: row.mismatch_count ?? 0,
    mismatch_until: row.mismatch_until ?? null,
    mismatch_topic_id: row.mismatch_topic_id ?? null,
  };
}

export function rowToAssociation(row: any): MemoryAssociation {
  return {
    id: row.id,
    source_type: row.source_type,
    source_id: row.source_id,
    target_type: row.target_type,
    target_id: row.target_id,
    relationship: row.relationship,
    strength: row.strength,
    created_at: row.created_at,
  };
}

export function rowToEntity(row: any): GraphEntity {
  return {
    id: row.id,
    name: row.name,
    entity_type: row.entity_type as EntityType,
    description: row.description,
    properties: row.properties,
    confidence: row.confidence,
    mention_count: row.mention_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function rowToEdge(row: any): GraphEdge {
  return {
    id: row.id,
    source_entity_id: row.source_entity_id,
    target_entity_id: row.target_entity_id,
    relationship: row.relationship,
    weight: row.weight,
    properties: row.properties,
    created_at: row.created_at,
  };
}

export function rowToPattern(row: any): LearningPattern {
  return {
    id: row.id,
    goal_type: row.goal_type as GoalType,
    pattern_signature: row.pattern_signature,
    description: row.description,
    success_count: row.success_count,
    failure_count: row.failure_count,
    confidence: row.confidence,
    avg_tokens_used: row.avg_tokens_used,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    metadata: row.metadata,
  };
}

export function rowToProcedure(row: any): ProceduralMemory {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: row.steps,
    trigger_pattern: row.trigger_pattern,
    success_rate: row.success_rate,
    execution_count: row.execution_count,
    last_executed_at: row.last_executed_at,
    created_at: row.created_at,
    category: row.category,
  };
}

export function rowToTag(row: any): MemoryTag {
  return {
    id: row.id,
    memory_type: row.memory_type,
    memory_id: row.memory_id,
    tag: row.tag,
    created_at: row.created_at,
  };
}

export function rowToCollection(row: any): MemoryCollection {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    item_count: row.item_count ?? 0,
  };
}

export function rowToCollectionItem(row: any): CollectionItem {
  return {
    id: row.id,
    collection_id: row.collection_id,
    memory_type: row.memory_type,
    memory_id: row.memory_id,
    added_at: row.added_at,
  };
}

export function rowToAuditLogEntry(row: any): AuditLogEntry {
  return {
    id: row.id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    details: row.details,
    created_at: row.created_at,
  };
}

export function rowToSessionTopic(row: any): SessionTopic {
  return {
    id: row.id,
    session_id: row.session_id,
    topic: row.topic,
    keywords: row.keywords,
    message_range_start: row.message_range_start,
    message_range_end: row.message_range_end,
    confidence: row.confidence,
    created_at: row.created_at,
  };
}
