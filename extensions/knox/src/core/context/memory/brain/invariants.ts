/**
 * MEM-32 / MEM-54 — cycle invariants: Budget, Reachability, Losslessness, Freshness.
 * (Erasure lands with MEM-73.)
 *
 * Replaces “a phase ran in the last hour” as `cycle_invariant_met`.
 *
 *   Budget:        |C(q)| + W_out ≤ W on every buildContext. Over-budget
 *                  fails open to empty memory and writes an audit row.
 *   Reachability:  every non-tombstoned semantic/episodic id is in at least
 *                  one of FTS, ripgrep corpus, graph, or the summary tree.
 *   Losslessness:  every summary-tree leaf is an original row or a tombstone.
 *   Freshness:     a memory written in turn t is retrievable from turn t+1
 *                  (read-your-writes). φ₂ (FTS), φ₄ (row) and φ₅ (tree + term
 *                  sketches) run on the write path; only summary text and refits
 *                  are deferred.
 *
 * Sleep and heal run the store checks. Budget is recorded on each assemble.
 * The snapshot is process-local so `getPhaseStatus` stays synchronous.
 */

import type { BuildContextResult } from "./types.js";
import { get } from "./store/connection.js";
import { auditLog } from "./store/runtime.js";
import { collectBindChunks, sqlPlaceholders } from "./store/sqlChunks.js";
import { findStaleSketches, type StaleSketch } from "./store/treeSketches.js";
import type { DatabaseConnection } from "../../../util/refreshIndex.js";

export const AUDIT_BUDGET = "invariant:budget";
export const AUDIT_REACHABILITY = "invariant:reachability";
export const AUDIT_LOSSLESSNESS = "invariant:losslessness";
export const AUDIT_FRESHNESS = "invariant:freshness";

/** Most recent leaves probed per freshness check. */
export const FRESHNESS_PROBE_LIMIT = 50;

export const MISSING_REPORT_CAP = 50;

export type MemoryLeafKind = "semantic" | "episodic";

export interface BudgetInvariantResult {
  met: boolean;
  checked: boolean;
  c_use: number;
  w: number;
  w_out: number;
  at: number;
}

export interface ReachabilityGap {
  type: MemoryLeafKind;
  id: number;
}

export interface ReachabilityInvariantResult {
  met: boolean;
  checked: boolean;
  live: number;
  missing: number;
  missing_fts: number;
  via_fts: number;
  via_ripgrep: number;
  via_graph: number;
  via_tree: number;
  missing_ids: ReachabilityGap[];
  at: number;
}

export interface LosslessnessGap {
  tree_id: number;
  leaf_type: string | null;
  leaf_id: string | null;
}

export interface LosslessnessInvariantResult {
  met: boolean;
  checked: boolean;
  leaves: number;
  dangling: number;
  dangling_ids: LosslessnessGap[];
  at: number;
}

export interface FreshnessGap {
  type: MemoryLeafKind | "tree_sketch";
  id: number;
  reason: "not_in_fts" | StaleSketch["reason"];
}

export interface FreshnessInvariantResult {
  met: boolean;
  checked: boolean;
  /** Recent rows probed in the lexical index. */
  probed: number;
  not_in_fts: number;
  /** Recent tree leaves whose ancestor sketches were probed. */
  sketches_probed: number;
  stale_sketches: number;
  stale_ids: FreshnessGap[];
  at: number;
}

export interface StoreInvariantReport {
  reachability: ReachabilityInvariantResult;
  losslessness: LosslessnessInvariantResult;
  freshness: FreshnessInvariantResult;
  met: boolean;
  at: number;
}

export interface CycleInvariantSnapshot {
  budget: BudgetInvariantResult;
  reachability: ReachabilityInvariantResult;
  losslessness: LosslessnessInvariantResult;
  freshness: FreshnessInvariantResult;
  met: boolean;
}

