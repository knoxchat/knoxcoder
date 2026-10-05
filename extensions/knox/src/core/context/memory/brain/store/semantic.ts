/** Semantic memory, pinning, mismatch, and dedup. */

import { InputSanitizer } from "../InputSanitizer.js";
import type {
  SemanticCategory,
  SemanticMemory,
  StoreInput
} from "../types.js";
import { get } from "./connection.js";
import { rowToSemantic } from "./mappers.js";
import { addTag } from "./organization.js";
import { auditLog, getLatestSessionTopic, getOpenTask } from "./runtime.js";
import { computeSalience, detectEmotionalValence } from "./valence.js";

// ── Semantic Memory Operations ─────────────────────────────────────────────

export async function getSemanticBySession(sessionId: string, limit = 200): Promise<SemanticMemory[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT * FROM brain_semantic WHERE source_session_id = ? ORDER BY created_at ASC LIMIT ?`,
    [sessionId, limit],
  );
  return rows.map(rowToSemantic);
}

export async function getSemanticById(id: number): Promise<SemanticMemory | null> {
  const db = await get();
  const row = await db.get("SELECT * FROM brain_semantic WHERE id = ?", [id]);
  return row ? rowToSemantic(row) : null;
}

/**
 * REL-12: increment retrieval_count only for memories that were actually
 * used (fusion hits that passed the gate and θ, or LIKE items assembled
 * into context). Candidate lists must not call this.
 */
export async function touchSemanticRetrieval(ids: number[]): Promise<void> {
  const unique = [
    ...new Set(
      ids.map((id) => Math.trunc(Number(id))).filter((id) => id > 0),
    ),
  ];
  if (unique.length === 0) return;
  const db = await get();
  const placeholders = unique.map(() => "?").join(",");
  await db.run(
    `UPDATE brain_semantic
     SET retrieval_count = retrieval_count + 1,
         last_accessed_at = datetime('now')
     WHERE id IN (${placeholders})`,
    unique,
  );
}

export async function isPinned(memoryId: number): Promise<boolean> {
  const db = await get();
  const row = await db.get(
    `SELECT 1 FROM brain_tags
     WHERE memory_type = 'semantic' AND memory_id = ? AND tag = 'pinned'
     LIMIT 1`,
    [memoryId],
  );
  return !!row;
}

export async function storeSemantic(input: StoreInput): Promise<number> {
  const db = await get();

  // Security scanning on all memory writes (P1.1)
  const cleanedTitle = InputSanitizer.enforce(input.title, "semantic.title");
  const cleanedContent = InputSanitizer.enforce(input.content, "semantic.content");

  const expiresAt = input.ttl_days
    ? new Date(Date.now() + input.ttl_days * 86400000).toISOString()
    : null;

  const valence = input.emotional_valence ?? detectEmotionalValence(cleanedContent, "assistant");
  const sal = input.salience ?? computeSalience(cleanedContent, "assistant", input.importance ?? 0.5);

  let topicId = input.topic_id ?? null;
  if (topicId == null && input.session_id) {
    const existing = await getLatestSessionTopic(input.session_id);
    topicId = existing?.id ?? null;
  }

  let taskId = input.task_id ?? null;
  if (taskId == null && input.session_id) {
    const open = await getOpenTask(input.session_id);
    taskId = open?.id ?? null;
  }

  const result = await db.run(
    `INSERT INTO brain_semantic (category, title, content, source_session_id, keywords, importance_score, emotional_valence, salience, expires_at, topic_id, task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.category,
      cleanedTitle,
      cleanedContent,
      input.session_id ?? null,
      input.keywords ?? "",
      input.importance ?? 0.5,
      valence,
      sal,
      expiresAt,
      topicId,
      taskId,
    ],
  );

  return result.lastID!;
}

/**
 * REL-08: insert or boost a near-duplicate. Auto-extract and BrainManager.store
 * share this so heuristic dumps do not create a second row.
 */
export const DEDUP_SIMILARITY = 0.7;

export async function storeSemanticDeduped(
  input: StoreInput,
): Promise<{ id: number; deduplicated: boolean }> {
  const duplicates = await findDuplicates(
    input.title,
    input.keywords ?? "",
    input.category,
  );
  if (duplicates.length > 0 && duplicates[0].similarity >= DEDUP_SIMILARITY) {
    await boostDuplicate(duplicates[0].id, input.content);
    return { id: duplicates[0].id, deduplicated: true };
  }
  const id = await storeSemantic(input);
  return { id, deduplicated: false };
}

/** Below this many rows a zero-hit FTS5 query is retried with the substring LIKE scan. */
const LIKE_SCAN_MAX_ROWS = 5000;

