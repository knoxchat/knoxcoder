/** Semantic memory, pinning, mismatch, and dedup. */

import { insertForgettingFields, resolveStability } from "../Forgetting.js";
import { encodeMinhash, minhashSignature, minhashSimilarity, signatureFromBytes } from "../minhash.js";
import { InputSanitizer } from "../InputSanitizer.js";
import { classifyInsertTier } from "../Tiers.js";
import { CONTRADICTION_CATEGORIES, conflictsWith, supersedeConflicts } from "../memoryOutcomes.js";
import { canSupersede, normalizeSrc, type MemorySrc } from "../provenance.js";
import {
  contentHash,
  scopeKeyForSession,
  withScopeLock,
  type ReconcileVerdict,
} from "../reconcile.js";
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
import { bitemporalSql, notSupersededSql, queryScopeSql, validAtSql, type BitemporalQuery } from "./validity.js";
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

/**
 * MEM-51 / MEM-52: idempotent, serialized write. Writing the same fact (same
 * category + normalized content) in the same scope returns the existing valid
 * row instead of a second one. Calls for one scope run one at a time.
 */
export async function storeSemantic(input: StoreInput): Promise<number> {
  const db = await get();
  const scopeKey = await scopeKeyForSession(db, input.session_id);
  return withScopeLock(scopeKey, () => insertSemantic(input, scopeKey));
}

/** Unserialized insert. Callers hold the scope lock (see `storeSemantic`). */
async function insertSemantic(input: StoreInput, scopeKey: string): Promise<number> {
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
  const tier = classifyInsertTier({
    importance_score: importance,
    i0: forgetting.i0,
    stability: forgetting.stability,
    category: input.category,
  });

  const hash = contentHash(input.category, cleanedContent);
  const existing = await findValidByHash(scopeKey, hash);
  if (existing != null) return existing;

  let result;
  try {
    result = await db.run(
      `INSERT INTO brain_semantic (category, title, content, source_session_id, keywords, importance_score, emotional_valence, salience, expires_at, topic_id, task_id, summary_of, parent_id, stability, difficulty, i0, valid_from, tier, src, recorded_at, content_hash, scope_key, minhash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, datetime('now'), ?, ?, ?)`,
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
        tier,
        normalizeSrc(input.src),
        hash,
        scopeKey,
        encodeMinhash(`${cleanedTitle} ${input.keywords ?? ""} ${cleanedContent}`),
      ],
    );
  } catch (err) {
    // Another connection won the unique index race: return its row.
    if (/UNIQUE|constraint/i.test(String((err as Error)?.message ?? err))) {
      const winner = await findValidByHash(scopeKey, hash);
      if (winner != null) return winner;
    }
    throw err;
  }

  return result.lastID!;
}

/** The valid, live row for (scope, hash), if any. */
async function findValidByHash(scopeKey: string, hash: string): Promise<number | null> {
  const db = await get();
  const row = await db.get<{ id: number }>(
    `SELECT id FROM brain_semantic
      WHERE scope_key = ? AND content_hash = ?
        AND tombstoned_at IS NULL AND valid_to IS NULL
      LIMIT 1`,
    [scopeKey, hash],
  );
  return row?.id ?? null;
}

/**
 * MEM-50: facts as they were. `asOf` is valid time, `knownAt` transaction time.
 * Superseded facts are included when they were valid at `asOf`. Direct id
 * lookup (`getSemanticById`) is unaffected.
 */
