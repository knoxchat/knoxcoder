/**
 * MEM-05 — summary-tree pointers. A summary is a node that lists original
 * leaf ids; it must not replace leaf `content`.
 *
 * Beam search over this tree is MEM-24. This module only writes / reads
 * pointers so sleep and persist stay lossless.
 */

import { get } from "./connection.js";

export type SummaryLeafType = "semantic" | "episodic";

export interface SummaryLeafRef {
  type: SummaryLeafType;
  id: number;
  text?: string;
}

export type SummaryOfInput = string | Array<number | { type?: string; id: number }>;

export function estimateSummaryTokens(text: string): number {
  return Math.max(1, Math.ceil((text ?? "").length / 4));
}

export function serializeSummaryOf(value: SummaryOfInput | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const refs: Array<{ type: SummaryLeafType; id: number }> = [];
  for (const item of value) {
    if (typeof item === "number") {
      const id = Math.trunc(item);
      if (id > 0) refs.push({ type: "episodic", id });
      continue;
    }
    const id = Math.trunc(Number(item?.id));
    if (id > 0) {
      refs.push({
        type: item.type === "semantic" ? "semantic" : "episodic",
        id,
      });
    }
  }
  return refs.length === 0 ? null : JSON.stringify(refs);
}

/** Bare numbers default to episodic (REM distill). Prefer `{ type, id }`. */
export function parseSummaryOf(raw: string | null | undefined): SummaryLeafRef[] {
  if (!raw || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: SummaryLeafRef[] = [];
    for (const item of parsed) {
      if (typeof item === "number" && item > 0) {
        out.push({ type: "episodic", id: Math.trunc(item) });
      } else if (typeof item === "string" && /^\d+$/.test(item)) {
        out.push({ type: "episodic", id: Number(item) });
      } else if (item && typeof item === "object" && item.id != null) {
        const id = Math.trunc(Number(item.id));
        if (id > 0) {
          out.push({
            type: item.type === "semantic" ? "semantic" : "episodic",
            id,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

function dedupeSources(sources: SummaryLeafRef[]): SummaryLeafRef[] {
  const seen = new Set<string>();
  const out: SummaryLeafRef[] = [];
  for (const src of sources) {
    const id = Math.trunc(Number(src.id));
    if (id <= 0) continue;
    const type: SummaryLeafType = src.type === "semantic" ? "semantic" : "episodic";
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id, text: src.text });
  }
  return out;
}

export async function filterUnlinkedSources(sources: SummaryLeafRef[]): Promise<SummaryLeafRef[]> {
  const unique = dedupeSources(sources);
  if (unique.length === 0) return [];
  const db = await get();
  const existing = new Set<string>();
  for (const type of ["semantic", "episodic"] as const) {
    const ids = unique.filter((s) => s.type === type).map((s) => String(s.id));
    if (ids.length === 0) continue;
    const rows = await db.all(
      `SELECT leaf_id FROM brain_summary_tree
       WHERE kind = 'leaf' AND leaf_type = ? AND leaf_id IN (${ids.map(() => "?").join(",")})`,
      [type, ...ids],
    );
    for (const row of rows) {
      existing.add(`${type}:${String((row as { leaf_id: string }).leaf_id)}`);
    }
  }
  return unique.filter((s) => !existing.has(`${s.type}:${s.id}`));
}

async function insertLeaf(parentId: number, src: SummaryLeafRef): Promise<void> {
  const db = await get();
  const preview = (src.text ?? "").slice(0, 400);
  await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count)
     VALUES (?, 'leaf', ?, ?, ?, ?)`,
    [parentId, src.type, String(src.id), preview, estimateSummaryTokens(preview)],
  );
}

/**
 * Insert a summary node and leaf children that point at original rows.
 * Already-linked leaves are skipped so persist / sleep / five-tier are idempotent.
 */
export async function writeSummaryPointer(input: {
  text: string;
  sources: SummaryLeafRef[];
  parentId?: number | null;
}): Promise<{ nodeId: number; linked: number }> {
  const sources = await filterUnlinkedSources(input.sources);
  if (sources.length === 0) return { nodeId: 0, linked: 0 };

  const db = await get();
  const text = input.text ?? "";
  const inserted = await db.run(
    `INSERT INTO brain_summary_tree (parent_id, kind, text, token_count)
     VALUES (?, 'node', ?, ?)`,
    [input.parentId ?? null, text, estimateSummaryTokens(text)],
  );
  const nodeId = inserted.lastID ?? 0;
  if (nodeId <= 0) return { nodeId: 0, linked: 0 };

  let linked = 0;
  for (const src of sources) {
    await insertLeaf(nodeId, src);
    linked++;
  }
  return { nodeId, linked };
}

export async function listSummaryLeaves(nodeId: number): Promise<SummaryLeafRef[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT leaf_type, leaf_id, text FROM brain_summary_tree
     WHERE parent_id = ? AND kind = 'leaf'`,
    [nodeId],
  );
  const leaves: SummaryLeafRef[] = [];
  for (const row of rows) {
    const r = row as { leaf_type: string; leaf_id: string; text: string };
    const id = Number(r.leaf_id);
    if (id <= 0) continue;
    const type: SummaryLeafType = r.leaf_type === "semantic" ? "semantic" : "episodic";
    leaves.push({ type, id, text: r.text });
  }
  return leaves;
}

/**
 * Keep `brain_sessions.summary` as the string and point `summary_node_id` at a
 * tree node whose leaves are the session's original episodic rows.
 */
export async function ensureSessionSummaryNode(sessionId: string, text: string): Promise<number> {
  const db = await get();
  const session = await db.get<{ summary_node_id: number | null }>(
    "SELECT summary_node_id FROM brain_sessions WHERE id = ?",
    [sessionId],
  );
  const rows = (await db.all(
    "SELECT id, content FROM brain_episodic WHERE session_id = ? ORDER BY id",
    [sessionId],
  )) as { id: number; content: string }[];
  const sources: SummaryLeafRef[] = rows.map((r) => ({
    type: "episodic" as const,
    id: r.id,
    text: r.content,
  }));

  const existingId = Number(session?.summary_node_id ?? 0);
  if (existingId > 0) {
    const exists = await db.get("SELECT id FROM brain_summary_tree WHERE id = ?", [existingId]);
    if (exists) {
      await db.run(
        "UPDATE brain_summary_tree SET text = ?, token_count = ? WHERE id = ?",
        [text, estimateSummaryTokens(text), existingId],
      );
      for (const src of await filterUnlinkedSources(sources)) {
        await insertLeaf(existingId, src);
      }
      return existingId;
    }
  }

  if (sources.length === 0) {
    const inserted = await db.run(
      `INSERT INTO brain_summary_tree (kind, text, token_count) VALUES ('node', ?, ?)`,
      [text, estimateSummaryTokens(text)],
    );
    return inserted.lastID ?? 0;
  }

  const { nodeId } = await writeSummaryPointer({ text, sources });
  return nodeId;
}
