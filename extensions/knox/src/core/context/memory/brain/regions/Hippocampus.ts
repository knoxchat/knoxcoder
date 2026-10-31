/**
 * Hippocampus — recall / store stage H (MEM-31).
 *
 *   P ─recall/store→ H ─procedure→ B_g
 *
 * Wraps AutoMemory, fusion retrieval, and φ₄/φ₅ persist. H→P is a
 * recent-knowledge hint (REL-07: never overwrites C_goal).
 *
 * Part III:
 *   φ₄ consolidation — extract + store to M₃ (hot/short-term)
 *   φ₅ long-term storage — pointer-summarize M₄ leaves, recipes → M₅ (product)
 *   φ₆ retrieval — fusion search
 */

import { AutoMemory } from "../AutoMemory.js";
import { BrainStore } from "../BrainStore.js";
import {
  leftoverCoveredByFingerprints,
  leftoverFingerprints,
  loadLiveRecipeCoverage,
} from "../m5Surface.js";
import { RetrievalFusion, type FusionResult } from "../RetrievalFusion.js";
import { getMemoryConfig } from "../memoryConfigAccess.js";
import { getProjectSessionIds } from "../projectScope.js";
import { ingestSessionLeaves } from "../SummaryTree.js";
import type { StoreInput } from "../types.js";
import { BasalGanglia } from "./BasalGanglia.js";
import { PrefrontalCortex } from "./PrefrontalCortex.js";

export interface LongTermPersistResult {
  /** Leftover: clock hot→warm is retired (MEM-15). Always 0. */
  promoted: number;
  /** Live recipes in this session counted as product M₅ (MEM-09). */
  recipes: number;
  /**
   * Leftover learning-pattern writes for code_patterns no live recipe covers.
   * Product M₅ is recipes; leftovers yield on the same fingerprint (MEM-37).
   */
  procedural: number;
  /** Leaves pointed at by a new summary-tree node (originals kept). */
  compressed: number;
}

const LIVE_RECIPE = "status IN ('candidate', 'verified', 'quarantined')";

async function sessionLiveRecipes(
  db: Awaited<ReturnType<typeof BrainStore.get>>,
  sessionId: string,
): Promise<{ count: number; linkedMemoryIds: Set<number> }> {
  try {
    const rows = (await db.all(
      `
      SELECT memory_id FROM brain_recipes
      WHERE ${LIVE_RECIPE}
        AND (
          source_session_id = ?
          OR memory_id IN (SELECT id FROM brain_semantic WHERE source_session_id = ?)
        )
      `,
      [sessionId, sessionId],
    )) as { memory_id: number | null }[];
    const linkedMemoryIds = new Set<number>();
    for (const row of rows) {
      const id = Math.trunc(Number(row.memory_id));
      if (id > 0) linkedMemoryIds.add(id);
    }
    return { count: rows.length, linkedMemoryIds };
  } catch {
    return { count: 0, linkedMemoryIds: new Set() };
  }
}

