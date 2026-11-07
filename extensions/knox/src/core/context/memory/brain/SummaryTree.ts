/**
 * MEM-24 — Summary tree + beam search (A2).
 *
 * Each new leaf is inserted under a session summary node with branching
 * `b = 8`. Retrieval walks the tree with beam width `B = 4`: at each level
 * score at most `B · b` children and keep the top `B` nodes. This is a
 * channel over the same rows, not extra `C_addr` capacity.
 *
 * Until a scoped forest has ≥ `b` leaves, the channel is silent (flat FTS
 * inside `Ω(q)`). `ε_B` is `null` (`n/a — flat FTS`) until a caller passes
 * `relevantLeaves` (MEM-42).
 *
 * Scoring is lexical (content-word Jaccard + identifier overlap). No
 * embeddings or neural rerank.
 */

import { BrainStore } from "./BrainStore.js";
import { getTheoremParams } from "./memoryConfigAccess.js";
import { extractEntityLikeTokens } from "./RelevanceGate.js";
import { contentWords, jaccard } from "./RetrievalQuery.js";
import { notTombstonedSql } from "./store/tombstone.js";
import {
  ensureSessionSummaryNode,
  estimateSummaryTokens,
  type SummaryLeafRef,
  type SummaryLeafType,
} from "./store/summaryTree.js";
import type { DatabaseConnection } from "../../../util/refreshIndex.js";
import {
  emptyNodeSketch,
  leafTermsJson,
  addTermsToAncestors,
  rebuildSubtreeSketches,
} from "./store/treeSketches.js";
import {
  leafSketchScore,
  parseLeafTerms,
  parseTermCounts,
  sketchScore,
  sketchTerms,
  toBytes,
} from "./treeSketch.js";

export const TREE_BRANCHING_DEFAULT = 8;
export const TREE_BEAM_DEFAULT = 4;
export const TREE_ROOT_PREFIX = "tree-root:";
const TREE_MAX_DEPTH = 16;

/** Hard node-visit cap: O(B · b · log_b N_q). */
export function treeVisitBudget(beam: number, branching: number, leafCount: number): number {
  const b = Math.max(2, Math.floor(branching) || TREE_BRANCHING_DEFAULT);
  const B = Math.max(1, Math.floor(beam) || TREE_BEAM_DEFAULT);
  const n = Math.max(b, Math.floor(leafCount) || b);
  const levels = Math.max(1, Math.ceil(Math.log(n) / Math.log(b)));
  return B * b * levels;
}
const NODE_TEXT_CAP = 2000;
const IDENTIFIER_BONUS = 0.25;

export type TreeMemoryType = SummaryLeafType;

export interface TreeMemoryHit {
  type: TreeMemoryType;
  id: number;
  score: number;
}

export interface TreeBeamStatus {
  ready: boolean;
  leafCount: number;
  branching: number;
  beam: number;
  /** Per-level beam miss. `null` when unpublished (flat FTS / no R(q)). */
  epsilonB: number | null;
  epsilonBNote?: string;
  epsilonBOpportunities?: number;
  epsilonBMisses?: number;
}

export interface TreeRelevantLeaf {
  type: TreeMemoryType;
  id: number;
}

export interface TreeSearchOptions {
  query: string;
  db?: DatabaseConnection;
  sessionId?: string;
  projectSessionIds?: string[];
  includeEpisodic?: boolean;
  limit?: number;
  branching?: number;
  beam?: number;
  /** Gold R(q) leaves. When set, beam search measures ε_B (MEM-42). */
  relevantLeaves?: TreeRelevantLeaf[];
}

export interface TreeInsertOptions {
  sessionId: string;
  db?: DatabaseConnection;
  branching?: number;
  /** Default true. φ₅ defers a forest refresh until every leaf is in. */
  refresh?: boolean;
  /**
   * Bulk callers only: skip the per-leaf sketch update and rebuild the forest's
   * sketches once at the end (`ingestSessionLeaves` does). Default false: the
   * sketch is written synchronously with the leaf (MEM-53).
   */
  deferSketch?: boolean;
}

export interface TreeLevelMiss {
  level: number;
  opportunities: number;
  misses: number;
}

export interface TreeBeamMiss {
  ready: boolean;
  leafCount: number;
  epsilonB: number | null;
  epsilonBNote?: string;
  opportunities: number;
  misses: number;
  /** Per-level miss counts (MEM-77). Empty when the tree is silent. */
  byLevel?: TreeLevelMiss[];
}

type TreeRow = {
  id: number;
  parent_id: number | null;
  kind: string;
  leaf_type: string | null;
  leaf_id: string | null;
  text: string;
  /** MEM-53: only selected when sketches are needed. */
  sketch_bloom?: unknown;
  sketch_terms?: string | null;
};

export function resolveTreeBranching(value?: number): number {
  if (Number.isFinite(value) && (value as number) >= 2) return Math.floor(value as number);
  return TREE_BRANCHING_DEFAULT;
}

export function resolveTreeBeam(value?: number): number {
  if (Number.isFinite(value) && (value as number) >= 1) return Math.floor(value as number);
  return TREE_BEAM_DEFAULT;
}

export function isTreeReady(leafCount: number, branching = TREE_BRANCHING_DEFAULT): boolean {
  return leafCount >= resolveTreeBranching(branching);
}

