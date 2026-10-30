/** Persist R/Value tiers. Sleep and attribution call this; clocks do not (MEM-15). */

import {
  type ClassifyTierOptions,
  type WorkingMemoryLeafRef,
  type WorkingMemoryTierItem,
  TIER_RANK,
  classifyMemoryTier,
  isActiveMemory,
  isMemoryTier,
  memoryRefKey,
  workingMemoryActiveKeys,
} from "../Tiers.js";
import type { MemoryTier } from "../types.js";
import { get } from "./connection.js";
import { decompressContent } from "./compression.js";

export type MemoryLeafKind = "semantic" | "episodic";

export interface RecomputeTiersOptions {
  /** WM leaves treated as Active. Omit to read the current session WM. */
  active?: Iterable<WorkingMemoryLeafRef | WorkingMemoryTierItem>;
  nowMs?: number;
}

export interface RecomputeTiersResult {
  promoted: number;
  demoted: number;
  unchanged: number;
  active: number;
  frozen: number;
}

interface TierRow {
  id: number;
  tier: string | null;
  importance_score?: number | null;
  i0?: number | null;
  helpful_count?: number | null;
  unhelpful_count?: number | null;
  stability?: number | null;
  category?: string | null;
  last_accessed_at?: string | null;
  created_at?: string | null;
}

const TABLES: Record<MemoryLeafKind, "brain_semantic" | "brain_episodic"> = {
  semantic: "brain_semantic",
  episodic: "brain_episodic",
};

const SEMANTIC_SELECT = `id, tier, importance_score, i0, helpful_count, unhelpful_count,
  stability, category, last_accessed_at, created_at`;
const EPISODIC_SELECT = `id, tier, importance_score, i0, helpful_count, unhelpful_count,
  stability, created_at`;

function emptyResult(): RecomputeTiersResult {
  return { promoted: 0, demoted: 0, unchanged: 0, active: 0, frozen: 0 };
}

function recordChange(result: RecomputeTiersResult, from: MemoryTier, to: MemoryTier): void {
  if (to === "active") result.active++;
  if (to === "frozen") result.frozen++;
  if (to === from) {
    result.unchanged++;
    return;
  }
  if (TIER_RANK[to] > TIER_RANK[from]) {
    result.promoted++;
    return;
  }
  result.demoted++;
}

function asActiveSet(
  active?: Iterable<WorkingMemoryLeafRef | WorkingMemoryTierItem>,
): Set<string> | null {
  if (!active) return null;
  const keys = new Set<string>();
  for (const item of active) {
    if ("kind" in item && "id" in item && (item.kind === "semantic" || item.kind === "episodic")) {
      const id = Math.trunc(Number(item.id));
      if (id > 0) keys.add(memoryRefKey(item.kind, id));
      continue;
    }
    for (const key of workingMemoryActiveKeys([item as WorkingMemoryTierItem])) keys.add(key);
  }
  return keys;
}

async function loadWorkingMemoryItems(): Promise<WorkingMemoryTierItem[]> {
  try {
    const { BrainManager } = await import("../BrainManager.js");
    return BrainManager.getWorkingMemory().getAll();
  } catch {
    return [];
  }
}

async function resolveActiveKeys(
  active?: Iterable<WorkingMemoryLeafRef | WorkingMemoryTierItem>,
): Promise<Set<string>> {
  const explicit = asActiveSet(active);
  if (explicit) return explicit;
  return workingMemoryActiveKeys(await loadWorkingMemoryItems());
}

async function loadPinnedSemanticIds(): Promise<Set<number>> {
  const db = await get();
  const rows = await db.all(
    `SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned'`,
  );
  return new Set(rows.map((r: { memory_id: number }) => Number(r.memory_id)).filter((id) => id > 0));
}

function classifyRow(
  kind: MemoryLeafKind,
  row: TierRow,
  active: ReadonlySet<string>,
  pinned: ReadonlySet<number>,
  nowMs: number,
): MemoryTier {
  const options: ClassifyTierOptions = {
    inWorkingMemory: isActiveMemory(kind, row.id, active),
    pinned: kind === "semantic" && pinned.has(row.id),
  };
  return classifyMemoryTier(
    {
      importance_score: row.importance_score,
      i0: row.i0,
      helpful_count: row.helpful_count,
      unhelpful_count: row.unhelpful_count,
      stability: row.stability,
      category: kind === "episodic" ? "episodic" : row.category,
      last_accessed_at: row.last_accessed_at,
      created_at: row.created_at,
    },
    options,
    undefined,
    nowMs,
  );
}

