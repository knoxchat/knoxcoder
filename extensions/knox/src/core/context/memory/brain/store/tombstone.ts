/**
 * MEM-04 / MEM-06 — one delete path for leaves.
 *
 * Archive = drop from default retrieve (`tier = 'frozen'`).
 * Tombstone = true-delete replacement (`tombstoned_at` + audit `tombstone`).
 * Age/retention never DELETEs. forget / TTL / privacy use this helper.
 * FTS stays until a privacy wipe hard-deletes the row (or the sqlite file).
 */

import { get } from "./connection.js";
import { auditLog } from "./runtime.js";

export type MemoryLeafKind = "semantic" | "episodic";

export const TOMBSTONE_REASON = {
  /** Leftover label. Age/sleep/five-tier no longer tombstone (MEM-15). */
  ageRetention: "age_retention",
  nremDecay: "nrem_decay",
  fiveTierRetention: "five_tier_retention",
  forget: "forget",
  ttl: "ttl",
  privacyWipe: "privacy_wipe",
} as const;

export const AUDIT_TOMBSTONE = "tombstone";
export const AUDIT_RESTORE_TOMBSTONE = "restore_tombstone";

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

/** Semantic rows tagged `pinned` are exempt from age/forget/TTL tombstone. */
export const SEMANTIC_NOT_PINNED_SQL =
  `id NOT IN (SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned')`;

/** Default retrieve: skip frozen (archive) and tombstoned (true-delete) rows. */
export function liveRetrieveSql(alias?: string): string {
  const col = alias ? `${alias}.` : "";
  return `(${col}tombstoned_at IS NULL AND ${col}tier != 'frozen')`;
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

/**
 * Soft-delete: keep the row, archive it (frozen), set tombstone columns, audit.
 * Pinned semantic rows are skipped unless `includePinned`. Already-tombstoned ids are no-ops.
 * Associations, tags, and FTS rows stay so forget is reversible.
 */
export async function tombstoneMemories(
  kind: MemoryLeafKind,
  ids: number[],
  reason: string,
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
    const placeholders = unique.map(() => "?").join(",");
    const pinned = await db.all(
      `SELECT memory_id FROM brain_tags
       WHERE memory_type = 'semantic' AND tag = 'pinned'
       AND memory_id IN (${placeholders})`,
      unique,
    );
    const pinnedIds = new Set(pinned.map((r: { memory_id: number }) => Number(r.memory_id)));
    candidates = unique.filter((id) => !pinnedIds.has(id));
    if (candidates.length === 0) return 0;
  }

  const placeholders = candidates.map(() => "?").join(",");
  const live = await db.all(
    `SELECT * FROM ${table} WHERE id IN (${placeholders}) AND tombstoned_at IS NULL`,
    candidates,
  );
  const fresh = live.map((r: { id: number }) => Number(r.id)).filter((id) => id > 0);
  if (fresh.length === 0) return 0;

  const freshPlaceholders = fresh.map(() => "?").join(",");
  await db.run(
    `UPDATE ${table}
     SET tombstoned_at = datetime('now'),
         tombstone_reason = ?,
         tier = 'frozen'
     WHERE id IN (${freshPlaceholders}) AND tombstoned_at IS NULL`,
    [reason, ...fresh],
  );

  if (auditEach) {
    const byId = new Map(live.map((r: { id: number }) => [Number(r.id), r]));
    for (const id of fresh) {
      await auditLog(AUDIT_TOMBSTONE, kind, id, {
        reason,
        via,
        record: byId.get(id) ?? null,
      });
    }
  }
  return fresh.length;
}

/** SELECT matching live rows and tombstone them. `whereSql` is internal SQL only. */
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
  );
  return tombstoneMemories(
    kind,
    rows.map((r: { id: number }) => Number(r.id)),
    reason,
    options,
  );
}

/** Expired TTL (`expires_at`) — dedicated MEM-06 path. Pinned stay. */
export async function forgetExpiredTtl(): Promise<number> {
  return tombstoneWhere(
    "semantic",
    `expires_at IS NOT NULL AND expires_at < datetime('now')`,
    [],
    TOMBSTONE_REASON.ttl,
    { via: "ttl" },
  );
}

/** Clear a tombstone so the leaf is live again. Used by undo of forget/TTL. */
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
    `SELECT id, tombstoned_at FROM ${table} WHERE id = ?`,
    [leafId],
  ) as { id: number; tombstoned_at: string | null } | undefined;
  if (!row || !isTombstonedRow(row)) return false;

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
  await auditLog(AUDIT_TOMBSTONE, "brain", null, {
    reason: TOMBSTONE_REASON.privacyWipe,
    via: "privacy",
    semantic,
    episodic,
  });
  return { semantic, episodic };
}
