/** Knowledge graph service wrappers. */

import { BrainStore } from "../BrainStore.js";
import { KnowledgeGraph } from "../KnowledgeGraph.js";
import type {
  AddEntityInput,
  AddEdgeInput,
  ExploreGraphInput,
} from "../types.js";
import { emit } from "./events.js";

// ── Knowledge Graph ────────────────────────────────────────────────────────

export async function addEntity(input: AddEntityInput): Promise<number> {
  const id = await KnowledgeGraph.addEntity(input);
  emit("entity:added", { id, name: input.name, entity_type: input.entity_type });
  return id;
}

export async function searchEntities(query: string, entityType?: any, limit?: number) {
  return KnowledgeGraph.searchEntities(query, entityType, limit);
}

export async function listEntities(options: {
  query?: string;
  entityType?: string;
  limit?: number;
  offset?: number;
}) {
  return BrainStore.listEntities(options);
}

export async function addEdge(input: AddEdgeInput): Promise<number> {
  const id = await KnowledgeGraph.addEdge(input);
  emit("edge:added", { id, source_entity_id: input.source_entity_id, target_entity_id: input.target_entity_id, relationship: input.relationship });
  return id;
}

export async function exploreGraph(input: ExploreGraphInput) {
  return KnowledgeGraph.explore(input);
}

export async function getGraphStats() {
  return KnowledgeGraph.getStats();
}

/** Knowledge graph cap + γ decay config (IMP-11). */
export async function getGraphCapStatus() {
  return KnowledgeGraph.getCapStatus();
}

export async function extractEntities(text: string) {
  return KnowledgeGraph.extractAndStore(text);
}