export async function getSemanticAsOf(
  query: BitemporalQuery & { sessionIds?: string[]; limit?: number } = {},
): Promise<SemanticMemory[]> {
  const db = await get();
  const t = bitemporalSql(query);
  const params: unknown[] = [...t.params];
  let scope = "";
  if (query.sessionIds) {
    if (query.sessionIds.length === 0) return [];
    scope = ` AND source_session_id IN (${query.sessionIds.map(() => "?").join(",")})`;
    params.push(...query.sessionIds);
  }
  params.push(Math.max(1, query.limit ?? 200));
  const rows = await db.all(
    `SELECT * FROM brain_semantic
      WHERE tombstoned_at IS NULL AND ${t.sql}${scope}
      ORDER BY created_at ASC, id ASC LIMIT ?`,
    params,
  );
  return rows.map(rowToSemantic);
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
/** MEM-58: estimated 3-shingle Jaccard at or above which two facts are the same fact. */
export const MERGE_MINHASH_MIN = 0.8;

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
    `SELECT id, category, title, content, minhash FROM brain_semantic
     WHERE category = ?
       AND tombstoned_at IS NULL
       AND (expires_at IS NULL OR expires_at > datetime('now'))
       AND ${validAtSql()}
       AND ${notSupersededSql()}
     ORDER BY created_at DESC
     LIMIT 40`,
    [input.category],
  )) as { id: number; category: string; title: string; content: string; minhash?: Uint8Array | null }[];
  const incomingSig = minhashSignature(`${input.title} ${input.keywords ?? ""} ${input.content}`);
  for (const row of rows) {
    // MEM-58: near-duplicate by MinHash estimate (stored at encode time).
    const stored = signatureFromBytes(row.minhash);
    if (stored && minhashSimilarity(incomingSig, stored) >= MERGE_MINHASH_MIN) return row;
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

/**
 * MEM-49 — φ₄ reconcile against the valid facts of the same scope.
 *
 *   NOOP       identical fact already valid (same hash) — nothing to write
 *   SUPERSEDE  a decision / preference contradicts its near-duplicate: write the
 *              new row, close the old one (the row stays; earlier states stay queryable)
 *   UPDATE     near-duplicate whose content the new write extends: keep the richer text
 *   MERGE      near-duplicate that adds nothing new: fold into the existing row
 *   ADD        no match
 *
 * The trust order (MEM-48) can turn SUPERSEDE / UPDATE / MERGE into ADD: a `tool` or
 * `external` write never changes a `user` fact on its own.
 */
export async function reconcileSemantic(
  input: StoreInput,
  scopeKey: string,
): Promise<ReconcileVerdict> {
  const src: MemorySrc = normalizeSrc(input.src);
  const cleanedContent = InputSanitizer.enforce(input.content, "semantic.content");
  const exact = await findValidByHash(scopeKey, contentHash(input.category, cleanedContent));
  if (exact != null) return { action: "NOOP", targetId: exact, reason: "same content hash" };

  const db = await get();
  const target = await findNearDuplicate(input);
  if (!target) return { action: "ADD", reason: "no near-duplicate" };

  const old = (await db.get(
    "SELECT id, category, title, content, src FROM brain_semantic WHERE id = ?",
    [target.id],
  )) as { id: number; category: string; title: string; content: string; src?: string | null } | undefined;
  if (!old) return { action: "ADD", reason: "near-duplicate vanished" };

  if (!canSupersede(src, old.src as MemorySrc | null | undefined)) {
    return {
      action: "ADD",
      targetId: old.id,
      reason: `${src} write cannot change a ${old.src ?? "user"} fact`,
      trustBlocked: true,
    };
  }

  if (
    CONTRADICTION_CATEGORIES.has(input.category) &&
    conflictsWith({ id: -1, category: input.category, title: input.title, content: input.content }, old)
  ) {
    return { action: "SUPERSEDE", targetId: old.id, reason: "contradicts near-duplicate" };
  }
  if (cleanedContent.length > String(old.content ?? "").length) {
    return { action: "UPDATE", targetId: old.id, reason: "extends near-duplicate" };
  }
  return { action: "MERGE", targetId: old.id, reason: "near-duplicate adds nothing" };
}

/** Best near-duplicate by title/keywords first, then content-word subset. */
async function findNearDuplicate(input: StoreInput): Promise<{ id: number } | undefined> {
  const duplicates = await findDuplicates(input.title, input.keywords ?? "", input.category);
  if (duplicates.length > 0 && duplicates[0].similarity >= DEDUP_SIMILARITY) {
    return { id: duplicates[0].id };
  }
  const contentDup = await findContentNearDuplicate(input);
  return contentDup ? { id: contentDup.id } : undefined;
}

export async function storeSemanticDeduped(
  input: StoreInput,
): Promise<{ id: number; deduplicated: boolean; verdict?: ReconcileVerdict }> {
  const db = await get();
  const scopeKey = await scopeKeyForSession(db, input.session_id);
  // MEM-52: reconcile + insert + supersede are one unit per scope.
  return withScopeLock(scopeKey, async () => {
    const verdict = await reconcileSemantic(input, scopeKey);
    const src = normalizeSrc(input.src);
    let id: number;
    let deduplicated = false;
    switch (verdict.action) {
      case "NOOP":
        id = verdict.targetId!;
        deduplicated = true;
        break;
      case "UPDATE":
      case "MERGE":
        id = verdict.targetId!;
        await boostDuplicate(id, input.content);
        deduplicated = true;
        break;
      case "SUPERSEDE": {
        id = await insertSemantic(input, scopeKey);
        const row = (await db.get(
          "SELECT id, category, title, content, created_at, src FROM brain_semantic WHERE id = ?",
          [id],
        )) as any;
        await supersedeConflicts(db, row).catch(() => []);
        break;
      }
      case "ADD":
      default:
        id = await insertSemantic(input, scopeKey);
        break;
    }
    if (verdict.action !== "ADD" || verdict.trustBlocked) {
      await auditLog("reconcile", "semantic", id, {
        action: verdict.action,
        reason: verdict.reason,
        src,
        target: verdict.targetId ?? null,
        trust_blocked: verdict.trustBlocked ?? false,
      });
    }
    return { id, deduplicated, verdict };
  });
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
