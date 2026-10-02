/** Gzip compression for cold-tier content. */

import zlib from "zlib";
import { get } from "./connection.js";

// ── Cold Tier Compression ──────────────────────────────────────────────────

export const COMPRESS_PREFIX = "z:";

/**
 * Compress text content using gzip. Returns a base64-encoded string with prefix.
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

/**
 * Compress cold-tier semantic memories during consolidation.
 * Only compresses content over 200 chars that isn't already compressed.
 */
export async function compressColdTier(): Promise<number> {
  const db = await get();
  const rows = await db.all(
    `SELECT id, content FROM brain_semantic WHERE tier = 'cold' AND content NOT LIKE 'z:%' AND length(content) > 200`,
  );

  let compressed = 0;
  for (const row of rows) {
    const r = row as any;
    const compressedContent = compressContent(r.content);
    if (compressedContent !== r.content) {
      await db.run("UPDATE brain_semantic SET content = ? WHERE id = ?", [compressedContent, r.id]);
      compressed++;
    }
  }

  // Also compress cold episodic
  const epRows = await db.all(
    `SELECT id, content FROM brain_episodic WHERE tier = 'cold' AND content NOT LIKE 'z:%' AND length(content) > 200`,
  );
  for (const row of epRows) {
    const r = row as any;
    const compressedContent = compressContent(r.content);
    if (compressedContent !== r.content) {
      await db.run("UPDATE brain_episodic SET content = ? WHERE id = ?", [compressedContent, r.id]);
      compressed++;
    }
  }

  return compressed;
}