export function sessionRootText(sessionId: string): string {
  return `${TREE_ROOT_PREFIX}${sessionId}`;
}

export function isSessionRootText(text: string, sessionId?: string): boolean {
  if (!text.startsWith(TREE_ROOT_PREFIX)) return false;
  if (!sessionId) return true;
  const rest = text.slice(TREE_ROOT_PREFIX.length);
  return rest === sessionId || rest.startsWith(`${sessionId}\n`);
}

export function scoreTreeText(query: string, text: string): number {
  const qWords = new Set(contentWords(query));
  const tWords = new Set(contentWords(text));
  const overlap = jaccard(qWords, tWords);
  if (!query.trim() || !text.trim()) return overlap;
  const hay = text.toLowerCase();
  let idHits = 0;
  for (const ident of extractEntityLikeTokens(query)) {
    const needle = ident.trim().toLowerCase();
    if (needle.length >= 3 && hay.includes(needle)) idHits++;
  }
  return overlap + idHits * IDENTIFIER_BONUS;
}

export function hasTreeHit(hit?: {
  ranks?: { tree?: number };
  scores?: { tree?: number };
} | null): boolean {
  if (!hit) return false;
  const rank = hit.ranks?.tree;
  if (rank != null && Number.isFinite(rank) && rank >= 1) return true;
  return (hit.scores?.tree ?? 0) > 0;
}

export async function treeBeamStatus(options: TreeSearchOptions = { query: "" }): Promise<TreeBeamStatus> {
  const db = options.db ?? (await BrainStore.get());
  const theorem = getTheoremParams();
  const branching = resolveTreeBranching(options.branching ?? theorem.treeBranchingB);
  const beam = resolveTreeBeam(options.beam ?? theorem.treeBeamB);
  const roots = await loadSessionRoots(db, options);
  const leafCount = await countLeavesUnder(db, roots.map((r) => r.id));
  const ready = isTreeReady(leafCount, branching);
  return {
    ready,
    leafCount,
    branching,
    beam,
    epsilonB: null,
    epsilonBNote: ready ? undefined : "n/a — flat FTS",
  };
}

/**
 * Insert one memory row under the session tree, splitting when a node
 * already has `b` children.
 */
export async function insertTreeLeaf(
  source: SummaryLeafRef,
  options: TreeInsertOptions,
): Promise<boolean> {
  const db = options.db ?? (await BrainStore.get());
  const branching = resolveTreeBranching(options.branching ?? getTheoremParams().treeBranchingB);
  const type: SummaryLeafType = source.type === "semantic" ? "semantic" : "episodic";
  const id = Math.trunc(Number(source.id));
  if (id <= 0 || !options.sessionId) return false;

  let rootId = await ensureSessionRoot(db, options.sessionId);
  if (await leafInTree(db, rootId, type, id)) return false;

  const parentId = await allocateOpenParent(db, options.sessionId, rootId, branching);
  // MEM-53: the leaf keeps its exact terms (full text), the display text stays 400 chars.
  const terms = sketchTerms(source.text ?? "");
  await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count, sketch_terms)
     VALUES (?, 'leaf', ?, ?, ?, ?, ?)`,
    [
      parentId,
      type,
      String(id),
      (source.text ?? "").slice(0, 400),
      estimateSummaryTokens((source.text ?? "").slice(0, 400)),
      leafTermsJson(source.text ?? ""),
    ],
  );
  // φ₅: ancestor sketches are synchronous. Only summary text (below) may lag.
  if (options.deferSketch !== true) {
    await addTermsToAncestors(db, parentId, terms);
  }
  if (options.refresh !== false) {
    await refreshAncestorText(db, parentId, options.sessionId);
  }
  return true;
}

/** Place every live unlinked session leaf into the branched retrieval tree (φ₅). */
export async function ingestSessionLeaves(
  sessionId: string,
  options: { db?: DatabaseConnection; branching?: number } = {},
): Promise<{ linked: number }> {
  if (!sessionId) return { linked: 0 };
  const db = options.db ?? (await BrainStore.get());
  const branching = options.branching;
  let linked = 0;

  const semantic = (await db.all(
    `SELECT id, title, content, keywords FROM brain_semantic
     WHERE source_session_id = ?
       AND (expires_at IS NULL OR expires_at > datetime('now'))
       AND ${notTombstonedSql()}`,
    [sessionId],
  )) as Array<{ id: number; title?: string; content?: string; keywords?: string }>;
  for (const row of semantic) {
    const text = [row.title, row.content, row.keywords].filter(Boolean).join("\n");
    const ok = await insertTreeLeaf(
      { type: "semantic", id: row.id, text },
      { sessionId, db, branching, refresh: false, deferSketch: true },
    );
    if (ok) linked++;
  }

  const episodic = (await db.all(
    `SELECT id, content FROM brain_episodic
     WHERE session_id = ? AND ${notTombstonedSql()}`,
    [sessionId],
  )) as Array<{ id: number; content?: string }>;
  for (const row of episodic) {
    const ok = await insertTreeLeaf(
      { type: "episodic", id: row.id, text: row.content },
      { sessionId, db, branching, refresh: false, deferSketch: true },
    );
    if (ok) linked++;
  }
  if (linked > 0) {
    await refreshSessionForest(db, sessionId);
    const root = await findSessionRoot(db, sessionId);
    if (root) await rebuildSubtreeSketches(db, root.id);
  } else {
    // Sketch-less forest (legacy / restored snapshot): repair it lazily on the next ingest.
    const root = await findSessionRoot(db, sessionId);
    if (root) {
      const missing = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM brain_summary_tree WHERE kind = 'node' AND sketch_bloom IS NULL
           AND (id = ? OR parent_id IS NOT NULL)`,
        [root.id],
      );
      if ((missing?.n ?? 0) > 0) await rebuildSubtreeSketches(db, root.id);
    }
  }
  return { linked };
}

