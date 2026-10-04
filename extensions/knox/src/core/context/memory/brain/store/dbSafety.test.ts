import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BRAIN_SCHEMA_VERSION,
  backupsDir,
  prepareBrainDb,
} from "./dbSafety";
import { createTables, migrateSchema } from "./schema";
import { writeFileAtomic } from "../../../../util/atomicWrite";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-brain-"));
  dbPath = path.join(dir, "brain.sqlite");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function makeLegacyDb() {
  // A 1.138.x / 2.0.0-beta style DB: user_version 0, columns added later are missing.
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec(
    "CREATE TABLE brain_sessions (id TEXT PRIMARY KEY, workspace_directory TEXT, created_at DATETIME)",
  );
  await db.run(
    "INSERT INTO brain_sessions (id, workspace_directory) VALUES ('s1', '/work/a')",
  );
  await db.close();
}

describe("prepareBrainDb", () => {
  it("is a no-op for a missing database", async () => {
    const r = await prepareBrainDb(dbPath);
    expect(r.backupPath).toBeUndefined();
    expect(r.corruptPath).toBeUndefined();
  });

  it("backs up an unversioned database, and migration then preserves its rows", async () => {
    await makeLegacyDb();
    const r = await prepareBrainDb(dbPath);
    expect(r.fromVersion).toBe(0);
    expect(r.backupPath && fs.existsSync(r.backupPath)).toBe(true);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await createTables(db);
    await migrateSchema(db);
    const row = await db.get<{ id: string; project_id: string }>(
      "SELECT id, project_id FROM brain_sessions WHERE id = 's1'",
    );
    expect(row?.id).toBe("s1");
    expect(row?.project_id).toBeTruthy();
    await db.close();

    // The backup still has the pre-migration shape.
    const bak = await open({ filename: r.backupPath!, driver: sqlite3.Database });
    const cols = await bak.all("PRAGMA table_info(brain_sessions)");
    expect(cols.some((c: any) => c.name === "project_id")).toBe(false);
    await bak.close();
  });

  it("does not back up a database already at the current version", async () => {
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.exec(`PRAGMA user_version = ${BRAIN_SCHEMA_VERSION}`);
    await db.exec("CREATE TABLE t (x)");
    await db.close();
    const r = await prepareBrainDb(dbPath);
    expect(r.backupPath).toBeUndefined();
    expect(fs.existsSync(backupsDir(dbPath))).toBe(false);
  });

  it("keeps only the newest backups", async () => {
    await makeLegacyDb();
    for (let i = 0; i < 5; i++) {
      await prepareBrainDb(dbPath);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(fs.readdirSync(backupsDir(dbPath)).length).toBe(3);
  });

  it("moves a corrupt database aside instead of using it", async () => {
    fs.writeFileSync(dbPath, "this is definitely not a sqlite database".repeat(50));
    const r = await prepareBrainDb(dbPath);
    expect(r.corruptPath && fs.existsSync(r.corruptPath)).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});

describe("writeFileAtomic", () => {
  it("replaces content and leaves no temp files", () => {
    const f = path.join(dir, "sessions.json");
    writeFileAtomic(f, "[1]");
    writeFileAtomic(f, "[1,2]");
    expect(fs.readFileSync(f, "utf8")).toBe("[1,2]");
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the old content if the write fails", () => {
    const f = path.join(dir, "s.json");
    writeFileAtomic(f, "old");
    expect(() => writeFileAtomic(f, { bad: true } as unknown as string)).toThrow();
    expect(fs.readFileSync(f, "utf8")).toBe("old");
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("WAL handling", () => {
  it("removes -wal/-shm files that have no main database", async () => {
    fs.writeFileSync(dbPath + "-wal", "junk");
    fs.writeFileSync(dbPath + "-shm", "junk");
    await prepareBrainDb(dbPath);
    expect(fs.existsSync(dbPath + "-wal")).toBe(false);
    expect(fs.existsSync(dbPath + "-shm")).toBe(false);
  });

  it("recovers committed rows from a WAL left by a crash", async () => {
    const { applyBrainPragmas } = await import("./dbSafety");
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await applyBrainPragmas(db);
    await db.exec("PRAGMA wal_autocheckpoint = 0;"); // keep everything in the WAL
    await db.exec("CREATE TABLE t (v TEXT)");
    await db.run("INSERT INTO t VALUES ('committed')");
    // Simulate a crash: copy main + wal while the connection is still open.
    const crashDir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-crash-"));
    const copy = path.join(crashDir, "brain.sqlite");
    fs.copyFileSync(dbPath, copy);
    fs.copyFileSync(dbPath + "-wal", copy + "-wal");
    await db.close();
    try {
      await prepareBrainDb(copy);
      const re = await open({ filename: copy, driver: sqlite3.Database });
      expect((await re.all("SELECT v FROM t")).map((r: any) => r.v)).toEqual(["committed"]);
      await re.close();
    } finally {
      fs.rmSync(crashDir, { recursive: true, force: true });
    }
  });
});

describe("size cap", () => {
  it("does nothing under the cap and prunes oldest episodic rows over it", async () => {
    const { enforceBrainSizeCap } = await import("./dbSafety");
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.exec("PRAGMA journal_mode = WAL;");
    await createTables(db);
    await db.run("INSERT INTO brain_sessions (id) VALUES ('s')");
    await db.run(
      "INSERT INTO brain_semantic (title, content) VALUES ('keep', 'curated fact')",
    );
    const blob = "x".repeat(2000);
    await db.exec("BEGIN");
    for (let i = 0; i < 1500; i++) {
      await db.run(
        "INSERT INTO brain_episodic (session_id, content, created_at) VALUES ('s', ?, datetime('2020-01-01', '+' || ? || ' seconds'))",
        [`${i}:${blob}`, i],
      );
    }
    await db.exec("COMMIT");

    const big = await enforceBrainSizeCap(db, dbPath, 100 * 1024 * 1024);
    expect(big.capped).toBe(false);

    const cap = 6 * 1024 * 1024;
    const r = await enforceBrainSizeCap(db, dbPath, cap);
    expect(r.capped).toBe(true);
    expect(r.deleted).toBeGreaterThan(0);
    expect(r.after).toBeLessThan(r.before);
    const left = (await db.all("SELECT content FROM brain_episodic ORDER BY created_at")) as { content: string }[];
    expect(left.length).toBeLessThan(1500);
    expect(left[left.length - 1].content.startsWith("1499:")).toBe(true); // newest survives
    expect((await db.get("SELECT COUNT(*) n FROM brain_semantic")) as any).toEqual({ n: 1 });
    await db.close();
  });

  it("KNOX_BRAIN_MAX_BYTES=0 disables the cap", async () => {
    const { brainMaxBytes } = await import("./dbSafety");
    process.env.KNOX_BRAIN_MAX_BYTES = "0";
    try {
      expect(brainMaxBytes()).toBe(0);
    } finally {
      delete process.env.KNOX_BRAIN_MAX_BYTES;
    }
  });
});