export const Hippocampus = {
  async encode(
    content: string,
    role: string,
    sessionId: string,
    parts?: {
      userMessage?: string;
      assistantMessage?: string;
      toolSummary?: string;
    },
  ) {
    const hasParts = Boolean(
      parts?.userMessage?.trim() ||
        parts?.assistantMessage?.trim() ||
        parts?.toolSummary?.trim(),
    );
    const labeled = hasParts ? null : AutoMemory.splitLabeledTurn(content);
    const result = hasParts
      ? await AutoMemory.extractTurn({
          sessionId,
          userMessage: parts?.userMessage,
          assistantMessage: parts?.assistantMessage,
          toolSummary: parts?.toolSummary,
        })
      : labeled
        ? await AutoMemory.extractTurn({ sessionId, ...labeled })
        : await AutoMemory.extract(content, role, sessionId);
    if (result.semantic_count > 0) {
      PrefrontalCortex.feedbackFromHippocampus(
        { title: content.slice(0, 80), category: "fact" },
        sessionId,
      );
    }
    return result;
  },

  /**
   * φ₅ — pointer-summarize(m) → M₄, M₅ after consolidation (φ₄).
   * Promotes high-importance hot memories to warm (M₄), counts live recipes
   * as product M₅, and inserts each new leaf under the session summary tree
   * (MEM-24, branching b). Leaf `content` stays intact (MEM-05). Unlinked
   * code_patterns may still write a leftover learning pattern when no live
   * recipe owns the same fingerprint (MEM-37).
   */
  async persistToLongTerm(
    sessionId: string,
    extracted: { semantic_count: number; entity_count: number },
  ): Promise<LongTermPersistResult> {
    const result: LongTermPersistResult = { promoted: 0, recipes: 0, procedural: 0, compressed: 0 };

    const ingested = await ingestSessionLeaves(sessionId);
    result.compressed = ingested.linked;

    if (extracted.semantic_count === 0 && extracted.entity_count === 0) {
      return result;
    }

    const db = await BrainStore.get();

    // M₄ leaves keep the R/Value tier. Sleep/attribution recompute (MEM-15).

    // M₅ — product store is live recipes (and their linked workflow, once).
    const sessionRecipes = await sessionLiveRecipes(db, sessionId);
    result.recipes = sessionRecipes.count;

    // Leftover: unlinked code_patterns may still train BasalGanglia. Skip
    // any row a live recipe already owns (linked handle or same fingerprint)
    // so leftover procedures / patterns are not a second M₅ surface.
    const coverage = await loadLiveRecipeCoverage();
    const codePatterns = await db.all(
      `SELECT id, title, content FROM brain_semantic
       WHERE source_session_id = ?
       AND category = 'code_pattern'
       AND created_at > datetime('now', '-2 hours')`,
      [sessionId],
    );
    for (const row of codePatterns) {
      const r = row as { id: number; title: string; content: string };
      if (coverage.memoryIds.has(r.id) || sessionRecipes.linkedMemoryIds.has(r.id)) continue;
      if (
        leftoverCoveredByFingerprints(
          leftoverFingerprints([r.title, r.content]),
          coverage.fingerprints,
        )
      ) {
        continue;
      }
      const written = await BasalGanglia.recordSuccess({
        goal_type: "coding",
        pattern_signature: r.title.slice(0, 80),
        description: r.content.slice(0, 300),
        success: true,
      }).catch(() => 0);
      if (written > 0) result.procedural++;
    }

    return result;
  },

  async store(input: StoreInput): Promise<number> {
    const { id } = await BrainStore.storeSemanticDeduped(input);
    PrefrontalCortex.feedbackFromHippocampus(
      { title: input.title, category: input.category },
      input.session_id,
    );
    return id;
  },

  async recall(query: string, limit = 10) {
    return BrainStore.searchSemantic(query, undefined, limit);
  },

  /**
   * H→P: retrieved memory can re-plan. Hint only — never C_goal (REL-07).
   */
  replanFromHits(hits: FusionResult[], sessionId?: string): void {
    const top = hits[0];
    if (!top) return;
    if (top.type === "semantic") {
      const row = top.data as { title?: string; category?: string };
      PrefrontalCortex.feedbackFromHippocampus(
        { title: row.title, category: row.category },
        sessionId,
      );
      return;
    }
    const content = String((top.data as { content?: string }).content ?? "").trim();
    if (!content) return;
    PrefrontalCortex.feedbackFromHippocampus(
      { title: content.slice(0, 80), category: "episodic" },
      sessionId,
    );
  },

  /**
   * φ₆ — multi-strategy fusion retrieval (H on the live path).
   * Callers must pass the returned hits into B_s (`fusion_hits`) so assembly
   * does not search again (REL-04).
   */
  async fusionRetrieve(input: {
    message: string;
    session_id?: string;
    limit?: number;
    minScore?: number;
    includeEpisodic?: boolean;
    /** Pre-expanded REL-01 query. When omitted, continuation text is expanded here. */
    retrieval_query?: string;
  }): Promise<FusionResult[]> {
    const config = getMemoryConfig();
    const projectSessionIds = await getProjectSessionIds(input.session_id);
    const { resolveRetrievalQuery } = await import("../RetrievalQuery.js");
    const resolved = await resolveRetrievalQuery({
      message: input.message,
      sessionId: input.session_id,
      retrievalQueryOverride: input.retrieval_query,
    });
    const query = resolved.retrievalQuery;
    const currentTaskId = input.session_id
      ? (await BrainStore.getOpenTask(input.session_id))?.id ?? null
      : null;
    return RetrievalFusion.search({
      query,
      sessionId: input.session_id,
      limit: input.limit ?? config.retrieval_top_k,
      minScore: input.minScore ?? config.retrieval_threshold,
      includeEpisodic: input.includeEpisodic ?? true,
      projectSessionIds,
      intent: resolved.intent,
      originalQuery: input.message,
      currentTaskId,
    });
  },
};
