/**
 * MEM-03: additive theorem schema (stability, h/u, tombstones, summary tree,
 * attribution) without breaking older databases.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RetrievalFusion } from "../RetrievalFusion";
import type { DatabaseConnection } from "../../../../util/refreshIndex.js";
import { BRAIN_SCHEMA_VERSION, applyBrainPragmas, prepareBrainDb } from "./dbSafety";
import { createTables, createTheoremTables, migrateSchema } from "./schema";

const THEOREM_TABLES = ["brain_summary_tree", "brain_attribution"] as const;

const THEOREM_LEAF_COLUMNS = [
  "stability",
  "difficulty",
  "i0",
  "helpful_count",
  "unhelpful_count",
  "valid_from",
  "valid_to",
  "parent_id",
  "summary_of",
  "tombstoned_at",
  "tombstone_reason",
] as const;

const THEOREM_GRAPH_COLUMNS = ["valid_from", "valid_to", "canonical_id"] as const;

const OLD_SEMANTIC_COLUMNS = [
  "id",
  "category",
  "title",
  "content",
  "source_session_id",
  "keywords",
  "importance_score",
  "retrieval_count",
  "tier",
  "created_at",
  "last_accessed_at",
  "expires_at",
] as const;

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-theorem-schema-"));
  dbPath = path.join(dir, "brain.sqlite");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function openDb() {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await applyBrainPragmas(db);
  return db;
}

type Db = Awaited<ReturnType<typeof openDb>>;

async function tableNames(db: Db) {
  const rows = await db.all<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  return rows.map((r) => r.name);
}

async function columns(db: Db, table: string) {
  return (await db.all<{ name: string }[]>(`PRAGMA table_info(${table})`)).map((c) => c.name);
}

/** Pre-MEM-03 shape: today's tables minus theorem columns / tables. */
async function createLegacyBrain(db: Db) {
  await db.exec(`
    CREATE TABLE brain_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Session',
      workspace_directory TEXT NOT NULL DEFAULT '',
      project_id TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      message_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT DEFAULT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE brain_episodic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'user_message',
      role TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      importance_score REAL NOT NULL DEFAULT 0.5,
      emotional_valence TEXT NOT NULL DEFAULT 'neutral',
      salience REAL NOT NULL DEFAULT 0.5,
      tier TEXT NOT NULL DEFAULT 'hot',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES brain_sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE brain_semantic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT 'fact',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_session_id TEXT DEFAULT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      importance_score REAL NOT NULL DEFAULT 0.5,
      emotional_valence TEXT NOT NULL DEFAULT 'neutral',
      salience REAL NOT NULL DEFAULT 0.5,
      retrieval_count INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'hot',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT NULL,
      topic_id INTEGER DEFAULT NULL,
      task_id TEXT DEFAULT NULL,
      mismatch_count INTEGER NOT NULL DEFAULT 0,
      mismatch_until DATETIME DEFAULT NULL,
      mismatch_topic_id INTEGER DEFAULT NULL,
      FOREIGN KEY (source_session_id) REFERENCES brain_sessions(id) ON DELETE SET NULL
    );
    CREATE TABLE brain_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'custom',
      description TEXT NOT NULL DEFAULT '',
      properties TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.8,
      mention_count INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE brain_graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL,
      target_entity_id INTEGER NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'related',
      weight REAL NOT NULL DEFAULT 0.5,
      properties TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_entity_id) REFERENCES brain_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_entity_id) REFERENCES brain_entities(id) ON DELETE CASCADE
    );
  `);
}

