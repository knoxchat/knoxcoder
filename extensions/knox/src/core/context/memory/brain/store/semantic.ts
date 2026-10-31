/** Semantic memory, pinning, mismatch, and dedup. */

import { insertForgettingFields, resolveStability } from "../Forgetting.js";
import { InputSanitizer } from "../InputSanitizer.js";
import { CONTRADICTION_CATEGORIES, conflictsWith, supersedeConflicts } from "../memoryOutcomes.js";
import type {
  SemanticCategory,
  SemanticMemory,
  StoreInput
} from "../types.js";
import { cjkIndexTokens, isCjkToken } from "../cjkFts.js";
import { contentWords } from "../RetrievalQuery.js";
import { get } from "./connection.js";
import { rowToSemantic } from "./mappers.js";
import { addTag } from "./organization.js";
import { auditLog, getLatestSessionTopic, getOpenTask } from "./runtime.js";
import { parseSummaryOf, serializeSummaryOf } from "./summaryTree.js";
import { TOMBSTONE_REASON, liveRetrieveSql, tombstoneMemories } from "./tombstone.js";
import { notSupersededSql, queryScopeSql, validAtSql } from "./validity.js";
import { computeSalience, detectEmotionalValence } from "./valence.js";

// ── Semantic Memory Operations ─────────────────────────────────────────────

export async function getSemanticBySession(sessionId: string, limit = 200): Promise<SemanticMemory[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT * FROM brain_semantic
     WHERE source_session_id = ? AND ${liveRetrieveSql()}
     ORDER BY created_at ASC LIMIT ?`,
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
 * MEM-16: record an inject for calibration. Does not write S, D, I,
 * retrieval_count, or last_accessed_at — leftover I(m,t) and FSRS use those.
 * REL-12: only fusion hits that passed the gate and θ, or LIKE items
 * assembled into context. Candidate lists must not call this.
 */
export async function recordSemanticInject(ids: number[]): Promise<void> {
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
     SET inject_count = COALESCE(inject_count, 0) + 1
     WHERE id IN (${placeholders})`,
    unique,
  );
}

/** Leftover name. MEM-16: calibration inject only — not a retrieve-time strengthen. */
export const touchSemanticRetrieval = recordSemanticInject;

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

async function resolveInheritStability(input: StoreInput): Promise<number | null> {
  if (input.category !== "summary" && input.category !== "insight") return null;

  const summaryOf = serializeSummaryOf(input.summary_of);
  const linked = Boolean(input.parent_id) || Boolean(summaryOf);
  if (!linked) return null;

  const db = await get();
  const values: number[] = [];

  if (input.parent_id) {
    const parent = await db.get<{ stability: number | null; category: string }>(
      "SELECT stability, category FROM brain_semantic WHERE id = ?",
      [input.parent_id],
    );
    if (parent) values.push(resolveStability(parent.stability, parent.category));
  }

  for (const ref of parseSummaryOf(summaryOf)) {
    if (ref.type === "semantic") {
      const row = await db.get<{ stability: number | null; category: string }>(
        "SELECT stability, category FROM brain_semantic WHERE id = ?",
        [ref.id],
      );
      if (row) values.push(resolveStability(row.stability, row.category));
    } else {
      const row = await db.get<{ stability: number | null }>(
        "SELECT stability FROM brain_episodic WHERE id = ?",
        [ref.id],
      );
      if (row) values.push(resolveStability(row.stability, "episodic"));
    }
  }

  return values.length > 0 ? Math.max(...values) : null;
}