async function applyTierUpdates(
  kind: MemoryLeafKind,
  updates: Map<MemoryTier, number[]>,
): Promise<void> {
  const db = await get();
  const table = TABLES[kind];
  for (const [tier, ids] of updates) {
    if (ids.length === 0) continue;
    const placeholders = ids.map(() => "?").join(",");
    await db.run(
      `UPDATE ${table} SET tier = ? WHERE id IN (${placeholders}) AND tombstoned_at IS NULL`,
      [tier, ...ids],
    );
  }
}

/**
 * Re-read live leaves and write the R/Value (or WM-active) tier.
 * Tombstones stay Deleted. Age clocks are not consulted.
 */
export async function recomputeMemoryTiers(
  options: RecomputeTiersOptions = {},
): Promise<RecomputeTiersResult> {
  const db = await get();
  const nowMs = options.nowMs ?? Date.now();
  const active = await resolveActiveKeys(options.active);
  const pinned = await loadPinnedSemanticIds();
  const result = emptyResult();

  const semanticRows = (await db.all(
    `SELECT ${SEMANTIC_SELECT} FROM brain_semantic WHERE tombstoned_at IS NULL`,
  )) as TierRow[];
  const episodicRows = (await db.all(
    `SELECT ${EPISODIC_SELECT} FROM brain_episodic WHERE tombstoned_at IS NULL`,
  )) as TierRow[];

  const semUpdates = new Map<MemoryTier, number[]>();
  const epiUpdates = new Map<MemoryTier, number[]>();

  for (const row of semanticRows) {
    const from = isMemoryTier(row.tier) ? row.tier : "hot";
    const to = classifyRow("semantic", row, active, pinned, nowMs);
    recordChange(result, from, to);
    if (to !== row.tier) {
      const list = semUpdates.get(to) ?? [];
      list.push(row.id);
      semUpdates.set(to, list);
    }
  }
  for (const row of episodicRows) {
    const from = isMemoryTier(row.tier) ? row.tier : "hot";
    const to = classifyRow("episodic", row, active, pinned, nowMs);
    recordChange(result, from, to);
    if (to !== row.tier) {
      const list = epiUpdates.get(to) ?? [];
      list.push(row.id);
      epiUpdates.set(to, list);
    }
  }

  await applyTierUpdates("semantic", semUpdates);
  await applyTierUpdates("episodic", epiUpdates);
  return result;
}

/** Single-leaf write used by attribution (MEM-17). Tombstoned rows are left alone. */
export async function applyMemoryTier(
  kind: MemoryLeafKind,
  id: number,
  options: RecomputeTiersOptions & ClassifyTierOptions = {},
): Promise<MemoryTier | null> {
  const memId = Math.trunc(Number(id));
  if (!(memId > 0)) return null;
  const db = await get();
  const table = TABLES[kind];
  const select = kind === "semantic" ? SEMANTIC_SELECT : EPISODIC_SELECT;
  const row = (await db.get(
    `SELECT ${select} FROM ${table} WHERE id = ?`,
    [memId],
  )) as TierRow | undefined;
  if (!row) return null;

  const tombstoned = await db.get(
    `SELECT tombstoned_at FROM ${table} WHERE id = ?`,
    [memId],
  ) as { tombstoned_at: string | null } | undefined;
  if (tombstoned?.tombstoned_at) return "frozen";

  const active = await resolveActiveKeys(options.active);
  if (options.inWorkingMemory) active.add(memoryRefKey(kind, memId));
  const pinned = kind === "semantic" ? await loadPinnedSemanticIds() : new Set<number>();
  if (options.pinned) pinned.add(memId);
  const next = classifyRow(kind, row, active, pinned, options.nowMs ?? Date.now());
  if (next !== row.tier) {
    await db.run(
      `UPDATE ${table} SET tier = ? WHERE id = ? AND tombstoned_at IS NULL`,
      [next, memId],
    );
  }
  return next;
}

/** Undo leftover `z:` encoding on live (active/hot) rows after a promotion. */
export async function decompressLiveTiers(): Promise<number> {
  const db = await get();
  let changed = 0;
  for (const table of ["brain_semantic", "brain_episodic"] as const) {
    const rows = await db.all(
      `SELECT id, content FROM ${table}
       WHERE tier IN ('active', 'hot') AND content LIKE 'z:%' AND tombstoned_at IS NULL`,
    );
    for (const row of rows) {
      const r = row as { id: number; content: string };
      const decompressed = decompressContent(r.content);
      if (decompressed !== r.content) {
        await db.run(`UPDATE ${table} SET content = ? WHERE id = ?`, [decompressed, r.id]);
        changed++;
      }
    }
  }
  return changed;
}