/**
 * Ranked leaves reached by beam search. Empty when the scoped tree is
 * smaller than `b` (flat FTS fallback).
 */
export async function searchTreeChannel(options: TreeSearchOptions): Promise<{
  hits: TreeMemoryHit[];
  visited: number;
  ready: boolean;
}> {
  try {
    const result = await beamSearchTree(options);
    if (!result.ready) return { hits: [], visited: result.visited, ready: false };
    return { hits: result.hits, visited: result.visited, ready: true };
  } catch {
    return { hits: [], visited: 0, ready: false };
  }
}

export interface TreeNodeHit {
  id: number;
  text: string;
  score: number;
  tokenCount: number;
}

/**
 * Scored summary **nodes** (pointers, not leaves) for MEM-29 assembly.
 * Silent when the scoped tree is smaller than `b`.
 */
export async function searchSummaryNodes(options: TreeSearchOptions): Promise<TreeNodeHit[]> {
  try {
    const query = options.query ?? "";
    if (!query.trim()) return [];
    const db = options.db ?? (await BrainStore.get());
    const theorem = getTheoremParams();
    const branching = resolveTreeBranching(options.branching ?? theorem.treeBranchingB);
    const beam = resolveTreeBeam(options.beam ?? theorem.treeBeamB);
    const roots = await loadSessionRoots(db, options);
    const leafCount = await countLeavesUnder(db, roots.map((r) => r.id));
    if (!isTreeReady(leafCount, branching)) return [];

    const hits: TreeNodeHit[] = [];
    const seen = new Set<number>();
    for (const root of roots) {
      for (const id of await descendantNodeIds(db, root.id)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const row = (await db.get(
          `SELECT id, parent_id, kind, leaf_type, leaf_id, text FROM brain_summary_tree WHERE id = ?`,
          [id],
        )) as TreeRow | undefined;
        if (!row || row.kind !== "node") continue;
        const text = displaySummaryNodeText(row.text);
        if (!text) continue;
        const score = scoreTreeText(query, text);
        if (score <= 0) continue;
        hits.push({
          id: row.id,
          text,
          score,
          tokenCount: estimateSummaryTokens(text),
        });
      }
    }
    return hits
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .slice(0, Math.max(1, beam));
  } catch {
    return [];
  }
}

export function displaySummaryNodeText(text: string): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (isSessionRootText(raw)) {
    const nl = raw.indexOf("\n");
    return nl >= 0 ? raw.slice(nl + 1).trim() : "";
  }
  return raw;
}

export interface SessionTurnRef {
  id: number;
  content?: string;
  token_count?: number;
}

export interface SessionOverflowNode {
  nodeId: number;
  text: string;
  leafIds: number[];
  droppedTurnIds: number[];
  keptTurnIds: number[];
}

/**
 * Oldest turns first. Keep newest turns that fit `recentShare`; the rest
 * are dropped from this call only (originals stay in the tree).
 */
export function splitTurnsByRecentShare(
  turns: readonly SessionTurnRef[],
  recentShare: number,
): { droppedTurnIds: number[]; keptTurnIds: number[] } {
  const share = Number.isFinite(recentShare) ? Math.max(0, Math.floor(recentShare)) : 0;
  const kept: number[] = [];
  const dropped: number[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    const id = Math.trunc(Number(turn.id));
    if (id <= 0) continue;
    const stored = Number(turn.token_count);
    const tokens = Number.isFinite(stored) && stored > 0
      ? Math.floor(stored)
      : estimateSummaryTokens(turn.content ?? "");
    if (used + tokens <= share) {
      kept.unshift(id);
      used += tokens;
    } else {
      dropped.unshift(id);
    }
  }
  return { droppedTurnIds: dropped, keptTurnIds: kept };
}

/**
 * MEM-30 — session/tree node that replaces overflowing C_recent.
 * Writes a pointer if needed; never overwrites leaf `content`.
 */