const emptyFreshness = (): FreshnessInvariantResult => ({
  met: true,
  checked: false,
  probed: 0,
  not_in_fts: 0,
  sketches_probed: 0,
  stale_sketches: 0,
  stale_ids: [],
  at: 0,
});

const emptyBudget = (): BudgetInvariantResult => ({
  met: true,
  checked: false,
  c_use: 0,
  w: 0,
  w_out: 0,
  at: 0,
});

const emptyReachability = (): ReachabilityInvariantResult => ({
  met: true,
  checked: false,
  live: 0,
  missing: 0,
  missing_fts: 0,
  via_fts: 0,
  via_graph: 0,
  via_ripgrep: 0,
  via_tree: 0,
  missing_ids: [],
  at: 0,
});

const emptyLosslessness = (): LosslessnessInvariantResult => ({
  met: true,
  checked: false,
  leaves: 0,
  dangling: 0,
  dangling_ids: [],
  at: 0,
});

function snapshotFrom(
  budget: BudgetInvariantResult,
  reachability: ReachabilityInvariantResult,
  losslessness: LosslessnessInvariantResult,
  freshness: FreshnessInvariantResult = emptyFreshness(),
): CycleInvariantSnapshot {
  return {
    budget,
    reachability,
    losslessness,
    freshness,
    met: budget.met && reachability.met && losslessness.met && freshness.met,
  };
}

let lastSnapshot = snapshotFrom(emptyBudget(), emptyReachability(), emptyLosslessness());

export function getInvariantSnapshot(): CycleInvariantSnapshot {
  return {
    budget: { ...lastSnapshot.budget },
    reachability: {
      ...lastSnapshot.reachability,
      missing_ids: lastSnapshot.reachability.missing_ids.slice(),
    },
    losslessness: {
      ...lastSnapshot.losslessness,
      dangling_ids: lastSnapshot.losslessness.dangling_ids.slice(),
    },
    freshness: {
      ...lastSnapshot.freshness,
      stale_ids: lastSnapshot.freshness.stale_ids.slice(),
    },
    met: lastSnapshot.met,
  };
}

export function cycleInvariantsMet(snap: CycleInvariantSnapshot = lastSnapshot): boolean {
  return snap.budget.met && snap.reachability.met && snap.losslessness.met && snap.freshness.met;
}

export function resetInvariantSnapshotForTests(): void {
  lastSnapshot = snapshotFrom(emptyBudget(), emptyReachability(), emptyLosslessness());
}

function finiteInt(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.floor(value);
}

/** |C(q)| + W_out ≤ W (rev 21 / MEM-70). Missing window is 0 (only empty inject is safe). */
export function evaluateBudget(cUse: number, w: number, wOut = 0): BudgetInvariantResult {
  const use = Math.max(0, finiteInt(cUse));
  const window = Math.max(0, finiteInt(w));
  const out = Math.max(0, finiteInt(wOut));
  return {
    met: use + out <= window,
    checked: true,
    c_use: use,
    w: window,
    w_out: out,
    at: Date.now(),
  };
}

export function recordBudgetInvariant(budget: BudgetInvariantResult): void {
  lastSnapshot = snapshotFrom(budget, lastSnapshot.reachability, lastSnapshot.losslessness, lastSnapshot.freshness);
}

/**
 * After assemble: if |C(q)| + W_out > W, fail open to empty memory and audit.
 * `tokens` should be the same estimator the builder used for C_use.
 */
