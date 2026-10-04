/**
 * Memory Brain data safety: schema version, pre-migration backup, corruption recovery.
 *
 * `PRAGMA user_version` records the schema version. Before any migration of an existing
 * database (user_version below BRAIN_SCHEMA_VERSION) the file is copied to
 * `backups/` next to it, keeping the newest few. A database that fails `quick_check`
 * (or cannot be opened) is moved aside as `*.corrupt-<ts>` so a fresh one can be created.
 */

import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

import { brainState } from "./state.js";

/** Bump when `migrateSchema` gains a step. 0 = created before versioning (1.138.x, 2.0.0-beta). */
export const BRAIN_SCHEMA_VERSION = 1;
const KEEP_BACKUPS = 3;

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Read `PRAGMA user_version` and `quick_check` without running migrations. */
async function inspect(
  dbPath: string,
): Promise<{ version: number; ok: boolean }> {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  try {
    await db.exec("PRAGMA busy_timeout = 5000;");
    const check = await db.get<{ quick_check: string }>("PRAGMA quick_check(1)");
    const ver = await db.get<{ user_version: number }>("PRAGMA user_version");
    return { version: ver?.user_version ?? 0, ok: check?.quick_check === "ok" };
  } finally {
    await db.close().catch(() => {});
  }
}

function moveAside(dbPath: string): string {
  const dest = `${dbPath}.corrupt-${stamp()}`;
  fs.renameSync(dbPath, dest);
  for (const ext of ["-wal", "-shm"]) {
    if (fs.existsSync(dbPath + ext)) {
      try {
        fs.renameSync(dbPath + ext, dest + ext);
      } catch {}
    }
  }
  return dest;
}

export function backupsDir(dbPath: string): string {
  return path.join(path.dirname(dbPath), "backups");
}

function pruneBackups(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite"))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {}
  }
}

/** Copy the database (after folding in the WAL) to `backups/`. Returns the backup path. */
async function backup(dbPath: string, fromVersion: number): Promise<string> {
  const dir = backupsDir(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `brain-v${fromVersion}-${stamp()}.sqlite`);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  try {
    await db.exec("PRAGMA busy_timeout = 5000;");
    await db.exec("PRAGMA wal_checkpoint(TRUNCATE);").catch(() => {});
    await db.run("VACUUM INTO ?", [dest]);
  } finally {
    await db.close().catch(() => {});
  }
  pruneBackups(dir);
  return dest;
}

export interface PrepareResult {
  /** Backup taken before migrating, if any. */
  backupPath?: string;
  /** Corrupt file that was moved aside, if any. */
  corruptPath?: string;
  fromVersion: number;
}

/**
 * Run before opening the Brain for real. Safe to call when the file does not exist.
 * Never throws: on failure the normal open path proceeds and reports its own error.
 */
export async function prepareBrainDb(dbPath: string): Promise<PrepareResult> {
  if (!fs.existsSync(dbPath)) {
    removeOrphanWal(dbPath);
    return { fromVersion: BRAIN_SCHEMA_VERSION };
  }
  let info: { version: number; ok: boolean } | undefined;
  try {
    info = await inspect(dbPath);
  } catch (e) {
    // Only definite corruption moves the file. Busy/locked (another window) or any
    // other transient error must leave a healthy database alone.
    const code = String((e as { code?: string })?.code ?? "");
    if (code !== "SQLITE_CORRUPT" && code !== "SQLITE_NOTADB") {
      return { fromVersion: BRAIN_SCHEMA_VERSION };
    }
  }
  if (!info || !info.ok) {
    const corruptPath = moveAside(dbPath);
    return { corruptPath, fromVersion: 0 };
  }
  if (info.version < BRAIN_SCHEMA_VERSION) {
    try {
      const backupPath = await backup(dbPath, info.version);
      return { backupPath, fromVersion: info.version };
    } catch {
      return { fromVersion: info.version };
    }
  }
  return { fromVersion: info.version };
}

interface Db {
  exec(sql: string): Promise<unknown>;
  run(sql: string, ...params: unknown[]): Promise<{ changes?: number }>;
  get<T = unknown>(sql: string, ...params: unknown[]): Promise<T | undefined>;
}

/** Default cap on `brain.sqlite` (+ WAL). Override with `KNOX_BRAIN_MAX_BYTES`; `0` disables. */
export const BRAIN_DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

export function brainMaxBytes(): number {
  const raw = process.env.KNOX_BRAIN_MAX_BYTES;
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : BRAIN_DEFAULT_MAX_BYTES;
  }
  const fromConfig = brainState.config.max_bytes;
  if (typeof fromConfig === "number" && Number.isFinite(fromConfig) && fromConfig >= 0) {
    return Math.floor(fromConfig);
  }
  return BRAIN_DEFAULT_MAX_BYTES;
}

/** Overlay a user-visible cap (VS Code setting or yaml) onto in-memory config. Env still wins. */
export function applyBrainMaxBytesSetting(raw: unknown): void {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return;
  }
  brainState.config.max_bytes = Math.floor(raw);
}