export async function resolveSessionOverflowNode(options: {
  sessionId: string;
  recentShare: number;
  db?: DatabaseConnection;
}): Promise<SessionOverflowNode | null> {
  const sessionId = options.sessionId?.trim();
  if (!sessionId) return null;
  try {
    const db = options.db ?? (await BrainStore.get());
    await ingestSessionLeaves(sessionId, { db });
    const turns = await BrainStore.getEpisodicBySession(sessionId, 1000);
    const split = splitTurnsByRecentShare(
      turns.map((t) => ({ id: t.id, content: t.content, token_count: t.token_count })),
      options.recentShare,
    );
    const session = await BrainStore.getSession(sessionId);
    const root = await findSessionRoot(db, sessionId);

    let nodeId = root?.id ?? Number(session?.summary_node_id ?? 0);
    let text = root ? displaySummaryNodeText(root.text) : "";
    if (!text && session?.summary?.trim()) text = session.summary.trim();
    if (!text) text = heuristicTurnDigest(turns);
    if (!text) return null;

    if (!(nodeId > 0)) {
      nodeId = await ensureSessionSummaryNode(sessionId, text);
      if (nodeId > 0) {
        await db.run("UPDATE brain_sessions SET summary_node_id = ? WHERE id = ?", [nodeId, sessionId]);
      }
    } else if (root && !displaySummaryNodeText(root.text)) {
      const stored = `${sessionRootText(sessionId)}\n${text}`.slice(0, NODE_TEXT_CAP);
      await db.run(
        "UPDATE brain_summary_tree SET text = ?, token_count = ? WHERE id = ?",
        [stored, estimateSummaryTokens(stored), root.id],
      );
      nodeId = root.id;
    }

    if (!(nodeId > 0)) return null;
    return {
      nodeId,
      text,
      leafIds: turns.map((t) => t.id),
      droppedTurnIds: split.droppedTurnIds,
      keptTurnIds: split.keptTurnIds,
    };
  } catch {
    return null;
  }
}

function heuristicTurnDigest(turns: readonly { content?: string }[]): string {
  return turns
    .map((t) => (t.content ?? "").replace(/\s+/g, " ").trim().slice(0, 160))
    .filter(Boolean)
    .join("\n")
    .slice(0, NODE_TEXT_CAP);
}

export { planRecentShare } from "./memoryConfigAccess.js";

export async function beamSearchTree(options: TreeSearchOptions): Promise<{
  hits: TreeMemoryHit[];
  ready: boolean;
  leafCount: number;
  visited: number;
  epsilonB: number | null;
  epsilonBNote?: string;
  epsilonBOpportunities?: number;
  epsilonBMisses?: number;
  epsilonBByLevel?: TreeLevelMiss[];
}> {
  const query = options.query ?? "";
  if (!query.trim()) {
    return unpublishedBeam([], false, 0);
  }
  const db = options.db ?? (await BrainStore.get());
  const theorem = getTheoremParams();
  const branching = resolveTreeBranching(options.branching ?? theorem.treeBranchingB);
  const beamWidth = resolveTreeBeam(options.beam ?? theorem.treeBeamB);
  const roots = await loadSessionRoots(db, options);
  const leafCount = await countLeavesUnder(db, roots.map((r) => r.id));
  if (!isTreeReady(leafCount, branching)) {
    return unpublishedBeam([], false, leafCount);
  }
  const visitBudget = treeVisitBudget(beamWidth, branching, leafCount);

  const paths = options.relevantLeaves?.length
    ? await loadRelevantPaths(db, options.relevantLeaves)
    : new Map<string, TreePathNode[]>();
  const measure = paths.size > 0;
  const alive = new Set(paths.keys());
  let opportunities = 0;
  let misses = 0;
  const byLevel: TreeLevelMiss[] = [];
  const recordLevel = (level: number, opp: number, miss: number) => {
    if (opp <= 0 && miss <= 0) return;
    opportunities += opp;
    misses += miss;
    byLevel.push({ level, opportunities: opp, misses: miss });
  };

  const qTerms = sketchTerms(query).slice(0, 32);
  let beam = roots
    .map((root) => ({ id: root.id, score: scoreTreeRow(query, qTerms, root) }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, beamWidth);
  if (measure) {
    const rootBeam = new Set(beam.map((n) => n.id));
    let opp = 0;
    let miss = 0;
    for (const key of [...alive]) {
      const rootId = paths.get(key)?.[0]?.id;
      opp++;
      if (rootId == null || !rootBeam.has(rootId)) {
        miss++;
        alive.delete(key);
      }
    }
    recordLevel(0, opp, miss);
  }

  const leafScores = new Map<string, { type: TreeMemoryType; id: number; score: number }>();
  const visited = new Set<number>(beam.map((n) => n.id));

  for (let depth = 0; depth < TREE_MAX_DEPTH && beam.length > 0 && visited.size < visitBudget; depth++) {
    const candidates: Array<{
      id: number;
      parentId: number;
      kind: string;
      text: string;
      leafType: TreeMemoryType | null;
      leafId: number | null;
      score: number;
    }> = [];
    for (const node of beam) {
      if (visited.size >= visitBudget) break;
      const children = await listChildren(db, node.id, true);
      for (const child of children) {
        if (visited.has(child.id)) continue;
        if (visited.size >= visitBudget) break;
        visited.add(child.id);
        const leafType =
          child.kind === "leaf"
            ? child.leaf_type === "semantic" ? "semantic" : "episodic"
            : null;
        const leafId = child.kind === "leaf" ? Number(child.leaf_id) : null;
        candidates.push({
          id: child.id,
          parentId: node.id,
          kind: child.kind,
          text: child.text,
          leafType,
          leafId: leafId != null && Number.isFinite(leafId) && leafId > 0 ? leafId : null,
          score: scoreTreeRow(query, qTerms, child),
        });
      }
    }

    const considered = candidates
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .slice(0, beamWidth * branching);
    const nextBeam = considered
      .filter((c) => c.kind === "node")
      .slice(0, beamWidth)
      .map((c) => ({ id: c.id, score: c.score }));

    if (measure && alive.size > 0) {
      const consideredIds = new Set(considered.map((c) => c.id));
      const nextBeamIds = new Set(nextBeam.map((n) => n.id));
      const beamIds = new Set(beam.map((n) => n.id));
      let opp = 0;
      let miss = 0;
      for (const key of [...alive]) {
        const path = paths.get(key);
        if (!path) continue;
        const step = path.find((node) => node.parentId != null && beamIds.has(node.parentId));
        if (!step) continue;
        opp++;
        const isLeaf = step.id === path[path.length - 1]?.id;
        if (!consideredIds.has(step.id) || (!isLeaf && !nextBeamIds.has(step.id))) {
          miss++;
          alive.delete(key);
        } else if (isLeaf) {
          alive.delete(key);
        }
      }
      recordLevel(depth + 1, opp, miss);
    }

    for (const cand of considered) {
      if (cand.kind !== "leaf" || cand.leafId == null || cand.leafType == null) continue;
      if (cand.score <= 0) continue;
      if (cand.leafType === "episodic" && options.includeEpisodic === false) continue;
      const key = `${cand.leafType}:${cand.leafId}`;
      const prev = leafScores.get(key);
      if (!prev || cand.score > prev.score) {
        leafScores.set(key, { type: cand.leafType, id: cand.leafId, score: cand.score });
      }
    }

    beam = nextBeam;
  }

  const hits = [...leafScores.values()]
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.id - b.id)
    .slice(0, Math.max(1, options.limit ?? 50));
  return {
    hits,
    ready: true,
    leafCount,
    visited: visited.size,
    ...publishedBeamMiss(measure, opportunities, misses, byLevel),
  };
}

