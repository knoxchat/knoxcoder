/**
 * MEM-04 / MEM-72 — archive vs tombstone labels.
 *
 * Archive = reversible, out of default retrieve (`tier = 'frozen'`).
 * Forget / TTL / privacy = erasure (MEM-73): content-free tombstone, indexes
 * dropped, ack only after ancestor summaries regenerate.
 * Age/retention never DELETEs. FTS stays on archive; forget removes postings.
 */

import { get } from "./connection.js";
import { auditLog } from "./runtime.js";
import { collectBindChunks, forBindChunks, sqlPlaceholders } from "./sqlChunks.js";

export type MemoryLeafKind = "semantic" | "episodic";

export const TOMBSTONE_REASON = {
  /** Leftover label. Age/sleep/five-tier no longer tombstone (MEM-15). */
  ageRetention: "age_retention",
  nremDecay: "nrem_decay",
  fiveTierRetention: "five_tier_retention",
  forget: "forget",
  ttl: "ttl",
  privacyWipe: "privacy_wipe",
  archive: "archive",
} as const;

export const AUDIT_TOMBSTONE = "tombstone";
export const AUDIT_ARCHIVE = "archive";
export const AUDIT_FORGET = "forget";
export const AUDIT_RESTORE_TOMBSTONE = "restore_tombstone";
export const AUDIT_RESTORE_ARCHIVE = "restore_archive";

const TABLES: Record<MemoryLeafKind, "brain_semantic" | "brain_episodic"> = {
  semantic: "brain_semantic",
  episodic: "brain_episodic",
};

export type TombstoneOptions = {
  /** Privacy wipe includes pinned rows. Default false. */
  includePinned?: boolean;
  /** Audit `via` tag: archive | forget | ttl | privacy | undo_store. */
  via?: string;
  /** Per-id audit rows. Wipe sets false and writes one summary audit. */
  auditEach?: boolean;
};

/** Semantic rows tagged `pinned` are exempt from age/forget/TTL, not from wipe. */
export const SEMANTIC_NOT_PINNED_SQL =
  `id NOT IN (SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned')`;

/** Default retrieve: skip frozen (archive) and tombstoned (erased) rows. */
export function liveRetrieveSql(alias?: string): string {
  const col = alias ? `${alias}.` : "";
  return `(${col}tombstoned_at IS NULL AND ${col}tier != 'frozen')`;
}

/** Reachability / tree ingest: any non-erased leaf, including Frozen. */
export function notTombstonedSql(alias?: string): string {
  const col = alias ? `${alias}.` : "";
  return `${col}tombstoned_at IS NULL`;
}

export function isLiveRetrieveRow(row: {
  tombstoned_at?: string | null;
  tier?: string | null;
}): boolean {
  if (row.tombstoned_at != null && String(row.tombstoned_at).length > 0) return false;
  return row.tier !== "frozen";
}

export function isTombstonedRow(row: { tombstoned_at?: string | null } | null | undefined): boolean {
  return row != null && row.tombstoned_at != null && String(row.tombstoned_at).length > 0;
}

export function isArchivedRow(row: {
  tombstoned_at?: string | null;
  tier?: string | null;
} | null | undefined): boolean {
  if (!row || isTombstonedRow(row)) return false;
  return row.tier === "frozen";
}

export async function skipPinnedSemantic(ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids.map((id) => Math.trunc(Number(id))).filter((id) => id > 0))];
  if (unique.length === 0) return [];
  const db = await get();
  const pinned = await collectBindChunks(unique, 0, (chunk) =>
    db.all(
      `SELECT memory_id FROM brain_tags
       WHERE memory_type = 'semantic' AND tag = 'pinned'
       AND memory_id IN (${sqlPlaceholders(chunk.length)})`,
      chunk,
    ) as Promise<Array<{ memory_id: number }>>,
  );
  const pinnedIds = new Set(pinned.map((r) => Number(r.memory_id)));
  return unique.filter((id) => !pinnedIds.has(id));
}

/**
 * Reversible archive: drop from default retrieve, keep content and FTS until
 * the Frozen segment sync moves postings (MEM-75). Not a tombstone.
 */