export async function applyBudgetInvariant(
  result: BuildContextResult,
  options: { sessionId?: string; tokens?: number } = {},
): Promise<BuildContextResult> {
  const w = result.w != null && Number.isFinite(result.w) ? Math.floor(result.w) : 0;
  const wOut = result.w_out != null && Number.isFinite(result.w_out) ? Math.floor(result.w_out) : 0;
  const tokens = options.tokens ?? Math.ceil((result.context ?? "").length / 4);
  const budget = evaluateBudget(tokens, w, wOut);
  recordBudgetInvariant(budget);
  if (budget.met) {
    return { ...result, c_use: budget.c_use, budget_invariant_met: true };
  }
  await auditLog(AUDIT_BUDGET, "pipeline", options.sessionId ?? null, {
    c_use: budget.c_use,
    w: budget.w,
    w_out: budget.w_out,
    met: false,
  });
  return {
    ...result,
    context: "",
    items: [],
    c_use: 0,
    budget_invariant_met: false,
    memory_tokens_saved: (result.memory_tokens_saved ?? 0) + budget.c_use,
  };
}

function searchableHaystack(row: { title?: string | null; content?: string | null; keywords?: string | null }): string {
  return [row.title, row.content, row.keywords].filter(Boolean).join("\n");
}

function inRipgrepCorpus(haystack: string): boolean {
  return haystack.trim().length > 0;
}

/**
 * Rowids actually present in the FTS index.
 * `SELECT rowid FROM <fts>` on a content= table reads the content table,
 * so an unindexed leaf would look indexed. `*_docsize` is the index.
 */
async function loadFtsIds(db: DatabaseConnection, table: "brain_semantic_fts" | "brain_episodic_fts"): Promise<Set<number>> {
  try {
    const rows = (await db.all(`SELECT id FROM ${table}_docsize`)) as Array<{ id: number }>;
    return new Set(rows.map((r) => Number(r.id)).filter((id) => id > 0));
  } catch {
    try {
      const rows = (await db.all(`SELECT rowid AS id FROM ${table}`)) as Array<{ id: number }>;
      return new Set(rows.map((r) => Number(r.id)).filter((id) => id > 0));
    } catch {
      return new Set();
    }
  }
}

async function loadTreeLeafIds(db: DatabaseConnection): Promise<{ semantic: Set<number>; episodic: Set<number> }> {
  const semantic = new Set<number>();
  const episodic = new Set<number>();
  const rows = (await db.all(
    `SELECT leaf_type, leaf_id FROM brain_summary_tree WHERE kind = 'leaf'`,
  )) as Array<{ leaf_type: string | null; leaf_id: string | null }>;
  for (const row of rows) {
    const id = Math.trunc(Number(row.leaf_id));
    if (!Number.isFinite(id) || id <= 0) continue;
    if (row.leaf_type === "semantic") semantic.add(id);
    else if (row.leaf_type === "episodic") episodic.add(id);
  }
  return { semantic, episodic };
}

async function loadAssociatedIds(db: DatabaseConnection): Promise<{ semantic: Set<number>; episodic: Set<number> }> {
  const semantic = new Set<number>();
  const episodic = new Set<number>();
  const rows = (await db.all(
    `SELECT source_type, source_id, target_type, target_id FROM brain_associations`,
  )) as Array<{
    source_type: string;
    source_id: number;
    target_type: string;
    target_id: number;
  }>;
  const add = (type: string, id: number) => {
    const n = Math.trunc(Number(id));
    if (!Number.isFinite(n) || n <= 0) return;
    if (type === "semantic") semantic.add(n);
    else if (type === "episodic") episodic.add(n);
  };
  for (const row of rows) {
    add(row.source_type, row.source_id);
    add(row.target_type, row.target_id);
  }
  return { semantic, episodic };
}

