/**
 * MC-51 outcome-aware recall and MC-52 contradiction handling.
 *
 * Both keep their state in small additive tables (`brain_memory_outcomes`,
 * `brain_memory_supersessions`) so memory rows and every dump/restore path stay unchanged.
 * Pure helpers are exported separately so they can be tested without a database.
 */
import type { DatabaseConnection } from "../../../util/refreshIndex.js";
import { outcomeFactor } from "./Ebbinghaus.js";

export type RecallOutcome = "verified" | "reverted";

export interface MemoryOutcome {
  verified: number;
  reverted: number;
}

// ── MC-51 ──────────────────────────────────────────────────────────────────

/**
 * Adjust a fusion score by outcome history. A penalty always applies; a boost only lifts a
 * candidate that already qualified (`score >= theta`), so outcomes can rank but not admit a miss.
 */
export function applyOutcomeWeight(score: number, outcome: MemoryOutcome | undefined, theta: number, pinned = false): number {
  if (!outcome) return score;
  const f = outcomeFactor(outcome.verified, outcome.reverted);
  if (f < 1) return pinned ? score : score * f;
  if (f > 1 && score >= theta) return score * f;
  return score;
}

/** MC-50: at least one verified turn and no reverts. */
export function isVerifiedByOutcome(outcome: MemoryOutcome | undefined): boolean {
  return !!outcome && outcome.verified > 0 && outcome.reverted === 0;
}

export async function recordRecallOutcome(db: DatabaseConnection, memoryIds: number[], outcome: RecallOutcome): Promise<void> {
  const col = outcome === "verified" ? "verified_count" : "revert_count";
  for (const id of new Set(memoryIds)) {
    await db.run(
      `INSERT INTO brain_memory_outcomes (memory_id, ${col}, updated_at) VALUES (?, 1, datetime('now'))
       ON CONFLICT(memory_id) DO UPDATE SET ${col} = ${col} + 1, updated_at = datetime('now')`,
      [id],
    );
  }
}

export async function loadOutcomes(db: DatabaseConnection, memoryIds: number[]): Promise<Map<number, MemoryOutcome>> {
  const out = new Map<number, MemoryOutcome>();
  const ids = [...new Set(memoryIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db.all<{ memory_id: number; verified_count: number; revert_count: number }[]>(
      `SELECT memory_id, verified_count, revert_count FROM brain_memory_outcomes
       WHERE memory_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of rows) out.set(r.memory_id, { verified: r.verified_count, reverted: r.revert_count });
  }
  return out;
}

// ── MC-52 ──────────────────────────────────────────────────────────────────

export const CONTRADICTION_CATEGORIES = new Set(["decision", "preference"]);
const SUBJECT_OVERLAP_MIN = 0.5;

export interface ContradictionCandidate {
  id: number;
  category: string;
  title: string;
  content: string;
  created_at?: string;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / (a.size + b.size - n);
}

/**
 * Same category (decision/preference), same subject (title overlap), different content.
 * Subject comes from the title only, so "Use tabs" vs "Use spaces" share a subject with the
 * shared words and differ in the rest.
 */
export function conflictsWith(next: ContradictionCandidate, older: ContradictionCandidate): boolean {
  if (next.id === older.id) return false;
  if (!CONTRADICTION_CATEGORIES.has(next.category) || next.category !== older.category) return false;
  if (next.content.trim().toLowerCase() === older.content.trim().toLowerCase()) return false;
  const subject = jaccard(tokens(next.title), tokens(older.title));
  const titleSame = next.title.trim().toLowerCase() === older.title.trim().toLowerCase();
  return titleSame || subject >= SUBJECT_OVERLAP_MIN;
}

export function findSuperseded(next: ContradictionCandidate, older: ContradictionCandidate[]): ContradictionCandidate[] {
  return older.filter((o) => conflictsWith(next, o));
}

export function supersessionNote(newer: Pick<ContradictionCandidate, "title">, older: Pick<ContradictionCandidate, "content">): string {
  return `Updated: "${newer.title}" replaces an earlier note (was: ${older.content.replace(/\s+/g, " ").trim().slice(0, 120)}).`;
}

/** Mark `oldId` superseded by `newId`. History stays in `brain_semantic`; recall skips old rows. */
export async function markSuperseded(db: DatabaseConnection, oldId: number, newId: number, reason: string): Promise<void> {
  if (oldId === newId) return;
  await db.run(
    `INSERT INTO brain_memory_supersessions (old_id, new_id, reason) VALUES (?, ?, ?)
     ON CONFLICT(old_id) DO UPDATE SET new_id = excluded.new_id, reason = excluded.reason`,
    [oldId, newId, reason],
  );
}

export async function loadSupersededIds(db: DatabaseConnection, ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const rows = await db.all<{ old_id: number }[]>(
      `SELECT old_id FROM brain_memory_supersessions WHERE old_id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
    for (const r of rows) out.add(r.old_id);
  }
  return out;
}

/** Explains why `newId` is current: the notes for everything it replaced. */
export async function explainSupersession(db: DatabaseConnection, newId: number): Promise<string[]> {
  const rows = await db.all<{ reason: string; content: string; title: string }[]>(
    `SELECT s.reason AS reason, o.content AS content, n.title AS title
       FROM brain_memory_supersessions s
       JOIN brain_semantic o ON o.id = s.old_id
       JOIN brain_semantic n ON n.id = s.new_id
      WHERE s.new_id = ? ORDER BY s.created_at, s.old_id`,
    [newId],
  );
  return rows.map((r) => r.reason || supersessionNote({ title: r.title }, { content: r.content }));
}

/**
 * After storing `next`: supersede conflicting older decision/preference memories in the same
 * source session scope. Returns the superseded ids.
 */
export async function supersedeConflicts(db: DatabaseConnection, next: ContradictionCandidate): Promise<number[]> {
  if (!CONTRADICTION_CATEGORIES.has(next.category)) return [];
  const rows = await db.all<ContradictionCandidate[]>(
    `SELECT id, category, title, content, created_at FROM brain_semantic
      WHERE category = ? AND id != ?
        AND id NOT IN (SELECT old_id FROM brain_memory_supersessions)`,
    [next.category, next.id],
  );
  const hit = findSuperseded(next, rows.filter((r) => !r.created_at || !next.created_at || r.created_at <= next.created_at));
  for (const o of hit) await markSuperseded(db, o.id, next.id, supersessionNote(next, o));
  return hit.map((o) => o.id);
}