/** MEM-42: per-level beam miss for a known R(q). */
export async function measureTreeBeamMiss(options: TreeSearchOptions): Promise<TreeBeamMiss> {
  const result = await beamSearchTree(options);
  return {
    ready: result.ready,
    leafCount: result.leafCount,
    epsilonB: result.epsilonB,
    epsilonBNote: result.epsilonBNote,
    opportunities: result.epsilonBOpportunities ?? 0,
    misses: result.epsilonBMisses ?? 0,
    byLevel: result.epsilonBByLevel,
  };
}

type TreePathNode = { id: number; parentId: number | null };

export async function leafAncestorPath(
  type: TreeMemoryType,
  leafId: number,
  options: { db?: DatabaseConnection } = {},
): Promise<TreePathNode[] | null> {
  const db = options.db ?? (await BrainStore.get());
  return loadLeafPath(db, type, leafId);
}

export async function maxChildCount(
  sessionId: string,
  options: { db?: DatabaseConnection } = {},
): Promise<number> {
  const db = options.db ?? (await BrainStore.get());
  const root = await findSessionRoot(db, sessionId);
  if (!root) return 0;
  const ids = await descendantNodeIds(db, root.id);
  let max = 0;
  for (const id of ids) {
    const n = await childCount(db, id);
    if (n > max) max = n;
  }
  return max;
}

function unpublishedBeam(
  hits: TreeMemoryHit[],
  ready: boolean,
  leafCount: number,
): {
  hits: TreeMemoryHit[];
  ready: boolean;
  leafCount: number;
  visited: number;
  epsilonB: number | null;
  epsilonBNote: string;
  epsilonBOpportunities: number;
  epsilonBMisses: number;
} {
  return {
    hits,
    ready,
    leafCount,
    visited: 0,
    epsilonB: null,
    epsilonBNote: "n/a — flat FTS",
    epsilonBOpportunities: 0,
    epsilonBMisses: 0,
  };
}

function publishedBeamMiss(
  measure: boolean,
  opportunities: number,
  misses: number,
  byLevel: TreeLevelMiss[] = [],
): {
  epsilonB: number | null;
  epsilonBNote?: string;
  epsilonBOpportunities?: number;
  epsilonBMisses?: number;
  epsilonBByLevel?: TreeLevelMiss[];
} {
  if (!measure) {
    return { epsilonB: null };
  }
  if (opportunities <= 0) {
    return {
      epsilonB: null,
      epsilonBNote: "n/a — no relevant leaves in tree",
      epsilonBOpportunities: 0,
      epsilonBMisses: 0,
    };
  }
  return {
    epsilonB: misses / opportunities,
    epsilonBOpportunities: opportunities,
    epsilonBMisses: misses,
    epsilonBByLevel: byLevel.length ? byLevel : undefined,
  };
}

async function loadRelevantPaths(
  db: DatabaseConnection,
  leaves: readonly TreeRelevantLeaf[],
): Promise<Map<string, TreePathNode[]>> {
  const paths = new Map<string, TreePathNode[]>();
  for (const leaf of leaves) {
    const type = leaf.type === "semantic" ? "semantic" : "episodic";
    const id = Math.trunc(Number(leaf.id));
    if (id <= 0) continue;
    const path = await loadLeafPath(db, type, id);
    if (path && path.length > 0) paths.set(`${type}:${id}`, path);
  }
  return paths;
}

