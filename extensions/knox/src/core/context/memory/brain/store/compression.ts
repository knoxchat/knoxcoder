/** Gzip helpers for legacy `z:` rows; MEM-05 compression writes pointers. */

import zlib from "zlib";
import { get } from "./connection.js";
import { writeSummaryPointer, type SummaryLeafRef, type SummaryLeafType } from "./summaryTree.js";

// ── Cold Tier Compression ──────────────────────────────────────────────────

export const COMPRESS_PREFIX = "z:";

/**
 * Compress text content using gzip. Returns a base64-encoded string with prefix.
 * Used only as a decoder/encoder helper. New persist/sleep paths must not
 * replace leaf `content` with this string (MEM-05).
 */
export function compressContent(content: string): string {
  if (content.length < 200) return content; // Too small to benefit
  try {
    const compressed = zlib.gzipSync(Buffer.from(content, "utf-8") as Uint8Array);
    return COMPRESS_PREFIX + (compressed as Buffer).toString("base64");
  } catch {
    return content;
  }
}

/**
 * Decompress content if it was compressed.
 */
export function decompressContent(content: string): string {
  if (!content.startsWith(COMPRESS_PREFIX)) return content;
  try {
    const buf = Buffer.from(content.substring(COMPRESS_PREFIX.length), "base64");
    return zlib.gunzipSync(buf as Uint8Array).toString("utf-8");
  } catch {
    return content;
  }
}

const LEAF_TABLE: Record<SummaryLeafType, "brain_semantic" | "brain_episodic"> = {
  semantic: "brain_semantic",
  episodic: "brain_episodic",
};

const SESSION_COL: Record<SummaryLeafType, string> = {
  semantic: "source_session_id",
  episodic: "session_id",
};

/**
 * Write summary-tree pointers for long leaves in the given tiers.
 * Leaves keep their original `content`. Gzip may still decode legacy `z:`
 * rows; it is not written back over the only copy.
 */
export async function writeCompressionPointers(tiers: string[] = ["cold"]): Promise<number> {
  if (tiers.length === 0) return 0;
  const semantic = await pointerizeTierLeaves("semantic", tiers);
  const episodic = await pointerizeTierLeaves("episodic", tiers);
  return semantic + episodic;
}

async function pointerizeTierLeaves(
  kind: SummaryLeafType,
  tiers: string[],
): Promise<number> {
  const db = await get();
  const table = LEAF_TABLE[kind];
  const sessionCol = SESSION_COL[kind];
  const tierPlaceholders = tiers.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT id, content, ${sessionCol} AS session_key FROM ${table}
     WHERE tier IN (${tierPlaceholders})
     AND length(content) > 200
     AND CAST(id AS TEXT) NOT IN (
       SELECT leaf_id FROM brain_summary_tree
       WHERE kind = 'leaf' AND leaf_type = ?
     )`,
    [...tiers, kind],
  );

  const groups = new Map<string, SummaryLeafRef[]>();
  const digests = new Map<string, string[]>();
  for (const row of rows) {
    const r = row as { id: number; content: string; session_key: string | null };
    const original = decompressContent(r.content ?? "");
    const sessionKey = r.session_key && String(r.session_key).length > 0
      ? String(r.session_key)
      : `lone:${kind}`;
    const list = groups.get(sessionKey) ?? [];
    list.push({ type: kind, id: r.id, text: original.slice(0, 400) });
    groups.set(sessionKey, list);
    const digest = digests.get(sessionKey) ?? [];
    digest.push(original.slice(0, 200));
    digests.set(sessionKey, digest);
  }

  let linked = 0;
  for (const [sessionKey, sources] of groups) {
    if (sources.length === 0) continue;
    const digest = (digests.get(sessionKey) ?? []).join("\n");
    const text = `Pointer summary (${kind}, ${sources.length} leaves)\n${digest}`.slice(0, 2000);
    const result = await writeSummaryPointer({ text, sources });
    linked += result.linked;
  }
  return linked;
}

/**
 * Compress cold-tier semantic / episodic memories during consolidation.
 * MEM-05: writes summary-tree pointers; does not UPDATE leaf content.
 */
export async function compressColdTier(): Promise<number> {
  return writeCompressionPointers(["cold"]);
}