async function loadEntityNames(db: DatabaseConnection): Promise<string[]> {
  const rows = (await db.all(
    `SELECT name FROM brain_entities WHERE name IS NOT NULL AND length(trim(name)) >= 2`,
  )) as Array<{ name: string }>;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = String(row.name ?? "").trim().toLowerCase();
    if (name.length < 2 || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function mentionsEntity(haystack: string, names: readonly string[]): boolean {
  if (!haystack || names.length === 0) return false;
  const lower = haystack.toLowerCase();
  return names.some((name) => lower.includes(name));
}

export async function checkReachability(
  options: { db?: DatabaseConnection; audit?: boolean } = {},
): Promise<ReachabilityInvariantResult> {
  const db = options.db ?? (await get());
  const liveSemantic = (await db.all(
    `SELECT id, title, content, keywords FROM brain_semantic WHERE tombstoned_at IS NULL`,
  )) as Array<{ id: number; title?: string | null; content?: string | null; keywords?: string | null }>;
  const liveEpisodic = (await db.all(
    `SELECT id, content FROM brain_episodic WHERE tombstoned_at IS NULL`,
  )) as Array<{ id: number; content?: string | null }>;

  const ftsSemantic = await loadFtsIds(db, "brain_semantic_fts");
  const ftsEpisodic = await loadFtsIds(db, "brain_episodic_fts");
  const tree = await loadTreeLeafIds(db);
  const associated = await loadAssociatedIds(db);
  const entityNames = await loadEntityNames(db);

  let viaFts = 0;
  let viaRipgrep = 0;
  let viaGraph = 0;
  let viaTree = 0;
  let missingFts = 0;
  let missingCount = 0;
  const missingIds: ReachabilityGap[] = [];

  const visit = (
    type: MemoryLeafKind,
    id: number,
    haystack: string,
    fts: Set<number>,
    treeIds: Set<number>,
    assocIds: Set<number>,
  ) => {
    const inFts = fts.has(id);
    const inRipgrep = inRipgrepCorpus(haystack);
    const inTree = treeIds.has(id);
    const inGraph = assocIds.has(id) || mentionsEntity(haystack, entityNames);
    if (inFts) viaFts++;
    else missingFts++;
    if (inRipgrep) viaRipgrep++;
    if (inGraph) viaGraph++;
    if (inTree) viaTree++;
    if (inFts || inRipgrep || inGraph || inTree) return;
    missingCount++;
    if (missingIds.length < MISSING_REPORT_CAP) missingIds.push({ type, id });
  };

  for (const row of liveSemantic) {
    visit(
      "semantic",
      Number(row.id),
      searchableHaystack(row),
      ftsSemantic,
      tree.semantic,
      associated.semantic,
    );
  }
  for (const row of liveEpisodic) {
    visit(
      "episodic",
      Number(row.id),
      searchableHaystack(row),
      ftsEpisodic,
      tree.episodic,
      associated.episodic,
    );
  }

  const result: ReachabilityInvariantResult = {
    met: missingCount === 0,
    checked: true,
    live: liveSemantic.length + liveEpisodic.length,
    missing: missingCount,
    missing_fts: missingFts,
    via_fts: viaFts,
    via_ripgrep: viaRipgrep,
    via_graph: viaGraph,
    via_tree: viaTree,
    missing_ids: missingIds,
    at: Date.now(),
  };

  lastSnapshot = snapshotFrom(lastSnapshot.budget, result, lastSnapshot.losslessness, lastSnapshot.freshness);
  if (options.audit) {
    await auditLog(AUDIT_REACHABILITY, "pipeline", null, {
      met: result.met,
      live: result.live,
      missing: result.missing,
      missing_fts: result.missing_fts,
      via_fts: result.via_fts,
      via_ripgrep: result.via_ripgrep,
      via_graph: result.via_graph,
      via_tree: result.via_tree,
      missing_ids: result.missing_ids,
    });
  }
  return result;
}

export async function checkLosslessness(
  options: { db?: DatabaseConnection; audit?: boolean } = {},
): Promise<LosslessnessInvariantResult> {
  const db = options.db ?? (await get());
  const leaves = (await db.all(
    `SELECT id, leaf_type, leaf_id FROM brain_summary_tree WHERE kind = 'leaf'`,
  )) as Array<{ id: number; leaf_type: string | null; leaf_id: string | null }>;

  const semanticIds = new Set<number>();
  const episodicIds = new Set<number>();
  for (const leaf of leaves) {
    const id = Math.trunc(Number(leaf.leaf_id));
    if (!Number.isFinite(id) || id <= 0) continue;
    if (leaf.leaf_type === "semantic") semanticIds.add(id);
    else if (leaf.leaf_type === "episodic") episodicIds.add(id);
  }

  const existingSemantic = new Set<number>();
  const existingEpisodic = new Set<number>();
  if (semanticIds.size > 0) {
    const rows = await collectBindChunks([...semanticIds], 0, (chunk) =>
      db.all(
        `SELECT id FROM brain_semantic WHERE id IN (${sqlPlaceholders(chunk.length)})`,
        chunk,
      ) as Promise<Array<{ id: number }>>,
    );
    for (const row of rows) existingSemantic.add(Number(row.id));
  }
  if (episodicIds.size > 0) {
    const rows = await collectBindChunks([...episodicIds], 0, (chunk) =>
      db.all(
        `SELECT id FROM brain_episodic WHERE id IN (${sqlPlaceholders(chunk.length)})`,
        chunk,
      ) as Promise<Array<{ id: number }>>,
    );
    for (const row of rows) existingEpisodic.add(Number(row.id));
  }

  const danglingIds: LosslessnessGap[] = [];
  for (const leaf of leaves) {
    const leafId = Math.trunc(Number(leaf.leaf_id));
    const ok =
      Number.isFinite(leafId) &&
      leafId > 0 &&
      ((leaf.leaf_type === "semantic" && existingSemantic.has(leafId)) ||
        (leaf.leaf_type === "episodic" && existingEpisodic.has(leafId)));
    if (!ok && danglingIds.length < MISSING_REPORT_CAP) {
      danglingIds.push({
        tree_id: Number(leaf.id),
        leaf_type: leaf.leaf_type ?? null,
        leaf_id: leaf.leaf_id ?? null,
      });
    }
  }

  const dangling = leaves.filter((leaf) => {
    const leafId = Math.trunc(Number(leaf.leaf_id));
    if (!Number.isFinite(leafId) || leafId <= 0) return true;
    if (leaf.leaf_type === "semantic") return !existingSemantic.has(leafId);
    if (leaf.leaf_type === "episodic") return !existingEpisodic.has(leafId);
    return true;
  }).length;

  const result: LosslessnessInvariantResult = {
    met: dangling === 0,
    checked: true,
    leaves: leaves.length,
    dangling,
    dangling_ids: danglingIds,
    at: Date.now(),
  };

  lastSnapshot = snapshotFrom(lastSnapshot.budget, lastSnapshot.reachability, result, lastSnapshot.freshness);
  if (options.audit) {
    await auditLog(AUDIT_LOSSLESSNESS, "pipeline", null, {
      met: result.met,
      leaves: result.leaves,
      dangling: result.dangling,
      dangling_ids: result.dangling_ids,
    });
  }
  return result;
}

/** Rowids (of `ids`) present in the FTS index. `*_docsize` is the index; see `loadFtsIds`. */
async function indexedIds(
  db: DatabaseConnection,
  table: "brain_semantic_fts" | "brain_episodic_fts",
  ids: number[],
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const found = new Set<number>();
  try {
    const rows = await collectBindChunks(ids, 0, (chunk) =>
      db.all(
        `SELECT id FROM ${table}_docsize WHERE id IN (${sqlPlaceholders(chunk.length)})`,
        chunk,
      ) as Promise<Array<{ id: number }>>,
    );
    for (const row of rows) found.add(Number(row.id));
    return found;
  } catch {
    try {
      const rows = await collectBindChunks(ids, 0, (chunk) =>
        db.all(
          `SELECT rowid AS id FROM ${table} WHERE rowid IN (${sqlPlaceholders(chunk.length)})`,
          chunk,
        ) as Promise<Array<{ id: number }>>,
      );
      for (const row of rows) found.add(Number(row.id));
      return found;
    } catch {
      return new Set();
    }
  }
}

/**
 * MEM-54 — read-your-writes. Probes the most recent live rows:
 *   φ₂  each is in the lexical (FTS) index,
 *   φ₅  every ancestor sketch of the most recent tree leaves holds the leaf's terms.
 * Needs no sleep and no later ingest: those would be deferred work, not the write path.
 */
export async function checkFreshness(
  options: { db?: DatabaseConnection; audit?: boolean; limit?: number } = {},
): Promise<FreshnessInvariantResult> {
  const db = options.db ?? (await get());
  const limit = Math.max(1, options.limit ?? FRESHNESS_PROBE_LIMIT);
  const gaps: FreshnessGap[] = [];

  const recentSemantic = (await db.all(
    `SELECT id FROM brain_semantic WHERE tombstoned_at IS NULL ORDER BY id DESC LIMIT ?`,
    [limit],
  )) as Array<{ id: number }>;
  const recentEpisodic = (await db.all(
    `SELECT id FROM brain_episodic WHERE tombstoned_at IS NULL ORDER BY id DESC LIMIT ?`,
    [limit],
  )) as Array<{ id: number }>;

  const semIds = recentSemantic.map((r) => Number(r.id));
  const epIds = recentEpisodic.map((r) => Number(r.id));
  const semIndexed = await indexedIds(db, "brain_semantic_fts", semIds);
  const epIndexed = await indexedIds(db, "brain_episodic_fts", epIds);

  let notInFts = 0;
  for (const id of semIds) {
    if (semIndexed.has(id)) continue;
    notInFts++;
    if (gaps.length < MISSING_REPORT_CAP) gaps.push({ type: "semantic", id, reason: "not_in_fts" });
  }
  for (const id of epIds) {
    if (epIndexed.has(id)) continue;
    notInFts++;
    if (gaps.length < MISSING_REPORT_CAP) gaps.push({ type: "episodic", id, reason: "not_in_fts" });
  }

  let sketches = { checked: 0, stale: [] as StaleSketch[] };
  try {
    sketches = await findStaleSketches(db, { limit });
  } catch {
    // brain_summary_tree predates sketches or is absent: nothing to probe.
  }
  for (const s of sketches.stale) {
    if (gaps.length < MISSING_REPORT_CAP) {
      gaps.push({ type: "tree_sketch", id: s.leaf_tree_id, reason: s.reason });
    }
  }

  const result: FreshnessInvariantResult = {
    met: notInFts === 0 && sketches.stale.length === 0,
    checked: true,
    probed: semIds.length + epIds.length,
    not_in_fts: notInFts,
    sketches_probed: sketches.checked,
    stale_sketches: sketches.stale.length,
    stale_ids: gaps,
    at: Date.now(),
  };

  lastSnapshot = snapshotFrom(lastSnapshot.budget, lastSnapshot.reachability, lastSnapshot.losslessness, result);
  if (options.audit) {
    await auditLog(AUDIT_FRESHNESS, "pipeline", null, {
      met: result.met,
      probed: result.probed,
      not_in_fts: result.not_in_fts,
      sketches_probed: result.sketches_probed,
      stale_sketches: result.stale_sketches,
      stale_ids: result.stale_ids,
    });
  }
  return result;
}

export async function checkStoreInvariants(
  options: { db?: DatabaseConnection; audit?: boolean } = {},
): Promise<StoreInvariantReport> {
  const db = options.db ?? (await get());
  const reachability = await checkReachability({ db, audit: options.audit });
  const losslessness = await checkLosslessness({ db, audit: options.audit });
  const freshness = await checkFreshness({ db, audit: options.audit });
  lastSnapshot = snapshotFrom(lastSnapshot.budget, reachability, losslessness, freshness);
  return {
    reachability,
    losslessness,
    freshness,
    met: reachability.met && losslessness.met && freshness.met,
    at: Date.now(),
  };
}