async function loadLeafPath(
  db: DatabaseConnection,
  type: TreeMemoryType,
  leafId: number,
): Promise<TreePathNode[] | null> {
  const leaf = (await db.get(
    `SELECT id, parent_id FROM brain_summary_tree
     WHERE kind = 'leaf' AND leaf_type = ? AND leaf_id = ?
     ORDER BY id DESC LIMIT 1`,
    [type, String(leafId)],
  )) as { id: number; parent_id: number | null } | undefined;
  if (!leaf) return null;
  const chain: TreePathNode[] = [{ id: leaf.id, parentId: leaf.parent_id ?? null }];
  const seen = new Set<number>([leaf.id]);
  let current = leaf.parent_id;
  while (current != null && current > 0 && !seen.has(current)) {
    seen.add(current);
    const row = (await db.get(
      "SELECT id, parent_id FROM brain_summary_tree WHERE id = ?",
      [current],
    )) as { id: number; parent_id: number | null } | undefined;
    if (!row) break;
    chain.push({ id: row.id, parentId: row.parent_id ?? null });
    current = row.parent_id;
  }
  chain.reverse();
  return chain;
}

async function refreshSessionForest(db: DatabaseConnection, sessionId: string): Promise<void> {
  const root = await findSessionRoot(db, sessionId);
  if (!root) return;
  await refreshSubtree(db, root.id, sessionId);
}

/** φ₇: refresh lazy summary **text** from current children (sketches stay sync). */
export async function refreshLazySummaryText(
  sessionId?: string,
  db?: DatabaseConnection,
): Promise<number> {
  const conn = db ?? (await BrainStore.get());
  if (sessionId) {
    const root = await findSessionRoot(conn, sessionId);
    if (!root) return 0;
    await refreshSubtree(conn, root.id, sessionId);
    return 1;
  }
  const roots = (await conn.all(
    `SELECT id, text FROM brain_summary_tree WHERE parent_id IS NULL AND kind = 'node'`,
  )) as Array<{ id: number; text: string }>;
  let n = 0;
  for (const root of roots) {
    const sid = root.text.startsWith(TREE_ROOT_PREFIX)
      ? root.text.slice(TREE_ROOT_PREFIX.length).split("\n")[0]
      : "";
    await refreshSubtree(conn, root.id, sid);
    n++;
  }
  return n;
}

/**
 * MEM-73 step 4: blank erased leaves and regenerate every ancestor from
 * remaining children. The leaf row stays (Losslessness: tombstone is OK).
 */
export async function regenerateAncestorsAfterErasure(
  kind: "semantic" | "episodic",
  ids: number[],
): Promise<number> {
  const unique = [...new Set(ids.map((id) => Math.trunc(Number(id))).filter((id) => id > 0))];
  if (unique.length === 0) return 0;
  const db = await BrainStore.get();
  let regenerated = 0;
  for (const id of unique) {
    const leaves = (await db.all(
      `SELECT id, parent_id FROM brain_summary_tree
       WHERE kind = 'leaf' AND leaf_type = ? AND leaf_id = ?`,
      [kind, String(id)],
    )) as Array<{ id: number; parent_id: number | null }>;
    for (const leaf of leaves) {
      await db.run(
        `UPDATE brain_summary_tree SET text = '', token_count = 0, sketch_terms = '[]' WHERE id = ?`,
        [leaf.id],
      );
      const parentId = leaf.parent_id;
      if (parentId != null && parentId > 0) {
        const sessionId = await sessionIdOfNode(db, parentId);
        await refreshAncestorText(db, parentId, sessionId);
        await rebuildSubtreeSketches(db, parentId);
      }
      regenerated++;
    }
  }
  return regenerated;
}

async function sessionIdOfNode(db: DatabaseConnection, nodeId: number): Promise<string> {
  let current: number | null = nodeId;
  const seen = new Set<number>();
  while (current != null && current > 0 && !seen.has(current)) {
    seen.add(current);
    const row = (await db.get(
      "SELECT id, parent_id, text FROM brain_summary_tree WHERE id = ?",
      [current],
    )) as { id: number; parent_id: number | null; text: string } | undefined;
    if (!row) break;
    if (row.parent_id == null && row.text.startsWith(TREE_ROOT_PREFIX)) {
      return row.text.slice(TREE_ROOT_PREFIX.length).split("\n")[0] ?? "";
    }
    current = row.parent_id;
  }
  return "";
}

async function refreshSubtree(
  db: DatabaseConnection,
  nodeId: number,
  sessionId: string,
): Promise<void> {
  const children = await listChildren(db, nodeId);
  for (const child of children) {
    if (child.kind === "node") await refreshSubtree(db, child.id, sessionId);
  }
  await refreshNodeText(db, nodeId, sessionId);
}