let enabledOverlay: boolean | undefined;
let workspaceEnabledOverlay: boolean | undefined;

export function applyBrainEnabledSetting(raw: unknown): void {
  if (typeof raw === "boolean") {
    enabledOverlay = raw;
  }
}

export function applyBrainWorkspaceEnabledSetting(raw: unknown): void {
  if (typeof raw === "boolean") {
    workspaceEnabledOverlay = raw;
  }
}

/** Global + workspace switches. Env `KNOX_BRAIN_ENABLED=0` wins. */
export function isBrainEnabled(): boolean {
  const env = process.env.KNOX_BRAIN_ENABLED?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off") {
    return false;
  }
  if (enabledOverlay === false || workspaceEnabledOverlay === false) {
    return false;
  }
  return true;
}

/**
 * Remove `-wal` / `-shm` files whose main database is gone. SQLite would otherwise
 * try to replay a log that belongs to a different (deleted or moved) database.
 * A WAL next to an existing DB is left alone: SQLite replays it on open, which is
 * how a crash is recovered.
 */
export function removeOrphanWal(dbPath: string): string[] {
  if (fs.existsSync(dbPath)) return [];
  const removed: string[] = [];
  for (const ext of ["-wal", "-shm"]) {
    const p = dbPath + ext;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
        removed.push(p);
      } catch {}
    }
  }
  return removed;
}

/** Connection pragmas: WAL with bounded growth. */
export async function applyBrainPragmas(db: Db): Promise<void> {
  await db.exec("PRAGMA busy_timeout = 5000;");
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA synchronous = NORMAL;");
  await db.exec("PRAGMA wal_autocheckpoint = 1000;");
  await db.exec(`PRAGMA journal_size_limit = ${64 * 1024 * 1024};`);
  await db.exec("PRAGMA foreign_keys = ON;");
}

function sizeOnDisk(dbPath: string): number {
  let total = 0;
  for (const ext of ["", "-wal"]) {
    try {
      total += fs.statSync(dbPath + ext).size;
    } catch {}
  }
  return total;
}

export interface SizeCapResult {
  before: number;
  after: number;
  deleted: number;
  capped: boolean;
}

/**
 * Keep the database under `maxBytes`. Folds the WAL in first, then deletes the
 * least valuable rows in passes (audit log, expired facts, oldest episodic turns
 * of finished sessions) and VACUUMs. Curated knowledge (semantic facts that have
 * not expired, entities, procedures) is never pruned here.
 */
export async function enforceBrainSizeCap(
  db: Db,
  dbPath: string,
  maxBytes: number = brainMaxBytes(),
): Promise<SizeCapResult> {
  const before = sizeOnDisk(dbPath);
  if (maxBytes <= 0 || before <= maxBytes) {
    return { before, after: before, deleted: 0, capped: false };
  }
  await db.exec("PRAGMA wal_checkpoint(TRUNCATE);").catch(() => {});
  let deleted = 0;
  const tryRun = async (sql: string): Promise<number> => {
    try {
      return (await db.run(sql)).changes ?? 0;
    } catch {
      return 0;
    }
  };
  const used = async (): Promise<number> => {
    const pc = await db.get<{ n: number }>("PRAGMA page_count");
    const fl = await db.get<{ n: number }>("PRAGMA freelist_count");
    const ps = await db.get<{ n: number }>("PRAGMA page_size");
    const pages = (pc as any)?.page_count ?? pc?.n ?? 0;
    const free = (fl as any)?.freelist_count ?? fl?.n ?? 0;
    const size = (ps as any)?.page_size ?? ps?.n ?? 4096;
    return (pages - free) * size;
  };

  // Pass 1: audit log and expired facts.
  deleted += await tryRun("DELETE FROM brain_audit_log");
  deleted += await tryRun(
    "DELETE FROM brain_semantic WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP",
  );
  // Pass 2: oldest episodic turns, 20% at a time, until the live data fits.
  for (let i = 0; i < 20 && (await used()) > maxBytes * 0.9; i++) {
    const n = await tryRun(`
      DELETE FROM brain_episodic WHERE id IN (
        SELECT id FROM brain_episodic ORDER BY created_at ASC, id ASC
        LIMIT MAX(100, (SELECT COUNT(*) / 5 FROM brain_episodic))
      )`);
    if (n === 0) break;
    deleted += n;
  }
  await db.exec("PRAGMA wal_checkpoint(TRUNCATE);").catch(() => {});
  if (deleted > 0) {
    await db.exec("VACUUM;").catch(() => {});
    await db.exec("PRAGMA wal_checkpoint(TRUNCATE);").catch(() => {});
  }
  return { before, after: sizeOnDisk(dbPath), deleted, capped: true };
}

export async function stampBrainVersion(db: {
  exec(sql: string): Promise<unknown>;
}): Promise<void> {
  await db.exec(`PRAGMA user_version = ${BRAIN_SCHEMA_VERSION};`);
}