export async function archiveMemories(
  kind: MemoryLeafKind,
  ids: number[],
  options: TombstoneOptions = {},
): Promise<number> {
  const unique = [...new Set(ids.map((id) => Math.trunc(Number(id))).filter((id) => id > 0))];
  if (unique.length === 0) return 0;

  const db = await get();
  const table = TABLES[kind];
  const via = options.via ?? "archive";
  const auditEach = options.auditEach !== false;

  let candidates = unique;
  if (kind === "semantic" && !options.includePinned) {
    candidates = await skipPinnedSemantic(unique);
    if (candidates.length === 0) return 0;
  }

  const live = await collectBindChunks(candidates, 0, (chunk) =>
    db.all(
      `SELECT * FROM ${table}
       WHERE id IN (${sqlPlaceholders(chunk.length)})
         AND tombstoned_at IS NULL
         AND tier != 'frozen'`,
      chunk,
    ),
  ) as Array<{ id: number; tier?: string | null }>;
  const fresh = live.map((r) => Number(r.id)).filter((id) => id > 0);
  if (fresh.length === 0) return 0;

  await forBindChunks(fresh, 0, async (chunk) => {
    await db.run(
      `UPDATE ${table}
       SET tier = 'frozen'
       WHERE id IN (${sqlPlaceholders(chunk.length)}) AND tombstoned_at IS NULL`,
      chunk,
    );
  });

  if (auditEach) {
    const byId = new Map(live.map((r) => [Number(r.id), r]));
    for (const id of fresh) {
      const record = byId.get(id);
      await auditLog(AUDIT_ARCHIVE, kind, id, {
        reason: TOMBSTONE_REASON.archive,
        via,
        previous_tier: record?.tier ?? null,
      });
    }
  }

  try {
    const { syncFrozenSegmentForIds } = await import("./frozenSegment.js");
    await syncFrozenSegmentForIds(kind, fresh);
  } catch {
    // Frozen segment is best-effort; archive already dropped default retrieve.
  }
  return fresh.length;
}

/** SELECT matching live (non-frozen, non-tombstoned) rows and archive them. */
export async function archiveWhere(
  kind: MemoryLeafKind,
  whereSql: string,
  params: unknown[],
  options: TombstoneOptions = {},
): Promise<number> {
  const db = await get();
  const table = TABLES[kind];
  const pinned = kind === "semantic" && !options.includePinned
    ? ` AND ${SEMANTIC_NOT_PINNED_SQL}`
    : "";
  const rows = await db.all(
    `SELECT id FROM ${table}
     WHERE (${whereSql}) AND tombstoned_at IS NULL AND tier != 'frozen'${pinned}`,
    params,
  ) as Array<{ id: number }>;
  return archiveMemories(
    kind,
    rows.map((r) => Number(r.id)),
    options,
  );
}

/** Clear an archive so the leaf is live again. Used by undo of archive. */
export async function restoreArchived(
  kind: MemoryLeafKind,
  id: number,
  previousTier?: string | null,
): Promise<boolean> {
  const leafId = Math.trunc(Number(id));
  if (leafId <= 0) return false;
  const db = await get();
  const table = TABLES[kind];
  const row = await db.get(
    `SELECT id, tombstoned_at, tier FROM ${table} WHERE id = ?`,
    [leafId],
  ) as { id: number; tombstoned_at: string | null; tier: string | null } | undefined;
  if (!row || isTombstonedRow(row) || row.tier !== "frozen") return false;

  const tier = previousTier && previousTier.length > 0 && previousTier !== "frozen"
    ? previousTier
    : kind === "semantic"
      ? "hot"
      : "warm";
  await db.run(
    `UPDATE ${table} SET tier = ? WHERE id = ? AND tombstoned_at IS NULL`,
    [tier, leafId],
  );
  await auditLog(AUDIT_RESTORE_ARCHIVE, kind, leafId, {
    previous_tier: previousTier ?? null,
  });
  try {
    const { thawFrozenSegmentForIds } = await import("./frozenSegment.js");
    await thawFrozenSegmentForIds(kind, [leafId]);
  } catch {
    // Live FTS trigger on UPDATE already re-indexed; thaw is a cleanup.
  }
  return true;
}

