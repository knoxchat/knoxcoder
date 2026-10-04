/** Database lifecycle — singleton connection, busy timeout, WAL. */

import fs from "fs";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import type { DatabaseConnection } from "../../../../util/refreshIndex.js";
import { getMemoryBrainSqlitePath } from "../../../../util/paths.js";
import { RetrievalFusion } from "../RetrievalFusion.js";
import { loadConfig } from "./config.js";
import { createTables, migrateSchema } from "./schema.js";
import { brainState } from "./state.js";
import { withFileLock } from "../../../../util/fileLock.js";
import { applyBrainPragmas, enforceBrainSizeCap, prepareBrainDb, stampBrainVersion } from "./dbSafety.js";

/** True after the first successful `get()` in this process. */
export function isOpen(): boolean {
  return brainState.db !== null;
}

export async function get(): Promise<DatabaseConnection> {
  const dbPath = getMemoryBrainSqlitePath();
  if (brainState.db && fs.existsSync(dbPath)) {
    return brainState.db;
  }
  if (brainState.initPromise) {
    return brainState.initPromise;
  }

  brainState.initPromise = (async () => {
    try {
      // Backup / corruption move-aside / schema migration must not run in two
      // windows at once (the second would back up or quarantine a DB the first
      // has open). Steady-state access is left to SQLite's WAL + busy_timeout.
      const db = await withFileLock(`${dbPath}.init.lock`, async () => {
        await prepareBrainDb(dbPath);
        const opened = await open({
          filename: dbPath,
          driver: sqlite3.Database,
        });

        await applyBrainPragmas(opened);
        await createTables(opened);
        await migrateSchema(opened);
        await stampBrainVersion(opened);
        // Opening replayed any WAL left by a crash; fold it into the main file.
        await opened.exec("PRAGMA wal_checkpoint(TRUNCATE);").catch(() => {});
        return opened;
      });
      await RetrievalFusion.initFts5Tables(db).catch(() => {
        // FTS5 might not be available in all SQLite builds — degrade gracefully
      });
      // Publish only after the schema is ready so concurrent callers never
      // see a half-initialized database.
      brainState.db = db;
      await loadConfig();
      try {
        const { CheckpointManager } = await import("../CheckpointManager.js");
        await CheckpointManager.hydrateFromStore();
      } catch {
        // Strategy hydrate is best-effort on first open.
      }
      const { KnowledgeGraph } = await import("../KnowledgeGraph.js");
      await KnowledgeGraph.enforceEntityCap().catch(() => {});
      // FTS triggers exist by now, so pruned rows leave the indexes too.
      await enforceBrainSizeCap(db, dbPath).catch(() => {});

      return db;
    } finally {
      brainState.initPromise = null;
    }
  })();

  return brainState.initPromise;
}