export async function storeSemantic(input: StoreInput): Promise<number> {
  const db = await get();

  // Security scanning on all memory writes (P1.1)
  const cleanedTitle = InputSanitizer.enforce(input.title, "semantic.title");
  const cleanedContent = InputSanitizer.enforce(input.content, "semantic.content");

  const expiresAt = input.ttl_days
    ? new Date(Date.now() + input.ttl_days * 86400000).toISOString()
    : null;

  const importance = input.importance ?? 0.5;
  const valence = input.emotional_valence ?? detectEmotionalValence(cleanedContent, "assistant");
  const sal = input.salience ?? computeSalience(cleanedContent, "assistant", importance);

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

  const summaryOf = serializeSummaryOf(input.summary_of);
  const inheritStability = await resolveInheritStability(input);
  const forgetting = insertForgettingFields(input.category, importance, {
    inheritStability,
    linkedAsTreeNode: inheritStability != null || Boolean(input.parent_id) || Boolean(summaryOf),
  });

  const result = await db.run(
    `INSERT INTO brain_semantic (category, title, content, source_session_id, keywords, importance_score, emotional_valence, salience, expires_at, topic_id, task_id, summary_of, parent_id, stability, difficulty, i0, valid_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.category,
      cleanedTitle,
      cleanedContent,
      input.session_id ?? null,
      input.keywords ?? "",
      importance,
      valence,
      sal,
      expiresAt,
      topicId,
      taskId,
      summaryOf,
      input.parent_id ?? null,
      forgetting.stability,
      forgetting.difficulty,
      forgetting.i0,
    ],
  );

  return result.lastID!;
}

/**
 * T2: edit an existing semantic row in place (category / title / content).
 * FTS stays current via `brain_semantic_fts_update`.
 */
export async function updateSemantic(input: {
  id: number;
  category: SemanticCategory;
  title: string;
  content: string;
  keywords?: string;
}): Promise<boolean> {
  const existing = await getSemanticById(input.id);
  if (!existing) return false;
  const cleanedTitle = InputSanitizer.enforce(input.title, "semantic.title");
  const cleanedContent = InputSanitizer.enforce(input.content, "semantic.content");
  const db = await get();
  const result = await db.run(
    `UPDATE brain_semantic
     SET category = ?, title = ?, content = ?, keywords = ?
     WHERE id = ?`,
    [
      input.category,
      cleanedTitle,
      cleanedContent,
      input.keywords ?? existing.keywords,
      input.id,
    ],
  );
  if ((result.changes ?? 0) > 0) {
    await auditLog("update", "semantic", input.id, {
      category: input.category,
      title: cleanedTitle,
    });
    return true;
  }
  return false;
}

/**
 * REL-08: insert or boost a near-duplicate. Auto-extract and BrainManager.store
 * share this so heuristic dumps do not create a second row.
 */
export const DEDUP_SIMILARITY = 0.7;
const CONTENT_SHARED_MIN = 2;

/**
 * LLM titles often differ from heuristic titles ("Always use bun" vs
 * "Preference: use bun"). Merge only when one content-word set contains the
 * other so "Alpha batch manage" and "Beta batch manage" stay distinct.
 */
async function findContentNearDuplicate(
  input: StoreInput,
): Promise<{ id: number; category: string; title: string; content: string } | undefined> {
  const incoming = new Set(contentWords(input.content));
  if (incoming.size < CONTENT_SHARED_MIN) return undefined;
  const db = await get();
  const rows = (await db.all(
    `SELECT id, category, title, content FROM brain_semantic
     WHERE category = ?
       AND tombstoned_at IS NULL
       AND (expires_at IS NULL OR expires_at > datetime('now'))
       AND ${validAtSql()}
       AND ${notSupersededSql()}
     ORDER BY created_at DESC
     LIMIT 40`,
    [input.category],
  )) as { id: number; category: string; title: string; content: string }[];
  for (const row of rows) {
    const existing = new Set(contentWords(row.content));
    if (existing.size < CONTENT_SHARED_MIN) continue;
    if (isContentWordSubset(incoming, existing)) {
      return row;
    }
  }
  return undefined;
}

function isContentWordSubset(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const word of small) {
    if (!large.has(word)) return false;
  }
  return true;
}

export async function storeSemanticDeduped(
  input: StoreInput,
): Promise<{ id: number; deduplicated: boolean }> {
  const duplicates = await findDuplicates(
    input.title,
    input.keywords ?? "",
    input.category,
  );
  if (duplicates.length > 0 && duplicates[0].similarity >= DEDUP_SIMILARITY) {
    // MC-52: a decision/preference that contradicts its near-duplicate is a change, not a repeat.
    // Keep both rows; the older one is marked superseded and skipped by recall.
    if (CONTRADICTION_CATEGORIES.has(input.category)) {
      const db = await get();
      const old = (await db.get("SELECT id, category, title, content FROM brain_semantic WHERE id = ?", [
        duplicates[0].id,
      ])) as { id: number; category: string; title: string; content: string } | undefined;
      if (old && conflictsWith({ id: -1, category: input.category, title: input.title, content: input.content }, old)) {
        const id = await storeSemantic(input);
        const row = (await db.get("SELECT id, category, title, content, created_at FROM brain_semantic WHERE id = ?", [id])) as any;
        await supersedeConflicts(db, row).catch(() => []);
        return { id, deduplicated: false };
      }
    }
    await boostDuplicate(duplicates[0].id, input.content);
    return { id: duplicates[0].id, deduplicated: true };
  }
  const contentDup = await findContentNearDuplicate(input);
  if (contentDup) {
    if (CONTRADICTION_CATEGORIES.has(input.category)) {
      if (conflictsWith({ id: -1, category: input.category, title: input.title, content: input.content }, contentDup)) {
        const id = await storeSemantic(input);
        const db = await get();
        const row = (await db.get("SELECT id, category, title, content, created_at FROM brain_semantic WHERE id = ?", [id])) as any;
        await supersedeConflicts(db, row).catch(() => []);
        return { id, deduplicated: false };
      }
    }
    await boostDuplicate(contentDup.id, input.content);
    return { id: contentDup.id, deduplicated: true };
  }
  const id = await storeSemantic(input);
  return { id, deduplicated: false };
}

/** Below this many rows a zero-hit FTS5 query is retried with the substring LIKE scan. */
const LIKE_SCAN_MAX_ROWS = 5000;

export async function searchSemantic(query: string, category?: SemanticCategory, limit: number = 10): Promise<SemanticMemory[]> {
  const db = await get();

  const cjkTerms = cjkIndexTokens(query);
  const terms = [
    ...cjkTerms,
    ...query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1 && !isCjkToken(t)),
  ];

  // Fetch more candidates for re-ranking
  const fetchLimit = Math.max(limit * 3, 30);

  let ftsRows: any[] | null = null;

  // Candidates from FTS5 (BM25 order). The LIKE scan below reads every row, which costs
  // ~0.4 s at 100k items and, ordered by importance, lets common words crowd out the real
  // match. LIKE stays only for FTS-less builds and for small brains where its substring
  // matches are cheap and useful.
  const ftsTerms = [
    ...cjkTerms,
    ...terms
      .filter((t) => !isCjkToken(t))
      .flatMap((t) => t.match(/[\p{L}\p{N}_]+/gu) ?? [])
      .filter((t) => t.length > 1),
  ];
  if (ftsTerms.length > 0) {
    try {
      const ftsConditions = [
        "(s.expires_at IS NULL OR s.expires_at > datetime('now'))",
        queryScopeSql("semantic", "s"),
      ];
      const ftsParams: any[] = [];
      if (category) {
        ftsConditions.push("s.category = ?");
        ftsParams.push(category);
      }
      const match = ftsTerms
        .map((t) =>
          isCjkToken(t) ? `"${t.replace(/"/g, "")}"` : `"${t}"*`,
        )
        .join(" OR ");
      // MATCH first so tombstone/expires filters cannot walk 100k rows (P1-5).
      ftsRows = await db.all(
        `WITH hits AS (
           SELECT rowid AS id, bm25(brain_semantic_fts, 5.0, 1.0, 3.0) AS rank
           FROM brain_semantic_fts
           WHERE brain_semantic_fts MATCH ?
           ORDER BY rank
           LIMIT ?
         )
         SELECT s.* FROM hits JOIN brain_semantic s ON s.id = hits.id
         WHERE ${ftsConditions.join(" AND ")}
         ORDER BY hits.rank
         LIMIT ?`,
        [match, fetchLimit * 10, ...ftsParams, fetchLimit],
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
    const conditions: string[] = [
      "(expires_at IS NULL OR expires_at > datetime('now'))",
      queryScopeSql("semantic"),
    ];
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
       ORDER BY id DESC
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

      // MEM-16 / MEM-21: LIKE is lexical BM25 only. Leftover I / retrieval_count
      // do not score. Pinned still wins ties as a UX pin, not strengthening.
      const pinnedBoost = pinnedIdSet.has(r.id) ? 2.0 : 0;
      const finalScore = bm25Score + pinnedBoost;

      return { row: r, score: finalScore };
    });

    scored.sort((a, b) => b.score - a.score);
    const topRows = scored.slice(0, limit).map((s) => s.row);
    // REL-12: LIKE is a candidate hunt — do not bump inject_count here.
    return topRows.map(rowToSemantic);
  }

  // No terms or single result — just return as-is
  const topRows = rows.slice(0, limit);
  return topRows.map(rowToSemantic);
}

/**
 * MEM-06: forget is a tombstone, not a DELETE.
 * Row, tags, associations, and FTS stay so undo can restore.
 * Pinned rows are exempt.
 */
export async function deleteSemantic(id: number): Promise<boolean> {
  const n = await tombstoneMemories("semantic", [id], TOMBSTONE_REASON.forget, { via: "forget" });
  return n > 0;
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

  const conditions: string[] = [
    "tombstoned_at IS NULL",
    "(expires_at IS NULL OR expires_at > datetime('now'))",
    validAtSql(),
    notSupersededSql(),
  ];
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
 * Merge a longer near-duplicate into the existing leaf. Does not write leftover
 * I / last_accessed_at (MEM-14 / MEM-16). Strength stays attribution-only.
 */
export async function boostDuplicate(id: number, newContent: string): Promise<void> {
  const db = await get();
  await db.run(
    `UPDATE brain_semantic SET
       content = CASE WHEN length(?) > length(content) THEN ? ELSE content END
     WHERE id = ?`,
    [newContent, newContent, id],
  );
}
