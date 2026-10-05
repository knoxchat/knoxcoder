/** Episodic memory writes, reads, and lexical search. */

import { InputSanitizer } from "../InputSanitizer.js";
import type {
  EmotionalValence,
  EpisodicMemory,
  EpisodicType
} from "../types.js";
import { get } from "./connection.js";
import { rowToEpisodic } from "./mappers.js";
import { createSession, getSession } from "./sessions.js";
import { computeSalience, detectEmotionalValence } from "./valence.js";

// ── Episodic Memory Operations ─────────────────────────────────────────────

export async function addEpisodic(
  sessionId: string,
  type: EpisodicType,
  role: string,
  content: string,
  tokenCount: number = 0,
  importanceScore: number = 0.5,
  metadata: Record<string, any> = {},
  emotionalValence?: EmotionalValence,
  salience?: number,
): Promise<number> {
  const db = await get();

  // Security scan episodic content (scan only, don't block conversation tracking)
  const scanResult = InputSanitizer.scan(content);
  const cleanedContent = scanResult.cleaned;

  // Ensure session exists
  const session = await getSession(sessionId);
  if (!session) {
    await createSession(sessionId, "Auto-created session", "");
  }

  // Auto-detect emotional valence if not provided
  const valence = emotionalValence ?? detectEmotionalValence(cleanedContent, role);
  const sal = salience ?? computeSalience(cleanedContent, role, importanceScore);

  const result = await db.run(
    `INSERT INTO brain_episodic (session_id, type, role, content, token_count, importance_score, emotional_valence, salience, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, type, role, cleanedContent, tokenCount, importanceScore, valence, sal, JSON.stringify(metadata)],
  );

  // Update session message count
  await db.run(
    `UPDATE brain_sessions SET message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?`,
    [sessionId],
  );

  return result.lastID!;
}

export async function getEpisodicBySession(sessionId: string, limit = 100): Promise<EpisodicMemory[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT * FROM brain_episodic WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
    [sessionId, limit],
  );
  return rows.map(rowToEpisodic);
}

export async function getRecentEpisodic(limit = 50): Promise<EpisodicMemory[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT * FROM brain_episodic WHERE tier IN ('hot', 'warm')
     ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(rowToEpisodic);
}

/** Most recent user turns for a session (newest first). Used by REL-01 query expansion. */
export async function getRecentUserMessages(sessionId: string, limit = 8): Promise<string[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT content FROM brain_episodic
     WHERE session_id = ? AND role = 'user'
     ORDER BY created_at DESC LIMIT ?`,
    [sessionId, limit],
  );
  return rows.map((r: { content: string }) => r.content);
}

export async function estimateSessionTokens(sessionId: string): Promise<number> {
  const db = await get();
  const row = await db.get(
    `SELECT COALESCE(SUM(CASE WHEN token_count > 0 THEN token_count
         ELSE CAST(LENGTH(content) / 4 AS INTEGER) END), 0) AS tokens
     FROM brain_episodic WHERE session_id = ?`,
    [sessionId],
  );
  return (row as any)?.tokens ?? 0;
}

/** Above this many rows `searchEpisodic` takes candidates from FTS5 instead of a LIKE scan. */
const EPISODIC_LIKE_SCAN_MAX_ROWS = 5000;

export async function searchEpisodic(query: string, sessionId?: string, limit: number = 20): Promise<EpisodicMemory[]> {
  const db = await get();

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const conditions: string[] = [];
  const params: any[] = [];

  if (sessionId) {
    conditions.push("session_id = ?");
    params.push(sessionId);
  }

  if (terms.length > 0) {
    const termConditions = terms.map(() => "LOWER(content) LIKE ?");
    conditions.push(`(${termConditions.join(" OR ")})`);
    for (const term of terms) {
      params.push(`%${term}%`);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const fetchLimit = Math.max(limit * 3, 30);
  params.push(fetchLimit);

  let ftsHits: any[] | null = null;

  // Big brains: a substring LIKE reads every episodic row. Take the candidates from FTS5 (BM25
  // order) instead; the LIKE scan stays for small tables and FTS-less builds.
  const ftsTerms = terms.map((t) => t.replace(/[^\p{L}\p{N}_]/gu, "")).filter((t) => t.length > 1);
  if (ftsTerms.length > 0) {
    try {
      const total = await db.get(
        sessionId ? "SELECT COUNT(*) AS n FROM brain_episodic WHERE session_id = ?" : "SELECT COUNT(*) AS n FROM brain_episodic",
        sessionId ? [sessionId] : [],
      );
      if (((total as any)?.n ?? 0) > EPISODIC_LIKE_SCAN_MAX_ROWS) {
        const match = ftsTerms.map((t) => `"${t}"*`).join(" OR ");
        // The MATCH runs first, in a CTE: with a session filter SQLite otherwise walks the
        // session index and probes the FTS table once per episodic row (seconds at 10k rows).
        ftsHits = await db.all(
          `WITH hits AS (
             SELECT rowid AS id, bm25(brain_episodic_fts) AS rank FROM brain_episodic_fts
             WHERE brain_episodic_fts MATCH ? ORDER BY rank LIMIT ?
           )
           SELECT e.* FROM hits JOIN brain_episodic e ON e.id = hits.id
           ${sessionId ? "WHERE e.session_id = ?" : ""}
           ORDER BY hits.rank, e.importance_score DESC LIMIT ?`,
          sessionId
            ? [match, fetchLimit * 10, sessionId, fetchLimit]
            : [match, fetchLimit, fetchLimit],
        );
      }
    } catch {
      ftsHits = null; // FTS5 unavailable: LIKE scan below
    }
  }

  const rows: any[] = ftsHits ?? await db.all(
    `SELECT * FROM brain_episodic ${whereClause}
     ORDER BY importance_score DESC, created_at DESC LIMIT ?`,
    params,
  );

  // BM25-inspired re-ranking for episodic results
  if (terms.length > 0 && rows.length > 1) {
    const totalDocs = rows.length;
    const avgDocLen = rows.reduce((sum: number, r: any) => sum + r.content.length, 0) / totalDocs;
    const k1 = 1.5;
    const b = 0.75;

    const idf = new Map<string, number>();
    for (const term of terms) {
      let docsWithTerm = 0;
      for (const r of rows) {
        if ((r as any).content.toLowerCase().includes(term)) docsWithTerm++;
      }
      idf.set(term, Math.max(Math.log((totalDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1), 0));
    }

    const scored = rows.map((r: any) => {
      const doc = r.content.toLowerCase();
      const docLen = doc.length;
      let bm25Score = 0;

      for (const term of terms) {
        let tf = 0;
        let pos = 0;
        while ((pos = doc.indexOf(term, pos)) !== -1) { tf++; pos += term.length; }

        const termIdf = idf.get(term) ?? 0;
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
        bm25Score += termIdf * tfNorm;
      }

      const importanceBoost = r.importance_score * 0.2;
      return { row: r, score: bm25Score + importanceBoost };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => rowToEpisodic(s.row));
  }

  return rows.slice(0, limit).map(rowToEpisodic);
}
