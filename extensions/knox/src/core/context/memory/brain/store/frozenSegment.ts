/**
 * MEM-75 — Frozen postings live in a slower FTS segment.
 *
 * Live FTS is `content=` and must stay in sync with every row. Frozen rows
 * keep original content; a second `brain_*_fts_frozen` segment is the slower
 * channel so the tree can still route to them. Default retrieve skips Frozen.
 * Tiers change cost, never reachability.
 */

import { expandCjkForFts } from "../cjkFts.js";
import type { DatabaseConnection } from "../../../../util/refreshIndex.js";
import { get } from "./connection.js";
import { collectBindChunks, forBindChunks, sqlPlaceholders } from "./sqlChunks.js";
import type { MemoryLeafKind } from "./tombstone.js";

const LIVE_FTS: Record<MemoryLeafKind, string> = {
  semantic: "brain_semantic_fts",
  episodic: "brain_episodic_fts",
};

const FROZEN_FTS: Record<MemoryLeafKind, string> = {
  semantic: "brain_semantic_fts_frozen",
  episodic: "brain_episodic_fts_frozen",
};

const TABLES: Record<MemoryLeafKind, "brain_semantic" | "brain_episodic"> = {
  semantic: "brain_semantic",
  episodic: "brain_episodic",
};

type SemanticFtsRow = { id: number; title: string; content: string; keywords: string };
type EpisodicFtsRow = { id: number; content: string };

export async function ensureFrozenFtsTables(db: DatabaseConnection): Promise<void> {
  await db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS brain_semantic_fts_frozen USING fts5(
      title,
      content,
      keywords,
      tokenize='porter unicode61 remove_diacritics 2'
    )
  `);
  await db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS brain_episodic_fts_frozen USING fts5(
      content,
      tokenize='porter unicode61 remove_diacritics 2'
    )
  `);
}

/**
 * Live FTS is `content='brain_*'` (see RetrievalFusion). Manual
 * `INSERT … 'delete'` on those tables corrupts the index. Forget blanks
 * the row and the UPDATE trigger rewrites the posting; archive leaves the
 * posting until `rebuildFts5` excludes Frozen. This helper is a no-op.
 */
export async function dropLiveFtsPostings(
  _db: DatabaseConnection,
  _kind: MemoryLeafKind,
  _rows: Array<{ id: number; title?: string | null; content?: string | null; keywords?: string | null }>,
): Promise<void> {
  return;
}

export async function upsertFrozenFts(
  db: DatabaseConnection,
  kind: MemoryLeafKind,
  rows: Array<{ id: number; title?: string | null; content?: string | null; keywords?: string | null }>,
): Promise<void> {
  await ensureFrozenFtsTables(db);
  const fts = FROZEN_FTS[kind];
  for (const row of rows) {
    const id = Math.trunc(Number(row.id));
    if (id <= 0) continue;
    try {
      if (kind === "semantic") {
        await db.run(`INSERT INTO ${fts}(${fts}, rowid) VALUES ('delete', ?)`, [id]).catch(() => {});
        await db.run(
          `INSERT INTO ${fts}(rowid, title, content, keywords) VALUES (?, ?, ?, ?)`,
          [
            id,
            expandCjkForFts(row.title),
            expandCjkForFts(row.content),
            expandCjkForFts(row.keywords),
          ],
        );
      } else {
        await db.run(`INSERT INTO ${fts}(${fts}, rowid) VALUES ('delete', ?)`, [id]).catch(() => {});
        await db.run(
          `INSERT INTO ${fts}(rowid, content) VALUES (?, ?)`,
          [id, expandCjkForFts(row.content)],
        );
      }
    } catch {
      // Contentless FTS insert is best-effort.
    }
  }
}

export async function dropFrozenFts(
  db: DatabaseConnection,
  kind: MemoryLeafKind,
  ids: number[],
): Promise<void> {
  const fts = FROZEN_FTS[kind];
  let present: Set<number>;
  try {
    present = await loadFrozenFtsIds(db, kind);
  } catch {
    return;
  }
  const toDrop = ids.map((id) => Math.trunc(Number(id))).filter((id) => id > 0 && present.has(id));
  if (toDrop.length === 0) return;
  await forBindChunks(toDrop, 0, async (chunk) => {
    for (const id of chunk) {
      try {
        await db.run(`INSERT INTO ${fts}(${fts}, rowid) VALUES ('delete', ?)`, [id]);
      } catch {
        // Table missing or row already gone.
      }
    }
  });
}

async function loadLeafRows(
  db: DatabaseConnection,
  kind: MemoryLeafKind,
  ids: number[],
): Promise<Array<{ id: number; title?: string | null; content?: string | null; keywords?: string | null }>> {
  if (ids.length === 0) return [];
  const table = TABLES[kind];
  const cols = kind === "semantic" ? "id, title, content, keywords" : "id, content";
  return collectBindChunks(ids, 0, (chunk) =>
    db.all(
      `SELECT ${cols} FROM ${table} WHERE id IN (${sqlPlaceholders(chunk.length)}) AND tombstoned_at IS NULL`,
      chunk,
    ) as Promise<Array<{ id: number; title?: string | null; content?: string | null; keywords?: string | null }>>,
  );
}

