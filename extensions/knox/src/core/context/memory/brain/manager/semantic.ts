/** Semantic store, recall, forget, and batch pin. */

import { BrainStore } from "../BrainStore.js";
import { CheckpointManager } from "../CheckpointManager.js";
import { BatchOperations } from "../BatchOperations.js";
import type {
  BatchDeleteResult,
} from "../BatchOperations.js";
import {
  SpacedRepetition,
} from "../AdvancedFeatures.js";
import { InputSanitizer } from "../InputSanitizer.js";
import { RetrievalFusion } from "../RetrievalFusion.js";
import { MemorySnapshot } from "../MemorySnapshot.js";
import {
  filterEpisodicByProjectScope,
  filterSemanticByProjectScope,
  getProjectSessionIds,
} from "../projectScope.js";
import type {
  StoreInput,
  RecallInput,
  RecallResult,
} from "../types.js";
import { brainRuntime } from "./state.js";
import { emit } from "./events.js";
import { extractKeywords, invalidateMemoryCaches } from "./helpers.js";
import { getActiveSessionId } from "./runtime.js";

// ── Semantic Memory (Knowledge Store) ──────────────────────────────────────

/**
 * Store a piece of knowledge in semantic memory.
 * This is the brain's long-term storage — facts, decisions, patterns, etc.
 */
export async function store(input: StoreInput): Promise<number> {
  // P1.1 — Sanitize inputs
  const titleResult = InputSanitizer.enforce(input.title);
  const contentResult = InputSanitizer.enforce(input.content);
  input.title = titleResult;
  input.content = contentResult;

  // Auto-generate keywords if not provided
  if (!input.keywords) {
    input.keywords = extractKeywords(input.title + " " + input.content);
  }

  // Check for near-duplicates before storing
  const { id, deduplicated } = await BrainStore.storeSemanticDeduped(input);
  invalidateMemoryCaches();
  emit("memory:stored", {
    id,
    category: input.category,
    title: input.title,
    deduplicated,
    original_id: id,
  });

  if (!deduplicated) {
    CheckpointManager.recordChange().catch(() => {});
    MemorySnapshot.invalidateAll();
  }

  return id;
}

/**
 * Recall memories relevant to a query.
 * Searches both semantic and optionally episodic memory.
 * Returns results ranked by relevance.
 */
export async function recall(input: RecallInput): Promise<RecallResult> {
  const projectSessionIds = await getProjectSessionIds(
    input.session_id ?? getActiveSessionId() ?? undefined,
  );

  // Check LRU cache first
  const cacheKey = [
    "recall",
    input.query ?? "",
    input.category ?? "",
    input.session_id ?? "",
    BrainStore.getConfig().memory_scope,
    projectSessionIds?.join(",") ?? "global",
    input.include_episodic !== false ? "episodic" : "semantic-only",
    String(input.limit ?? 10),
  ].join(":");
  const cached = brainRuntime.memoryCache.get(cacheKey);
  if (cached) {
    emit("memory:recalled", { query: input.query, semantic_count: cached.semantic.length, episodic_count: cached.episodic.length, cache_hit: true });
    return cached as RecallResult;
  }

  // P2.1+P2.2 — Use RetrievalFusion for multi-strategy search
  let semantic: any[];
  try {
    const fusionResults = await RetrievalFusion.search({
      query: input.query,
      limit: input.limit ?? BrainStore.getConfig().retrieval_top_k,
      category: input.category,
      includeEpisodic: false,
      projectSessionIds,
    });
    // Map fusion results back to semantic memory format
    semantic = fusionResults
      .filter((r) => r.type === "semantic")
      .map((r) => ({
        ...r.data,
        fusion_score: r.score,
        fusion_scores: r.scores,
      }));
  } catch {
    // Fallback to direct search if fusion fails
    semantic = filterSemanticByProjectScope(
      await BrainStore.searchSemantic(
        input.query,
        input.category,
        input.limit ?? 10,
      ),
      projectSessionIds,
    );
  }

  // Boost spaced repetition scores for retrieved memories (recall already increments access count)
  for (const mem of semantic) {
    SpacedRepetition.boostOnRetrieval(mem.id, { incrementAccess: false }).catch(() => {});
  }

  let episodic: any[] = [];
  if (input.include_episodic !== false) {
    episodic = filterEpisodicByProjectScope(
      await BrainStore.searchEpisodic(
        input.query,
        undefined,
        Math.min(input.limit ?? 10, 20),
      ),
      projectSessionIds,
    );
  }

  // Gather associations for top results
  const associations: any[] = [];
  for (const mem of semantic.slice(0, 3)) {
    const assocs = await BrainStore.getAssociations("semantic", mem.id);
    associations.push(...assocs);
  }

  const result: RecallResult = { semantic, episodic, associations };

  // Cache the result
  brainRuntime.memoryCache.set(cacheKey, result);

  emit("memory:recalled", { query: input.query, semantic_count: semantic.length, episodic_count: episodic.length });
  return result;
}

/**
 * Delete a semantic memory by ID.
 */
export async function forget(id: number): Promise<boolean> {
  // Safety checkpoint before destructive operation
  await CheckpointManager.beforeDestructiveOp("delete").catch(() => {});

  const result = await BrainStore.deleteSemantic(id);
  if (result) {
    invalidateMemoryCaches();
    emit("memory:deleted", { id });
    MemorySnapshot.invalidateAll();
  }
  return result;
}

/**
 * Delete many semantic memories in one transaction and one safety checkpoint.
 */
export async function forgetMany(ids: number[]): Promise<BatchDeleteResult> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) {
    return {
      target_type: "semantic",
      requested: 0,
      deleted: 0,
      failed: 0,
      errors: [],
    };
  }

  await CheckpointManager.beforeDestructiveOp("batch_delete").catch(() => {});
  const result = await BatchOperations.batchDelete({
    target_type: "semantic",
    ids: unique,
  });
  if (result.deleted > 0) {
    invalidateMemoryCaches();
    emit("memory:deleted", { ids: unique, deleted: result.deleted });
    MemorySnapshot.invalidateAll();
  }
  return result;
}

/**
 * Pin many semantic memories in one transaction.
 */
export async function pinMemories(ids: number[]): Promise<{ updated: number; failed: number }> {
  const result = await BatchOperations.batchPin(ids);
  if (result.updated > 0) {
    invalidateMemoryCaches();
    emit("tag:added", { ids, tag: "pinned", updated: result.updated });
  }
  return result;
}

/**
 * Unpin many semantic memories in one transaction.
 */
export async function unpinMemories(ids: number[]): Promise<{ updated: number; failed: number }> {
  const result = await BatchOperations.batchUnpin(ids);
  if (result.updated > 0) {
    invalidateMemoryCaches();
    emit("tag:removed", { ids, tag: "pinned", updated: result.updated });
  }
  return result;
}