/**
 * Soft-delete name kept for leftover callers. Forget / TTL / privacy erase
 * (MEM-73). Archive is `archiveMemories`.
 */
export async function tombstoneMemories(
  kind: MemoryLeafKind,
  ids: number[],
  reason: string,
  options: TombstoneOptions = {},
): Promise<number> {
  const { eraseMemories } = await import("./erasure.js");
  return eraseMemories(kind, ids, reason, options);
}

/** SELECT matching live rows and erase them. `whereSql` is internal SQL only. */
export async function tombstoneWhere(
  kind: MemoryLeafKind,
  whereSql: string,
  params: unknown[],
  reason: string,
  options: TombstoneOptions = {},
): Promise<number> {
  const db = await get();
  const table = TABLES[kind];
  const pinned = kind === "semantic" && !options.includePinned
    ? ` AND ${SEMANTIC_NOT_PINNED_SQL}`
    : "";
  const rows = await db.all(
    `SELECT id FROM ${table} WHERE (${whereSql}) AND tombstoned_at IS NULL${pinned}`,
    params,
  ) as Array<{ id: number }>;
  const { eraseMemories } = await import("./erasure.js");
  return eraseMemories(
    kind,
    rows.map((r) => Number(r.id)),
    reason,
    options,
  );
}

/** Expired TTL (`expires_at`) — dedicated MEM-06 / MEM-73 path. Pinned stay. */
export async function forgetExpiredTtl(): Promise<number> {
  return tombstoneWhere(
    "semantic",
    `expires_at IS NOT NULL AND expires_at < datetime('now')`,
    [],
    TOMBSTONE_REASON.ttl,
    { via: "ttl" },
  );
}

/**
 * Clear a leftover content-bearing tombstone. After MEM-73, forget is
 * content-free and this is a no-op unless a legacy row still has text.
 */
export async function restoreTombstoned(
  kind: MemoryLeafKind,
  id: number,
  previousTier?: string | null,
): Promise<boolean> {
  const leafId = Math.trunc(Number(id));
  if (leafId <= 0) return false;
  const db = await get();
  const table = TABLES[kind];
  const row = await db.get(
    `SELECT id, tombstoned_at, title, content, keywords FROM ${table} WHERE id = ?`,
    [leafId],
  ) as {
    id: number;
    tombstoned_at: string | null;
    title?: string | null;
    content?: string | null;
    keywords?: string | null;
  } | undefined;
  if (!row || !isTombstonedRow(row)) return false;
  const hay = [row.title, row.content, row.keywords].filter(Boolean).join("");
  if (!hay.trim()) return false;

  const tier = previousTier && previousTier.length > 0
    ? previousTier
    : kind === "semantic"
      ? "hot"
      : "warm";
  await db.run(
    `UPDATE ${table}
     SET tombstoned_at = NULL,
         tombstone_reason = NULL,
         tier = ?
     WHERE id = ? AND tombstoned_at IS NOT NULL`,
    [tier, leafId],
  );
  await auditLog(AUDIT_RESTORE_TOMBSTONE, kind, leafId, {
    previous_tier: previousTier ?? null,
  });
  return true;
}

/** Mark every leaf deleted-by-policy before a privacy wipe hard-deletes the file. */
export async function tombstoneAllForPrivacyWipe(): Promise<{ semantic: number; episodic: number }> {
  const semantic = await tombstoneWhere(
    "semantic",
    "1=1",
    [],
    TOMBSTONE_REASON.privacyWipe,
    { includePinned: true, via: "privacy", auditEach: false },
  );
  const episodic = await tombstoneWhere(
    "episodic",
    "1=1",
    [],
    TOMBSTONE_REASON.privacyWipe,
    { via: "privacy", auditEach: false },
  );
  await auditLog(AUDIT_FORGET, "brain", null, {
    reason: TOMBSTONE_REASON.privacyWipe,
    via: "privacy",
    semantic,
    episodic,
  });
  return { semantic, episodic };
}