async function ensureSessionRoot(db: DatabaseConnection, sessionId: string): Promise<number> {
  const existing = await findSessionRoot(db, sessionId);
  if (existing) return existing.id;
  const text = sessionRootText(sessionId);
  const sketch = emptyNodeSketch(0);
  const inserted = await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, text, token_count, sketch_bloom, sketch_terms)
     VALUES (NULL, 'node', ?, ?, ?, ?)`,
    [text, estimateSummaryTokens(text), Buffer.from(sketch.bloom), sketch.terms],
  );
  return inserted.lastID ?? 0;
}

async function findSessionRoot(
  db: DatabaseConnection,
  sessionId: string,
): Promise<TreeRow | null> {
  const exact = sessionRootText(sessionId);
  const row = await db.get(
    `SELECT id, parent_id, kind, leaf_type, leaf_id, text FROM brain_summary_tree
     WHERE parent_id IS NULL AND kind = 'node'
       AND (text = ? OR text LIKE ?)
     ORDER BY id DESC LIMIT 1`,
    [exact, `${escapeLike(exact)}\n%`],
  );
  return row ? (row as TreeRow) : null;
}

async function loadSessionRoots(
  db: DatabaseConnection,
  options: TreeSearchOptions,
): Promise<TreeRow[]> {
  const sessionIds = resolveScopeSessions(options);
  if (sessionIds && sessionIds.length === 0) return [];
  const rows = (await db.all(
    `SELECT id, parent_id, kind, leaf_type, leaf_id, text, sketch_bloom, sketch_terms FROM brain_summary_tree
     WHERE parent_id IS NULL AND kind = 'node' AND text LIKE ?`,
    [`${TREE_ROOT_PREFIX}%`],
  )) as TreeRow[];
  if (!sessionIds) return rows;
  const allowed = new Set(sessionIds);
  return rows.filter((row) => {
    const rest = row.text.slice(TREE_ROOT_PREFIX.length);
    const id = rest.split("\n", 1)[0] ?? "";
    return allowed.has(id);
  });
}

function resolveScopeSessions(options: TreeSearchOptions): string[] | undefined {
  if (options.projectSessionIds !== undefined) {
    const ids = [...options.projectSessionIds];
    if (options.sessionId && !ids.includes(options.sessionId)) ids.push(options.sessionId);
    return ids;
  }
  if (options.sessionId) return [options.sessionId];
  return undefined;
}

/**
 * MEM-53 — B-tree style insertion. All leaf-parents sit at one depth, so depth
 * is ⌈log_b N⌉. Fill the rightmost leaf-parent; when it is full, climb to the
 * nearest ancestor with room and grow a fresh chain down to leaf-parent depth;
 * when every ancestor is full, split the root (promote) and grow a chain under
 * the new root.
 */
async function allocateOpenParent(
  db: DatabaseConnection,
  sessionId: string,
  rootId: number,
  branching: number,
): Promise<number> {
  const path = await rightmostPath(db, rootId);
  const depth = path.length;
  const leafParent = path[depth - 1]!;
  if ((await childCount(db, leafParent)) < branching) return leafParent;

  for (let i = depth - 2; i >= 0; i--) {
    if ((await childCount(db, path[i]!)) < branching) {
      let parent = path[i]!;
      for (let k = i + 1; k < depth; k++) {
        parent = await createChildNode(db, parent, depth - 1 - k);
      }
      return parent;
    }
  }

  const newRoot = await promoteRoot(db, sessionId, rootId, depth - 1);
  let parent = newRoot;
  for (let k = 1; k <= depth; k++) {
    parent = await createChildNode(db, parent, depth - k);
  }
  return parent;
}

/** Root → … → deepest node reached by always taking the newest node child. */
async function rightmostPath(db: DatabaseConnection, rootId: number): Promise<number[]> {
  const path = [rootId];
  const seen = new Set<number>(path);
  for (let guard = 0; guard < TREE_MAX_DEPTH * 4; guard++) {
    const row = await db.get<{ id: number }>(
      `SELECT id FROM brain_summary_tree WHERE parent_id = ? AND kind = 'node'
        ORDER BY id DESC LIMIT 1`,
      [path[path.length - 1]],
    );
    if (!row || seen.has(row.id)) break;
    seen.add(row.id);
    path.push(row.id);
  }
  return path;
}

/** Split the root: the old root becomes a child of a new root (height + 1). */
async function promoteRoot(
  db: DatabaseConnection,
  sessionId: string,
  oldRootId: number,
  oldHeight: number,
): Promise<number> {
  const digest = await nodeDigest(db, oldRootId);
  const newText = sessionRootText(sessionId);
  const sketch = emptyNodeSketch(oldHeight + 1);
  const inserted = await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, text, token_count, sketch_bloom, sketch_terms)
     VALUES (NULL, 'node', ?, ?, ?, ?)`,
    [newText, estimateSummaryTokens(newText), Buffer.from(sketch.bloom), sketch.terms],
  );
  const newRootId = inserted.lastID ?? 0;
  await db.run(
    "UPDATE brain_summary_tree SET parent_id = ?, text = ?, token_count = ? WHERE id = ?",
    [newRootId, digest, estimateSummaryTokens(digest), oldRootId],
  );
  // The new root's Bloom has a different size and must hold every descendant term, and
  // the stored top-term counts are pruned, so rebuild from the leaves. Splits are rare (log_b N).
  await rebuildSubtreeSketches(db, newRootId);
  return newRootId;
}

