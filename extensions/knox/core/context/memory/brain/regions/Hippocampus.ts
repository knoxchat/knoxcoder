/**
 * Hippocampus — Encoding + long-term storage facade (φ₄, φ₅, φ₆).
 * Wraps AutoMemory and BrainStore. Sends Hippocampus→Prefrontal feedback
 * as a recent-knowledge hint (REL-07: never overwrites C_goal).
 *
 * Part III:
 *   φ₄ consolidation — extract + store to M₃ (hot/short-term)
 *   φ₅ long-term storage — compress → M₄ (warm), patterns → M₅ (procedural)
 *   φ₆ retrieval — fusion search
 */

import { AutoMemory } from "../AutoMemory.js";
import { BrainStore } from "../BrainStore.js";
import { RetrievalFusion, type FusionResult } from "../RetrievalFusion.js";
import { getMemoryConfig } from "../memoryConfigAccess.js";
import { getProjectSessionIds } from "../projectScope.js";
import type { StoreInput } from "../types.js";
import { BasalGanglia } from "./BasalGanglia.js";
import { PrefrontalCortex } from "./PrefrontalCortex.js";

export interface LongTermPersistResult {
  /** Memories promoted hot → warm (M₄). */
  promoted: number;
  /** Code patterns archived to procedural memory (M₅). */
  procedural: number;
  /** Content compressed for long-term tiers. */
  compressed: number;
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
   * φ₅ — compress(m) → M₄, M₅ after consolidation (φ₄).
   * Promotes high-importance hot memories to warm (M₄), archives code patterns
   * to BasalGanglia procedural store (M₅), and compresses long warm content.
   */
  async persistToLongTerm(
    sessionId: string,
    extracted: { semantic_count: number; entity_count: number },
  ): Promise<LongTermPersistResult> {
    const result: LongTermPersistResult = { promoted: 0, procedural: 0, compressed: 0 };

    if (extracted.semantic_count === 0 && extracted.entity_count === 0) {
      return result;
    }

    const db = await BrainStore.get();

    // M₄ — promote high-importance recent hot memories to warm (long-term)
    const promoteResult = await db.run(
      `UPDATE brain_semantic SET tier = 'warm'
       WHERE source_session_id = ?
       AND tier = 'hot'
       AND importance_score >= 0.65
       AND created_at > datetime('now', '-2 hours')`,
      [sessionId],
    );
    result.promoted = promoteResult.changes ?? 0;

    // M₅ — archive code_pattern entries to procedural memory (Basal Ganglia)
    const codePatterns = await db.all(
      `SELECT id, title, content FROM brain_semantic
       WHERE source_session_id = ?
       AND category = 'code_pattern'
       AND created_at > datetime('now', '-2 hours')`,
      [sessionId],
    );
    for (const row of codePatterns) {
      const r = row as { id: number; title: string; content: string };
      await BasalGanglia.recordSuccess({
        goal_type: "coding",
        pattern_signature: r.title.slice(0, 80),
        description: r.content.slice(0, 300),
        success: true,
      }).catch(() => {});
      result.procedural++;
    }

    // Compress long warm-tier content (φ₅ compress step)
    const warmRows = await db.all(
      `SELECT id, content FROM brain_semantic
       WHERE source_session_id = ? AND tier = 'warm'
       AND length(content) > 200 AND content NOT LIKE 'z:%'`,
      [sessionId],
    );
    for (const row of warmRows) {
      const r = row as { id: number; content: string };
      const compressed = BrainStore.compressContent(r.content);
      if (compressed !== r.content) {
        await db.run("UPDATE brain_semantic SET content = ? WHERE id = ?", [compressed, r.id]);
        result.compressed++;
      }
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
   * φ₆ — multi-strategy fusion retrieval (M layer in O(x)).
   * Callers must pass the returned hits into φ₈ (`fusion_hits`) so assembly
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