/** Move these ids into the Frozen FTS segment and drop live postings. */
export async function syncFrozenSegmentForIds(
  kind: MemoryLeafKind,
  ids: number[],
): Promise<void> {
  const unique = [...new Set(ids.map((id) => Math.trunc(Number(id))).filter((id) => id > 0))];
  if (unique.length === 0) return;
  const db = await get();
  const rows = await loadLeafRows(db, kind, unique);
  if (rows.length === 0) return;
  await upsertFrozenFts(db, kind, rows);
}

/** Move thawed ids back to the live FTS segment. */
export async function thawFrozenSegmentForIds(
  kind: MemoryLeafKind,
  ids: number[],
): Promise<void> {
  const unique = [...new Set(ids.map((id) => Math.trunc(Number(id))).filter((id) => id > 0))];
  if (unique.length === 0) return;
  const db = await get();
  await dropFrozenFts(db, kind, unique);
  const rows = await loadLeafRows(db, kind, unique);
  const fts = LIVE_FTS[kind];
  for (const row of rows) {
    try {
      if (kind === "semantic") {
        await db.run(
          `INSERT INTO ${fts}(rowid, title, content, keywords) VALUES (?, ?, ?, ?)`,
          [
            row.id,
            expandCjkForFts(row.title),
            expandCjkForFts(row.content),
            expandCjkForFts(row.keywords),
          ],
        );
      } else {
        await db.run(
          `INSERT INTO ${fts}(rowid, content) VALUES (?, ?)`,
          [row.id, expandCjkForFts(row.content)],
        );
      }
    } catch {
      // Live trigger may already have re-inserted after the thaw UPDATE.
    }
  }
}

/**
 * Align Frozen FTS with stored tiers. Live FTS keeps hot/warm/cold/active;
 * Frozen rows live only in the slower segment.
 */
export async function syncFrozenSegment(
  db?: DatabaseConnection,
): Promise<{ frozen: number; thawed: number }> {
  const conn = db ?? (await get());
  await ensureFrozenFtsTables(conn);

  const frozenSemantic = (await conn.all(
    `SELECT id, title, content, keywords FROM brain_semantic
     WHERE tombstoned_at IS NULL AND tier = 'frozen'`,
  )) as SemanticFtsRow[];
  const frozenEpisodic = (await conn.all(
    `SELECT id, content FROM brain_episodic
     WHERE tombstoned_at IS NULL AND tier = 'frozen'`,
  )) as EpisodicFtsRow[];

  await upsertFrozenFts(conn, "semantic", frozenSemantic);
  await upsertFrozenFts(conn, "episodic", frozenEpisodic);

  const liveSemantic = (await conn.all(
    `SELECT id FROM brain_semantic
     WHERE tombstoned_at IS NULL AND tier != 'frozen'`,
  )) as Array<{ id: number }>;
  const liveEpisodic = (await conn.all(
    `SELECT id FROM brain_episodic
     WHERE tombstoned_at IS NULL AND tier != 'frozen'`,
  )) as Array<{ id: number }>;
  await dropFrozenFts(conn, "semantic", liveSemantic.map((r) => Number(r.id)));
  await dropFrozenFts(conn, "episodic", liveEpisodic.map((r) => Number(r.id)));

  return {
    frozen: frozenSemantic.length + frozenEpisodic.length,
    thawed: liveSemantic.length + liveEpisodic.length,
  };
}

export async function rebuildFrozenFts(db: DatabaseConnection): Promise<{ semantic: number; episodic: number }> {
  await db.exec(`DROP TABLE IF EXISTS brain_semantic_fts_frozen`);
  await db.exec(`DROP TABLE IF EXISTS brain_episodic_fts_frozen`);
  await ensureFrozenFtsTables(db);
  const sem = (await db.all(
    `SELECT id, title, content, keywords FROM brain_semantic
     WHERE tombstoned_at IS NULL AND tier = 'frozen'`,
  )) as SemanticFtsRow[];
  const ep = (await db.all(
    `SELECT id, content FROM brain_episodic
     WHERE tombstoned_at IS NULL AND tier = 'frozen'`,
  )) as EpisodicFtsRow[];
  await upsertFrozenFts(db, "semantic", sem);
  await upsertFrozenFts(db, "episodic", ep);
  return { semantic: sem.length, episodic: ep.length };
}

/** Rowids present in the Frozen FTS segment. */
export async function loadFrozenFtsIds(
  db: DatabaseConnection,
  kind: MemoryLeafKind,
): Promise<Set<number>> {
  const fts = FROZEN_FTS[kind];
  try {
    const rows = (await db.all(`SELECT rowid AS id FROM ${fts}`)) as Array<{ id: number }>;
    return new Set(rows.map((r) => Number(r.id)).filter((id) => id > 0));
  } catch {
    return new Set();
  }
}