async function createChildNode(
  db: DatabaseConnection,
  parentId: number,
  height: number,
): Promise<number> {
  const sketch = emptyNodeSketch(height);
  const inserted = await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, text, token_count, sketch_bloom, sketch_terms)
     VALUES (?, 'node', '', 1, ?, ?)`,
    [parentId, Buffer.from(sketch.bloom), sketch.terms],
  );
  return inserted.lastID ?? 0;
}

/** Node levels from the session root down (a root holding only leaves = 1). */
export async function treeDepth(
  sessionId: string,
  options: { db?: DatabaseConnection } = {},
): Promise<number> {
  const db = options.db ?? (await BrainStore.get());
  const root = await findSessionRoot(db, sessionId);
  if (!root) return 0;
  let level = [root.id];
  let depth = 0;
  while (level.length > 0 && depth < TREE_MAX_DEPTH * 4) {
    depth++;
    const next: number[] = [];
    for (const id of level) {
      const kids = await listChildren(db, id);
      for (const kid of kids) if (kid.kind === "node") next.push(kid.id);
    }
    level = next;
  }
  return depth;
}

async function listChildren(
  db: DatabaseConnection,
  parentId: number,
  withSketch = false,
): Promise<TreeRow[]> {
  const cols = withSketch
    ? "id, parent_id, kind, leaf_type, leaf_id, text, sketch_bloom, sketch_terms"
    : "id, parent_id, kind, leaf_type, leaf_id, text";
  return (await db.all(
    `SELECT ${cols} FROM brain_summary_tree WHERE parent_id = ? ORDER BY id`,
    [parentId],
  )) as TreeRow[];
}

/**
 * Routing score of one tree row: display-text overlap, or its term sketch
 * (whichever is higher). The sketch makes exact-term routing independent of
 * the 160-char digest, so a term deep inside a leaf still routes to it.
 */
function scoreTreeRow(query: string, qTerms: readonly string[], row: TreeRow): number {
  const text = scoreTreeText(query, row.text);
  if (qTerms.length === 0) return text;
  if (row.kind === "leaf") {
    return Math.max(text, leafSketchScore(qTerms, parseLeafTerms(row.sketch_terms)));
  }
  const bloom = toBytes(row.sketch_bloom);
  if (!bloom) return text;
  return Math.max(text, sketchScore(qTerms, bloom, parseTermCounts(row.sketch_terms)));
}

async function childCount(db: DatabaseConnection, parentId: number): Promise<number> {
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM brain_summary_tree WHERE parent_id = ?",
    [parentId],
  );
  return row?.n ?? 0;
}

async function descendantNodeIds(db: DatabaseConnection, rootId: number): Promise<number[]> {
  const ids = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = await listChildren(db, id);
    for (const child of children) {
      if (child.kind !== "node") continue;
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

async function leafInTree(
  db: DatabaseConnection,
  rootId: number,
  type: SummaryLeafType,
  leafId: number,
): Promise<boolean> {
  const nodeIds = await descendantNodeIds(db, rootId);
  if (nodeIds.length === 0) return false;
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM brain_summary_tree
     WHERE kind = 'leaf' AND leaf_type = ? AND leaf_id = ?
       AND parent_id IN (${nodeIds.map(() => "?").join(",")})`,
    [type, String(leafId), ...nodeIds],
  );
  return (row?.n ?? 0) > 0;
}

async function countLeavesUnder(db: DatabaseConnection, rootIds: number[]): Promise<number> {
  if (rootIds.length === 0) return 0;
  let total = 0;
  for (const rootId of rootIds) {
    const nodeIds = await descendantNodeIds(db, rootId);
    if (nodeIds.length === 0) continue;
    const row = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM brain_summary_tree
       WHERE kind = 'leaf' AND parent_id IN (${nodeIds.map(() => "?").join(",")})`,
      nodeIds,
    );
    total += row?.n ?? 0;
  }
  return total;
}

async function refreshAncestorText(
  db: DatabaseConnection,
  nodeId: number,
  sessionId: string,
): Promise<void> {
  let current: number | null = nodeId;
  const seen = new Set<number>();
  while (current != null && current > 0 && !seen.has(current)) {
    seen.add(current);
    await refreshNodeText(db, current, sessionId);
    const parent: { parent_id: number | null } | undefined = await db.get<{ parent_id: number | null }>(
      "SELECT parent_id FROM brain_summary_tree WHERE id = ?",
      [current],
    );
    current = parent?.parent_id ?? null;
  }
}

async function refreshNodeText(
  db: DatabaseConnection,
  nodeId: number,
  sessionId: string,
): Promise<void> {
  const node = await db.get<TreeRow>(
    "SELECT id, parent_id, kind, leaf_type, leaf_id, text FROM brain_summary_tree WHERE id = ?",
    [nodeId],
  );
  if (!node || node.kind !== "node") return;
  const digest = await nodeDigest(db, nodeId);
  const text = node.parent_id == null
    ? `${sessionRootText(sessionId)}\n${digest}`.slice(0, NODE_TEXT_CAP)
    : digest;
  await db.run(
    "UPDATE brain_summary_tree SET text = ?, token_count = ? WHERE id = ?",
    [text, estimateSummaryTokens(text), nodeId],
  );
}

async function nodeDigest(db: DatabaseConnection, nodeId: number): Promise<string> {
  const children = await listChildren(db, nodeId);
  const parts = children
    .map((c) => (c.text ?? "").replace(/\s+/g, " ").trim().slice(0, 160))
    .filter(Boolean);
  return parts.join("\n").slice(0, NODE_TEXT_CAP);
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, "");
}
