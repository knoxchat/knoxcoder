/**
 * MEM-49 / MEM-51 / MEM-52 — pure pieces of φ₄ consolidation.
 *
 *   φ₄(m) ∈ { ADD, UPDATE, SUPERSEDE, MERGE, NOOP }
 *
 * - `contentHash`: idempotency key within a scope (MEM-51).
 * - `withScopeLock`: serializes reconcile + insert + tree link per scope (MEM-52).
 *
 * The database half (`reconcileSemantic`) lives in `store/semantic.ts`.
 */

import crypto from "crypto";

import type { DatabaseConnection } from "../../../util/refreshIndex.js";

export type ReconcileAction = "ADD" | "UPDATE" | "SUPERSEDE" | "MERGE" | "NOOP";

export interface ReconcileVerdict {
  action: ReconcileAction;
  /** Existing row the verdict acts on (NOOP / UPDATE / MERGE / SUPERSEDE). */
  targetId?: number;
  reason: string;
  /** True when the trust order (MEM-48) stopped a supersede / merge. */
  trustBlocked?: boolean;
}

/** Lowercase, collapse whitespace. Case and spacing never make a new fact. */
export function normalizeForHash(text: string): string {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Key = hash(category, normalized content). Scope is a separate column. */
export function contentHash(category: string, content: string): string {
  return crypto
    .createHash("sha256")
    .update(`${category}\n${normalizeForHash(content)}`)
    .digest("hex")
    .slice(0, 32);
}

/** Scope of a write = the session's project (`brain_sessions.project_id`). '' when unknown. */
export async function scopeKeyForSession(
  db: DatabaseConnection,
  sessionId?: string | null,
): Promise<string> {
  if (!sessionId) return "";
  try {
    const row = await db.get<{ project_id: string | null }>(
      "SELECT project_id FROM brain_sessions WHERE id = ?",
      [sessionId],
    );
    return row?.project_id ?? "";
  } catch {
    return "";
  }
}

// ── Per-scope serialization ────────────────────────────────────────────────

const tails = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after every earlier call for the same scope key has settled.
 * Process-local: the brain is one sqlite file owned by one process.
 * A failure in one call never blocks the next.
 */
export function withScopeLock<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
  const key = scopeKey || "";
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** Test hook: number of scopes with work queued. */
export function pendingScopeLocks(): number {
  return tails.size;
}
