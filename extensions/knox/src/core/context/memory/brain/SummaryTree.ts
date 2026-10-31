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
import { liveRetrieveSql } from "./store/tombstone.js";
import {
  ensureSessionSummaryNode,
  estimateSummaryTokens,
  type SummaryLeafRef,
  type SummaryLeafType,
} from "./store/summaryTree.js";
import type { DatabaseConnection } from "../../../util/refreshIndex.js";

export const TREE_BRANCHING_DEFAULT = 8;
export const TREE_BEAM_DEFAULT = 4;
export const TREE_ROOT_PREFIX = "tree-root:";
const TREE_MAX_DEPTH = 16;
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
}

export interface TreeBeamMiss {
  ready: boolean;
  leafCount: number;
  epsilonB: number | null;
  epsilonBNote?: string;
  opportunities: number;
  misses: number;
}

type TreeRow = {
  id: number;
  parent_id: number | null;
  kind: string;
  leaf_type: string | null;
  leaf_id: string | null;
  text: string;
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
  await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count)
     VALUES (?, 'leaf', ?, ?, ?, ?)`,
    [
      parentId,
      type,
      String(id),
      (source.text ?? "").slice(0, 400),
      estimateSummaryTokens((source.text ?? "").slice(0, 400)),
    ],
  );
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
       AND ${liveRetrieveSql()}`,
    [sessionId],
  )) as Array<{ id: number; title?: string; content?: string; keywords?: string }>;
  for (const row of semantic) {
    const text = [row.title, row.content, row.keywords].filter(Boolean).join("\n");
    const ok = await insertTreeLeaf(
      { type: "semantic", id: row.id, text },
      { sessionId, db, branching, refresh: false },
    );
    if (ok) linked++;
  }

  const episodic = (await db.all(
    `SELECT id, content FROM brain_episodic
     WHERE session_id = ? AND ${liveRetrieveSql()}`,
    [sessionId],
  )) as Array<{ id: number; content?: string }>;
  for (const row of episodic) {
    const ok = await insertTreeLeaf(
      { type: "episodic", id: row.id, text: row.content },
      { sessionId, db, branching, refresh: false },
    );
    if (ok) linked++;
  }
  if (linked > 0) await refreshSessionForest(db, sessionId);
  return { linked };
}

/**
 * Ranked leaves reached by beam search. Empty when the scoped tree is
 * smaller than `b` (flat FTS fallback).
 */
export async function searchTreeChannel(options: TreeSearchOptions): Promise<TreeMemoryHit[]> {
  try {
    const result = await beamSearchTree(options);
    if (!result.ready) return [];
    return result.hits;
  } catch {
    return [];
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
  epsilonB: number | null;
  epsilonBNote?: string;
  epsilonBOpportunities?: number;
  epsilonBMisses?: number;
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

  const paths = options.relevantLeaves?.length
    ? await loadRelevantPaths(db, options.relevantLeaves)
    : new Map<string, TreePathNode[]>();
  const measure = paths.size > 0;
  const alive = new Set(paths.keys());
  let opportunities = 0;
  let misses = 0;

  let beam = roots
    .map((root) => ({ id: root.id, score: scoreTreeText(query, root.text) }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, beamWidth);
  if (measure) {
    const rootBeam = new Set(beam.map((n) => n.id));
    for (const key of [...alive]) {
      const rootId = paths.get(key)?.[0]?.id;
      opportunities++;
      if (rootId == null || !rootBeam.has(rootId)) {
        misses++;
        alive.delete(key);
      }
    }
  }

  const leafScores = new Map<string, { type: TreeMemoryType; id: number; score: number }>();
  const visited = new Set<number>(beam.map((n) => n.id));

  for (let depth = 0; depth < TREE_MAX_DEPTH && beam.length > 0; depth++) {
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
      const children = await listChildren(db, node.id);
      for (const child of children) {
        if (visited.has(child.id)) continue;
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
          score: scoreTreeText(query, child.text),
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
      for (const key of [...alive]) {
        const path = paths.get(key);
        if (!path) continue;
        const step = path.find((node) => node.parentId != null && beamIds.has(node.parentId));
        if (!step) continue;
        opportunities++;
        const isLeaf = step.id === path[path.length - 1]?.id;
        if (!consideredIds.has(step.id) || (!isLeaf && !nextBeamIds.has(step.id))) {
          misses++;
          alive.delete(key);
        } else if (isLeaf) {
          alive.delete(key);
        }
      }
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
    ...publishedBeamMiss(measure, opportunities, misses),
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
  epsilonB: number | null;
  epsilonBNote: string;
  epsilonBOpportunities: number;
  epsilonBMisses: number;
} {
  return {
    hits,
    ready,
    leafCount,
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
): {
  epsilonB: number | null;
  epsilonBNote?: string;
  epsilonBOpportunities?: number;
  epsilonBMisses?: number;
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
  const inserted = await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, text, token_count)
     VALUES (NULL, 'node', ?, ?)`,
    [text, estimateSummaryTokens(text)],
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
    `SELECT id, parent_id, kind, leaf_type, leaf_id, text FROM brain_summary_tree
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

async function allocateOpenParent(
  db: DatabaseConnection,
  sessionId: string,
  rootId: number,
  branching: number,
): Promise<number> {
  const leafParents = await collectLeafParents(db, rootId);
  for (let i = leafParents.length - 1; i >= 0; i--) {
    const id = leafParents[i]!;
    if ((await childCount(db, id)) < branching) return id;
  }

  const children = await listChildren(db, rootId);
  const nodeChildren = children.filter((c) => c.kind === "node");
  if (nodeChildren.length === 0) {
    const newRoot = await promoteRoot(db, sessionId, rootId);
    return createChildNode(db, newRoot);
  }
  if (nodeChildren.length < branching) {
    return createChildNode(db, rootId);
  }
  const newRoot = await promoteRoot(db, sessionId, rootId);
  return createChildNode(db, newRoot);
}

async function promoteRoot(
  db: DatabaseConnection,
  sessionId: string,
  oldRootId: number,
): Promise<number> {
  const digest = await nodeDigest(db, oldRootId);
  const newText = sessionRootText(sessionId);
  const inserted = await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, text, token_count)
     VALUES (NULL, 'node', ?, ?)`,
    [newText, estimateSummaryTokens(newText)],
  );
  const newRootId = inserted.lastID ?? 0;
  await db.run(
    "UPDATE brain_summary_tree SET parent_id = ?, text = ?, token_count = ? WHERE id = ?",
    [newRootId, digest, estimateSummaryTokens(digest), oldRootId],
  );
  return newRootId;
}

async function createChildNode(db: DatabaseConnection, parentId: number): Promise<number> {
  const inserted = await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, text, token_count)
     VALUES (?, 'node', '', 1)`,
    [parentId],
  );
  return inserted.lastID ?? 0;
}

async function collectLeafParents(db: DatabaseConnection, rootId: number): Promise<number[]> {
  const out: number[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = await listChildren(db, id);
    const nodes = children.filter((c) => c.kind === "node");
    if (nodes.length === 0) {
      out.push(id);
    } else {
      for (const node of nodes) queue.push(node.id);
    }
  }
  return out;
}

async function listChildren(db: DatabaseConnection, parentId: number): Promise<TreeRow[]> {
  return (await db.all(
    `SELECT id, parent_id, kind, leaf_type, leaf_id, text FROM brain_summary_tree
     WHERE parent_id = ? ORDER BY id`,
    [parentId],
  )) as TreeRow[];
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
