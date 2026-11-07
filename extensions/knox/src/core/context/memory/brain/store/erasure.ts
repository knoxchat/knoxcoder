/**
 * MEM-73 — delete propagation and content-free tombstones.
 *
 * Four steps, ack only after step 4:
 *   1. remove row content, write a content-free tombstone (id, scope, reason, time)
 *   2. remove postings from FTS / n-gram and the ripgrep corpus (blank content)
 *   3. drop graph edges whose only evidence was this memory, and orphan entities
 *   4. regenerate every ancestor summary node bottom-up from remaining children
 *
 * Also scrub brain snapshot JSON that contains the id, and checkpoint pointer
 * leaves that name erased content. Forget is not reversible.
 */

import { contentWords } from "../RetrievalQuery.js";
import { get } from "./connection.js";
import { auditLog } from "./runtime.js";
import { collectBindChunks, forBindChunks, sqlPlaceholders } from "./sqlChunks.js";
import { dropFrozenFts } from "./frozenSegment.js";
import {
  AUDIT_FORGET,
  SEMANTIC_NOT_PINNED_SQL,
  TOMBSTONE_REASON,
  skipPinnedSemantic,
  type MemoryLeafKind,
  type TombstoneOptions,
} from "./tombstone.js";

const TABLES: Record<MemoryLeafKind, "brain_semantic" | "brain_episodic"> = {
  semantic: "brain_semantic",
  episodic: "brain_episodic",
};

export interface ErasureStepCounts {
  content: number;
  postings: number;
  graph: number;
  tree: number;
}

export interface EraseResult {
  erased: number;
  steps: ErasureStepCounts;
  ids: number[];
}

function uniqueTokensOf(row: {
  title?: string | null;
  content?: string | null;
  keywords?: string | null;
}): string[] {
  const hay = [row.title, row.content, row.keywords].filter(Boolean).join("\n");
  const words = contentWords(hay).filter((w) => w.length >= 6);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 24) break;
  }
  return out;
}

async function loadRows(
  kind: MemoryLeafKind,
  ids: number[],
): Promise<Array<Record<string, unknown> & { id: number }>> {
  if (ids.length === 0) return [];
  const db = await get();
  const table = TABLES[kind];
  return collectBindChunks(ids, 0, (chunk) =>
    db.all(
      `SELECT * FROM ${table} WHERE id IN (${sqlPlaceholders(chunk.length)}) AND tombstoned_at IS NULL`,
      chunk,
    ) as Promise<Array<Record<string, unknown> & { id: number }>>,
  );
}

async function blankContent(
  kind: MemoryLeafKind,
  ids: number[],
  reason: string,
): Promise<void> {
  const db = await get();
  const table = TABLES[kind];
  await forBindChunks(ids, 1, async (chunk) => {
    if (kind === "semantic") {
      await db.run(
        `UPDATE ${table}
         SET title = '',
             content = '',
             keywords = '',
             minhash = NULL,
             content_hash = NULL,
             tombstoned_at = datetime('now'),
             tombstone_reason = ?,
             tier = 'frozen'
         WHERE id IN (${sqlPlaceholders(chunk.length)}) AND tombstoned_at IS NULL`,
        [reason, ...chunk],
      );
    } else {
      await db.run(
        `UPDATE ${table}
         SET content = '',
             minhash = NULL,
             tombstoned_at = datetime('now'),
             tombstone_reason = ?,
             tier = 'frozen'
         WHERE id IN (${sqlPlaceholders(chunk.length)}) AND tombstoned_at IS NULL`,
        [reason, ...chunk],
      );
    }
  });
}

async function dropPostings(
  kind: MemoryLeafKind,
  rows: Array<{ id: number; title?: string | null; content?: string | null; keywords?: string | null }>,
): Promise<number> {
  const db = await get();
  await dropFrozenFts(db, kind, rows.map((r) => Number(r.id)));
  return rows.length;
}

async function dropAssociations(kind: MemoryLeafKind, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await get();
  let n = 0;
  await forBindChunks(ids, 0, async (chunk) => {
    const result = await db.run(
      `DELETE FROM brain_associations
       WHERE (source_type = ? AND source_id IN (${sqlPlaceholders(chunk.length)}))
          OR (target_type = ? AND target_id IN (${sqlPlaceholders(chunk.length)}))`,
      [kind, ...chunk, kind, ...chunk],
    );
    n += result.changes ?? 0;
  });
  return n;
}

function mentionsName(haystack: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return false;
  return haystack.toLowerCase().includes(n);
}

