/** Persist FSRS S / D updates. Retrieve paths must not call this (MEM-14). */

import { applyFsrsFromSource, type FsrsMemoryKind, type FsrsOutcome, type FsrsState } from "../Fsrs.js";
import { get } from "./connection.js";

export type { FsrsMemoryKind };

interface FsrsRow {
  stability: number | null;
  difficulty: number | null;
  category?: string | null;
  last_accessed_at?: string | null;
  created_at?: string | null;
}

function tableFor(kind: FsrsMemoryKind): "brain_semantic" | "brain_episodic" {
  return kind === "episodic" ? "brain_episodic" : "brain_semantic";
}

export async function getFsrsState(kind: FsrsMemoryKind, id: number): Promise<FsrsState | null> {
  const memId = Math.trunc(Number(id));
  if (!(memId > 0)) return null;
  const db = await get();
  const row = (await db.get(
    `SELECT stability, difficulty FROM ${tableFor(kind)} WHERE id = ?`,
    [memId],
  )) as { stability: number | null; difficulty: number | null } | undefined;
  if (!row) return null;
  const applied = applyFsrsFromSource(
    {
      stability: row.stability,
      difficulty: row.difficulty,
      category: kind === "episodic" ? "episodic" : undefined,
    },
    "unused",
  );
  return applied;
}

/**
 * Used+helpful / used+harmful write S (and D). Retrieved-not-used is a no-op.
 * Does not bump retrieval_count or leftover importance.
 */
export async function applyMemoryFsrs(
  kind: FsrsMemoryKind,
  id: number,
  outcome: FsrsOutcome,
  nowMs: number = Date.now(),
): Promise<FsrsState | null> {
  const memId = Math.trunc(Number(id));
  if (!(memId > 0)) return null;

  const db = await get();
  const table = tableFor(kind);
  const row = (await db.get(
    kind === "episodic"
      ? `SELECT stability, difficulty, created_at FROM ${table} WHERE id = ?`
      : `SELECT stability, difficulty, category, last_accessed_at, created_at FROM ${table} WHERE id = ?`,
    [memId],
  )) as FsrsRow | undefined;
  if (!row) return null;

  const next = applyFsrsFromSource(
    {
      stability: row.stability,
      difficulty: row.difficulty,
      category: kind === "episodic" ? "episodic" : row.category,
      last_accessed_at: row.last_accessed_at,
      created_at: row.created_at,
    },
    outcome,
    undefined,
    nowMs,
  );

  if (outcome === "unused") return next;

  await db.run(
    `UPDATE ${table} SET stability = ?, difficulty = ? WHERE id = ?`,
    [next.stability, next.difficulty, memId],
  );
  return next;
}