describe("theorem schema (MEM-03)", () => {
  it("is created on a fresh database, and creation is idempotent", async () => {
    const db = await openDb();
    await createTables(db);
    await createTables(db);
    await migrateSchema(db);
    await migrateSchema(db);

    const names = await tableNames(db);
    expect(names).toEqual(expect.arrayContaining([...THEOREM_TABLES]));

    expect(await columns(db, "brain_semantic")).toEqual(expect.arrayContaining([...THEOREM_LEAF_COLUMNS]));
    expect(await columns(db, "brain_semantic")).toContain("inject_count");
    expect(await columns(db, "brain_episodic")).toEqual(expect.arrayContaining([...THEOREM_LEAF_COLUMNS]));
    expect(await columns(db, "brain_episodic")).not.toContain("inject_count");
    expect(await columns(db, "brain_sessions")).toEqual(expect.arrayContaining(["summary", "summary_node_id"]));
    expect(await columns(db, "brain_entities")).toEqual(expect.arrayContaining([...THEOREM_GRAPH_COLUMNS]));
    expect(await columns(db, "brain_graph_edges")).toEqual(expect.arrayContaining([...THEOREM_GRAPH_COLUMNS]));

    const treeCols = await columns(db, "brain_summary_tree");
    expect(treeCols).toEqual(
      expect.arrayContaining(["id", "parent_id", "kind", "leaf_type", "leaf_id", "text", "token_count", "created_at"]),
    );
    const attrCols = await columns(db, "brain_attribution");
    expect(attrCols).toEqual(
      expect.arrayContaining([
        "id",
        "turn_id",
        "session_id",
        "mem_type",
        "mem_id",
        "injected",
        "cited",
        "helpful",
        "channel",
        "score",
        "created_at",
      ]),
    );
    await db.close();
  });

  it("applies theorem defaults on a minimal insert", async () => {
    const db = await openDb();
    await createTables(db);
    await db.run("INSERT INTO brain_sessions (id) VALUES ('s1')");
    await db.run("INSERT INTO brain_semantic (title, content) VALUES ('keep', 'fact')");
    await db.run(
      "INSERT INTO brain_episodic (session_id, content) VALUES ('s1', 'hello')",
    );
    await db.run("INSERT INTO brain_entities (name) VALUES ('TypeScript')");
    const entity = await db.get<{ id: number }>("SELECT id FROM brain_entities WHERE name = 'TypeScript'");
    await db.run(
      "INSERT INTO brain_graph_edges (source_entity_id, target_entity_id) VALUES (?, ?)",
      [entity!.id, entity!.id],
    );

    const sem = await db.get<Record<string, unknown>>(
      "SELECT * FROM brain_semantic WHERE title = 'keep'",
    );
    expect(sem).toMatchObject({
      content: "fact",
      difficulty: 5,
      helpful_count: 0,
      unhelpful_count: 0,
      stability: null,
      i0: null,
      tombstoned_at: null,
      tombstone_reason: null,
      parent_id: null,
      summary_of: null,
      inject_count: 0,
    });

    const epi = await db.get<Record<string, unknown>>(
      "SELECT * FROM brain_episodic WHERE content = 'hello'",
    );
    expect(epi).toMatchObject({
      difficulty: 5,
      helpful_count: 0,
      unhelpful_count: 0,
      tombstoned_at: null,
    });

    const ent = await db.get<Record<string, unknown>>(
      "SELECT valid_from, valid_to, canonical_id FROM brain_entities WHERE name = 'TypeScript'",
    );
    expect(ent).toEqual({ valid_from: null, valid_to: null, canonical_id: null });
    await db.close();
  });

  it("adds columns and tables to a pre-MEM-03 database without touching its rows or version", async () => {
    const old = await openDb();
    await createLegacyBrain(old);
    await old.run("INSERT INTO brain_sessions (id, workspace_directory, project_id) VALUES ('s1', '/w', 'p')");
    await old.run(
      "INSERT INTO brain_semantic (title, content, importance_score, keywords) VALUES ('keep', 'fact', 0.8, 'alpha')",
    );
    await old.run(
      "INSERT INTO brain_episodic (session_id, content, importance_score) VALUES ('s1', 'old turn', 0.4)",
    );
    await old.run("INSERT INTO brain_entities (name, entity_type) VALUES ('TS', 'technology')");
    const entity = await old.get<{ id: number }>("SELECT id FROM brain_entities WHERE name = 'TS'");
    await old.run(
      "INSERT INTO brain_graph_edges (source_entity_id, target_entity_id, relationship) VALUES (?, ?, 'alias')",
      [entity!.id, entity!.id],
    );
    await old.exec(`PRAGMA user_version = ${BRAIN_SCHEMA_VERSION}`);
    await old.close();

    // Opening takes no pre-migration backup: the version did not change.
    const prep = await prepareBrainDb(dbPath);
    expect(prep.backupPath).toBeUndefined();
    expect(prep.fromVersion).toBe(BRAIN_SCHEMA_VERSION);

    const db = await openDb();
    expect(await tableNames(db)).not.toEqual(expect.arrayContaining([...THEOREM_TABLES]));
    expect(await columns(db, "brain_semantic")).not.toEqual(expect.arrayContaining(["stability", "helpful_count"]));

    await createTables(db);
    await migrateSchema(db);

    expect(await tableNames(db)).toEqual(expect.arrayContaining([...THEOREM_TABLES]));
    expect(await columns(db, "brain_semantic")).toEqual(expect.arrayContaining([...THEOREM_LEAF_COLUMNS]));
    expect(await columns(db, "brain_semantic")).toContain("inject_count");
    expect(await columns(db, "brain_episodic")).toEqual(expect.arrayContaining([...THEOREM_LEAF_COLUMNS]));
    expect(await columns(db, "brain_sessions")).toEqual(expect.arrayContaining(["summary", "summary_node_id"]));
    expect(await columns(db, "brain_entities")).toEqual(expect.arrayContaining([...THEOREM_GRAPH_COLUMNS]));
    expect(await columns(db, "brain_graph_edges")).toEqual(expect.arrayContaining([...THEOREM_GRAPH_COLUMNS]));

    const kept = await db.get<{
      title: string;
      content: string;
      importance_score: number;
      keywords: string;
      difficulty: number;
      helpful_count: number;
    }>("SELECT title, content, importance_score, keywords, difficulty, helpful_count FROM brain_semantic WHERE title = 'keep'");
    expect(kept).toEqual({
      title: "keep",
      content: "fact",
      importance_score: 0.8,
      keywords: "alpha",
      difficulty: 5,
      helpful_count: 0,
    });
    expect((await db.get<{ content: string }>("SELECT content FROM brain_episodic"))?.content).toBe("old turn");
    expect((await db.get<{ name: string }>("SELECT name FROM brain_entities"))?.name).toBe("TS");
    expect((await db.get<{ relationship: string }>("SELECT relationship FROM brain_graph_edges"))?.relationship).toBe(
      "alias",
    );

    const ver = await db.get<{ user_version: number }>("PRAGMA user_version");
    expect(ver?.user_version).toBe(BRAIN_SCHEMA_VERSION);
    expect(BRAIN_SCHEMA_VERSION).toBe(1);
    expect((await db.get<{ integrity_check: string }>("PRAGMA integrity_check"))?.integrity_check).toBe("ok");
    expect((await db.all("PRAGMA foreign_key_check")).length).toBe(0);
    await db.close();
  });

  it("lets an older writer keep using the pre-theorem column list", async () => {
    const db = await openDb();
    await createTables(db);
    await db.run("INSERT INTO brain_sessions (id) VALUES ('s1')");
    // Older Knox INSERTs name only the columns they knew about.
    await db.run(
      `INSERT INTO brain_semantic (${OLD_SEMANTIC_COLUMNS.filter((c) => c !== "id").join(", ")})
       VALUES ('fact', 'legacy title', 'legacy body', 's1', 'kw', 0.6, 3, 'hot', datetime('now'), datetime('now'), NULL)`,
    );
    const row = await db.get<{ title: string; content: string; retrieval_count: number; difficulty: number }>(
      "SELECT title, content, retrieval_count, difficulty FROM brain_semantic WHERE title = 'legacy title'",
    );
    expect(row).toEqual({
      title: "legacy title",
      content: "legacy body",
      retrieval_count: 3,
      difficulty: 5,
    });
    await db.close();
  });

  it("new tables are standalone: no foreign key into or out of the older tables", async () => {
    const db = await openDb();
    await createTables(db);
    for (const t of await tableNames(db)) {
      const fks = await db.all<{ table: string }[]>(`PRAGMA foreign_key_list(${t})`);
      for (const fk of fks) {
        if ((THEOREM_TABLES as readonly string[]).includes(t)) {
          expect(THEOREM_TABLES as readonly string[], `${t} references ${fk.table}`).toContain(fk.table);
        } else {
          expect(THEOREM_TABLES as readonly string[], `${t} references new table ${fk.table}`).not.toContain(fk.table);
        }
      }
    }
    await db.close();
  });

  it("accepts summary-tree pointers and attribution rows", async () => {
    const db = await openDb();
    await createTables(db);
    await db.run("INSERT INTO brain_sessions (id) VALUES ('s1')");
    await db.run("INSERT INTO brain_semantic (title, content) VALUES ('leaf', 'original')");
    const leaf = await db.get<{ id: number }>("SELECT id FROM brain_semantic WHERE title = 'leaf'");

    const parent = await db.run(
      "INSERT INTO brain_summary_tree (kind, text, token_count) VALUES ('node', 'session summary', 12)",
    );
    await db.run(
      "INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count) VALUES (?, 'leaf', 'semantic', ?, 'original', 4)",
      [parent.lastID, String(leaf!.id)],
    );
    await db.run(
      "INSERT INTO brain_attribution (turn_id, session_id, mem_type, mem_id, injected, cited, helpful) VALUES ('t1', 's1', 'semantic', ?, 1, 1, 1)",
      [String(leaf!.id)],
    );

    const child = await db.get<{ parent_id: number; leaf_type: string; leaf_id: string }>(
      "SELECT parent_id, leaf_type, leaf_id FROM brain_summary_tree WHERE kind = 'leaf'",
    );
    expect(child).toEqual({ parent_id: parent.lastID, leaf_type: "semantic", leaf_id: String(leaf!.id) });
    const attr = await db.get<{ injected: number; cited: number; helpful: number }>(
      "SELECT injected, cited, helpful FROM brain_attribution WHERE turn_id = 't1'",
    );
    expect(attr).toEqual({ injected: 1, cited: 1, helpful: 1 });
    await db.close();
  });

  it("keeps FTS5 content tables working after ALTER adds theorem columns", async () => {
    const db = await openDb();
    await createLegacyBrain(db);
    await RetrievalFusion.initFts5Tables(db as unknown as DatabaseConnection);
    await db.run("INSERT INTO brain_sessions (id) VALUES ('s1')");
    await db.run(
      "INSERT INTO brain_semantic (title, content, keywords) VALUES ('database migration', 'every migration needs a down script', 'migration')",
    );
    const before = await db.get<{ id: number }>(
      `SELECT rowid AS id FROM brain_semantic_fts WHERE brain_semantic_fts MATCH 'migration'`,
    );
    expect(before?.id).toBe(1);

    await expect(createTheoremTables(db)).resolves.toBeUndefined();
    await expect(createTables(db)).resolves.toBeUndefined();
    await migrateSchema(db);

    const after = await db.get<{ id: number }>(
      `SELECT rowid AS id FROM brain_semantic_fts WHERE brain_semantic_fts MATCH 'migration'`,
    );
    expect(after?.id).toBe(1);
    expect(
      (await db.get<{ content: string }>("SELECT content FROM brain_semantic WHERE title = 'database migration'"))
        ?.content,
    ).toBe("every migration needs a down script");
    await db.close();
  });

  it("are cleared by the real brain wipe", async () => {
    const prev = process.env.KNOX_GLOBAL_DIR;
    process.env.KNOX_GLOBAL_DIR = dir;
    try {
      const { get, close } = await import("./connection");
      const { wipeAll } = await import("./wipe");
      const live = await get();
      await live.run("INSERT INTO brain_summary_tree (kind, text) VALUES ('node', 'n')");
      await live.run(
        "INSERT INTO brain_attribution (turn_id, mem_type, mem_id, injected) VALUES ('t', 'semantic', '1', 1)",
      );
      expect((await live.get<{ n: number }>("SELECT COUNT(*) n FROM brain_summary_tree"))?.n).toBe(1);
      expect((await live.get<{ n: number }>("SELECT COUNT(*) n FROM brain_attribution"))?.n).toBe(1);

      const result = await wipeAll();
      expect(result.recreated).toBe(true);
      const fresh = await get();
      expect((await fresh.get<{ n: number }>("SELECT COUNT(*) n FROM brain_summary_tree"))?.n).toBe(0);
      expect((await fresh.get<{ n: number }>("SELECT COUNT(*) n FROM brain_attribution"))?.n).toBe(0);
      expect(await columns(fresh as unknown as Db, "brain_semantic")).toEqual(
        expect.arrayContaining([...THEOREM_LEAF_COLUMNS]),
      );
      await close();
    } finally {
      if (prev === undefined) {
        delete process.env.KNOX_GLOBAL_DIR;
      } else {
        process.env.KNOX_GLOBAL_DIR = prev;
      }
    }
  });
});