async function dropOrphanGraph(
  kind: MemoryLeafKind,
  rows: Array<{ id: number; title?: string | null; content?: string | null; keywords?: string | null }>,
): Promise<number> {
  await dropAssociations(kind, rows.map((r) => Number(r.id)));
  const haystacks = rows.map((r) => [r.title, r.content, r.keywords].filter(Boolean).join("\n"));
  const combined = haystacks.join("\n");
  if (!combined.trim()) return 0;

  const db = await get();
  const entities = (await db.all(
    `SELECT id, name FROM brain_entities WHERE name IS NOT NULL AND length(trim(name)) >= 2`,
  )) as Array<{ id: number; name: string }>;
  const mentioned = entities.filter((e) => mentionsName(combined, e.name));
  if (mentioned.length === 0) return 0;

  let dropped = 0;
  for (const entity of mentioned) {
    const name = entity.name.trim();
    const like = `%${name.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const live = await db.get<{ n: number }>(
      `SELECT (
         (SELECT COUNT(*) FROM brain_semantic
           WHERE tombstoned_at IS NULL
             AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR keywords LIKE ? ESCAPE '\\'))
         +
         (SELECT COUNT(*) FROM brain_episodic
           WHERE tombstoned_at IS NULL AND content LIKE ? ESCAPE '\\')
       ) AS n`,
      [like, like, like, like],
    );
    if ((live?.n ?? 0) > 0) continue;
    await db.run(
      "DELETE FROM brain_graph_edges WHERE source_entity_id = ? OR target_entity_id = ?",
      [entity.id, entity.id],
    );
    const result = await db.run("DELETE FROM brain_entities WHERE id = ?", [entity.id]);
    dropped += result.changes ?? 0;
  }
  return dropped;
}

async function regenerateTree(
  kind: MemoryLeafKind,
  ids: number[],
): Promise<number> {
  const { regenerateAncestorsAfterErasure } = await import("../SummaryTree.js");
  return regenerateAncestorsAfterErasure(kind, ids);
}

async function scrubSnapshots(
  kind: MemoryLeafKind,
  ids: number[],
  tokensById: Map<number, string[]>,
): Promise<void> {
  const { scrubErasedIdsFromSnapshots } = await import("./checkpoints.js");
  await scrubErasedIdsFromSnapshots(kind, ids, tokensById);
}

async function scrubCheckpointPointers(
  tokens: string[],
): Promise<void> {
  if (tokens.length === 0) return;
  const db = await get();
  const rows = (await db.all(
    `SELECT id, content FROM brain_episodic
     WHERE tombstoned_at IS NULL
       AND json_extract(metadata, '$.kind') = 'checkpoint'`,
  )) as Array<{ id: number; content: string }>;
  for (const row of rows) {
    let next = String(row.content ?? "");
    let changed = false;
    for (const token of tokens) {
      if (token.length < 6) continue;
      if (!next.toLowerCase().includes(token.toLowerCase())) continue;
      const re = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      next = next.replace(re, "");
      changed = true;
    }
    if (!changed) continue;
    await db.run(
      `UPDATE brain_episodic SET content = ? WHERE id = ? AND tombstoned_at IS NULL`,
      [next.replace(/\s+/g, " ").trim(), row.id],
    );
  }
}

/**
 * Erase memories. Ack (return) only after step 4. Pinned semantic rows are
 * skipped unless `includePinned`. Already-tombstoned ids are no-ops.
 */
export async function eraseMemories(
  kind: MemoryLeafKind,
  ids: number[],
  reason: string,
  options: TombstoneOptions = {},
): Promise<number> {
  const unique = [...new Set(ids.map((id) => Math.trunc(Number(id))).filter((id) => id > 0))];
  if (unique.length === 0) return 0;

  let candidates = unique;
  if (kind === "semantic" && !options.includePinned) {
    candidates = await skipPinnedSemantic(unique);
    if (candidates.length === 0) return 0;
  }

  const rows = await loadRows(kind, candidates);
  if (rows.length === 0) return 0;
  const fresh = rows.map((r) => Number(r.id));
  const tokensById = new Map<number, string[]>();
  const allTokens: string[] = [];
  for (const row of rows) {
    const tokens = uniqueTokensOf({
      title: typeof row.title === "string" ? row.title : null,
      content: typeof row.content === "string" ? row.content : null,
      keywords: typeof row.keywords === "string" ? row.keywords : null,
    });
    tokensById.set(Number(row.id), tokens);
    allTokens.push(...tokens);
  }

  const via = options.via ?? "forget";
  const auditEach = options.auditEach !== false;
  const steps: ErasureStepCounts = { content: 0, postings: 0, graph: 0, tree: 0 };

  // Step 1: content-free tombstone (id, scope, reason, time). No content in audit.
  // Live FTS is content=; the UPDATE trigger keeps postings in sync (empty docs).
  await blankContent(kind, fresh, reason);
  steps.content = fresh.length;

  // Step 2: drop Frozen postings. Ripgrep reads content; blanking drops it.
  steps.postings = await dropPostings(kind, rows);

  // Step 3: graph evidence.
  steps.graph = await dropOrphanGraph(kind, rows);

  // Step 4: ancestor summaries from remaining children.
  steps.tree = await regenerateTree(kind, fresh);

  await scrubSnapshots(kind, fresh, tokensById);
  await scrubCheckpointPointers([...new Set(allTokens)]);

  if (auditEach) {
    for (const row of rows) {
      const id = Number(row.id);
      await auditLog(AUDIT_FORGET, kind, id, {
        reason,
        via,
        steps,
        scope: kind === "semantic" ? row.source_session_id ?? null : row.session_id ?? null,
      });
    }
  }

  return fresh.length;
}

export async function eraseWhere(
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
  return eraseMemories(
    kind,
    rows.map((r) => Number(r.id)),
    reason,
    options,
  );
}

export async function forgetExpiredTtl(): Promise<number> {
  return eraseWhere(
    "semantic",
    `expires_at IS NOT NULL AND expires_at < datetime('now')`,
    [],
    TOMBSTONE_REASON.ttl,
    { via: "ttl" },
  );
}