export async function searchSemantic(query: string, category?: SemanticCategory, limit: number = 10): Promise<SemanticMemory[]> {
  const db = await get();

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

  // Fetch more candidates for re-ranking
  const fetchLimit = Math.max(limit * 3, 30);

  let ftsRows: any[] | null = null;

  // Candidates from FTS5 (BM25 order). The LIKE scan below reads every row, which costs
  // ~0.4 s at 100k items and, ordered by importance, lets common words crowd out the real
  // match. LIKE stays only for FTS-less builds and for small brains where its substring
  // matches are cheap and useful.
  const ftsTerms = terms
    .flatMap((t) => t.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter((t) => t.length > 1);
  if (ftsTerms.length > 0) {
    try {
      const ftsConditions = ["(s.expires_at IS NULL OR s.expires_at > datetime('now'))"];
      const ftsParams: any[] = [];
      if (category) {
        ftsConditions.push("s.category = ?");
        ftsParams.push(category);
      }
      const match = ftsTerms.map((t) => `"${t}"*`).join(" OR ");
      ftsRows = await db.all(
        `SELECT s.* FROM brain_semantic s
         JOIN brain_semantic_fts fts ON s.id = fts.rowid
         WHERE ${ftsConditions.join(" AND ")} AND brain_semantic_fts MATCH ?
         ORDER BY bm25(brain_semantic_fts, 5.0, 1.0, 3.0)
         LIMIT ?`,
        [...ftsParams, match, fetchLimit],
      );
      if (ftsRows!.length === 0) {
        const total = await db.get("SELECT COUNT(*) AS n FROM brain_semantic");
        if (((total as any)?.n ?? 0) <= LIKE_SCAN_MAX_ROWS) ftsRows = null;
      }
    } catch {
      ftsRows = null; // FTS5 unavailable
    }
  }

  let rows: any[];
  if (ftsRows !== null) {
    rows = ftsRows;
  } else {
    const conditions: string[] = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
    const params: any[] = [];

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    if (terms.length > 0) {
      const termConditions = terms.map(() =>
        "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)",
      );
      conditions.push(`(${termConditions.join(" OR ")})`);
      for (const term of terms) {
        const like = `%${term}%`;
        params.push(like, like, like);
      }
    }
    params.push(fetchLimit);

    rows = await db.all(
      `SELECT * FROM brain_semantic
       WHERE ${conditions.join(" AND ")}
       ORDER BY importance_score DESC, retrieval_count DESC, last_accessed_at DESC
       LIMIT ?`,
      params,
    );
  }

  // BM25-inspired re-ranking
  if (terms.length > 0 && rows.length > 1) {
    const totalDocs = rows.length;
    const avgDocLen = rows.reduce((sum: number, r: any) =>
      sum + (r.title.length + r.content.length + r.keywords.length), 0) / totalDocs;
    const k1 = 1.5;
    const b = 0.75;

    // Compute IDF for each term
    const idf = new Map<string, number>();
    for (const term of terms) {
      let docsWithTerm = 0;
      for (const r of rows) {
        const doc = `${(r as any).title} ${(r as any).content} ${(r as any).keywords}`.toLowerCase();
        if (doc.includes(term)) docsWithTerm++;
      }
      const idfScore = Math.log((totalDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
      idf.set(term, Math.max(idfScore, 0));
    }

    // Prefetch pinned IDs among candidates for ranking boost
    const candidateIds = rows.map((r: any) => r.id as number);
    const pinnedIdSet = new Set<number>();
    if (candidateIds.length > 0) {
      const placeholders = candidateIds.map(() => "?").join(",");
      const pinnedRows = await db.all(
        `SELECT memory_id FROM brain_tags
         WHERE memory_type = 'semantic' AND tag = 'pinned'
         AND memory_id IN (${placeholders})`,
        candidateIds,
      );
      for (const pr of pinnedRows) {
        pinnedIdSet.add((pr as any).memory_id);
      }
    }

    // Score each row
    const scored = rows.map((r: any) => {
      const doc = `${r.title} ${r.content} ${r.keywords}`.toLowerCase();
      const docLen = doc.length;
      let bm25Score = 0;

      for (const term of terms) {
        // Count term frequency
        let tf = 0;
        let pos = 0;
        while ((pos = doc.indexOf(term, pos)) !== -1) {
          tf++;
          pos += term.length;
        }
        // Title matches count 3x
        const titleDoc = r.title.toLowerCase();
        let titleTf = 0;
        pos = 0;
        while ((pos = titleDoc.indexOf(term, pos)) !== -1) {
          titleTf++;
          pos += term.length;
        }
        tf += titleTf * 2; // Boost title matches

        const termIdf = idf.get(term) ?? 0;
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
        bm25Score += termIdf * tfNorm;
      }

      // Blend BM25 with importance and recency; pinned memories win ties.
      const importanceBoost = r.importance_score * 0.3;
      const retrievalBoost = Math.min(r.retrieval_count * 0.02, 0.2);
      const pinnedBoost = pinnedIdSet.has(r.id) ? 2.0 : 0;
      const finalScore = bm25Score + importanceBoost + retrievalBoost + pinnedBoost;

      return { row: r, score: finalScore };
    });

    scored.sort((a, b) => b.score - a.score);
    const topRows = scored.slice(0, limit).map((s) => s.row);
    // REL-12: LIKE is a candidate hunt — do not bump retrieval_count here.
    return topRows.map(rowToSemantic);
  }

  // No terms or single result — just return as-is
  const topRows = rows.slice(0, limit);
  return topRows.map(rowToSemantic);
}

export async function deleteSemantic(id: number): Promise<boolean> {
  const record = await getSemanticById(id);
  const db = await get();
  const result = await db.run("DELETE FROM brain_semantic WHERE id = ?", [id]);
  // Also remove associations and tags so bulk/single delete stay consistent
  await db.run(
    "DELETE FROM brain_associations WHERE (source_type = 'semantic' AND source_id = ?) OR (target_type = 'semantic' AND target_id = ?)",
    [id, id],
  );
  await db.run(
    "DELETE FROM brain_tags WHERE memory_type = 'semantic' AND memory_id = ?",
    [id],
  );
  const deleted = (result.changes ?? 0) > 0;
  if (deleted && record) {
    await auditLog("delete", "semantic", id, { record });
  }
  return deleted;
}

/**
 * REL-14: demote a semantic memory without deleting it.
 * Increments mismatch_count, tags `mismatch`, and sets an expiry window.
 */
export async function recordMismatch(
  id: number,
  topicId: number | null = null,
  ttlDays = 7,
): Promise<boolean> {
  const mem = await getSemanticById(id);
  if (!mem) return false;
  const db = await get();
  const until = new Date(Date.now() + ttlDays * 86400000).toISOString();
  const result = await db.run(
    `UPDATE brain_semantic
     SET mismatch_count = COALESCE(mismatch_count, 0) + 1,
         mismatch_until = ?,
         mismatch_topic_id = ?
     WHERE id = ?`,
    [until, topicId, id],
  );
  await addTag("semantic", id, "mismatch");
  return (result.changes ?? 0) > 0;
}

// ── Memory Deduplication ───────────────────────────────────────────────────

/**
 * Find near-duplicate semantic memories based on title and keyword overlap.
 * Returns potential duplicates with their similarity scores.
 */
export async function findDuplicates(title: string, keywords: string, category?: SemanticCategory): Promise<{ id: number; title: string; similarity: number }[]> {
  const db = await get();
  const titleWords = new Set(title.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const kwSet = new Set(keywords.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 2));

  const conditions: string[] = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
  const params: any[] = [];

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }

  // Pre-filter candidates using OR-matched keywords
  if (kwSet.size > 0) {
    const kwConditions = Array.from(kwSet).slice(0, 5).map(() => "LOWER(keywords) LIKE ?");
    conditions.push(`(${kwConditions.join(" OR ")})`);
    for (const kw of Array.from(kwSet).slice(0, 5)) {
      params.push(`%${kw}%`);
    }
  }

  const rows = await db.all(
    `SELECT id, title, keywords FROM brain_semantic WHERE ${conditions.join(" AND ")} LIMIT 50`,
    params,
  );

  const duplicates: { id: number; title: string; similarity: number }[] = [];
  for (const row of rows) {
    const r = row as any;
    const rTitleWords = new Set(r.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2));
    const rKwSet = new Set(r.keywords.toLowerCase().split(/[,\s]+/).filter((w: string) => w.length > 2));

    // Jaccard similarity on title words
    const titleIntersection = new Set([...titleWords].filter((w) => rTitleWords.has(w)));
    const titleUnion = new Set([...titleWords, ...rTitleWords]);
    const titleSim = titleUnion.size > 0 ? titleIntersection.size / titleUnion.size : 0;

    // Jaccard similarity on keywords
    const kwIntersection = new Set([...kwSet].filter((w) => rKwSet.has(w)));
    const kwUnion = new Set([...kwSet, ...rKwSet]);
    const kwSim = kwUnion.size > 0 ? kwIntersection.size / kwUnion.size : 0;

    // Weighted average
    const similarity = titleSim * 0.6 + kwSim * 0.4;
    if (similarity >= 0.5) {
      duplicates.push({ id: r.id, title: r.title, similarity });
    }
  }

  return duplicates.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Boost an existing memory that was identified as a near-duplicate.
 * Increases importance and updates content if new content is longer.
 */
export async function boostDuplicate(id: number, newContent: string): Promise<void> {
  const db = await get();
  await db.run(
    `UPDATE brain_semantic SET
       importance_score = MIN(1.0, importance_score + 0.1),
       last_accessed_at = datetime('now'),
       content = CASE WHEN length(?) > length(content) THEN ? ELSE content END
     WHERE id = ?`,
    [newContent, newContent, id],
  );
}
