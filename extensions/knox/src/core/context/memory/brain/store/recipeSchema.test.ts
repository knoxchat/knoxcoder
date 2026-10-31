import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BRAIN_SCHEMA_VERSION, applyBrainPragmas, prepareBrainDb } from "./dbSafety";
import { createRecipeTables, createTables, migrateSchema } from "./schema";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipes-"));
  dbPath = path.join(dir, "brain.sqlite");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function openDb() {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await applyBrainPragmas(db);
  return db;
}

async function tableNames(db: Awaited<ReturnType<typeof openDb>>) {
  const rows = await db.all<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  return rows.map((r) => r.name);
}

describe("recipe tables (MC-10)", () => {
  it("are created on a fresh database, and creation is idempotent", async () => {
    const db = await openDb();
    await createTables(db);
    await createTables(db);
    await migrateSchema(db);
    const names = await tableNames(db);
    expect(names).toContain("brain_recipes");
    expect(names).toContain("brain_recipe_steps");
    expect(names).toContain("brain_recipe_lex");
    expect(names).toContain("brain_recipes_fts");
    await db.close();
  });

  it("are added to an existing database without touching its rows or version", async () => {
    // Pre-recipe database: every table except the recipe ones, with data.
    const old = await openDb();
    await createTables(old);
    await old.exec("DROP TABLE brain_recipe_steps; DROP TABLE brain_recipes;");
    await old.run("INSERT INTO brain_sessions (id, workspace_directory, project_id) VALUES ('s1', '/w', 'p')");
    await old.run("INSERT INTO brain_semantic (title, content) VALUES ('keep', 'fact')");
    await old.exec(`PRAGMA user_version = ${BRAIN_SCHEMA_VERSION}`);
    await old.close();

    // Opening takes no pre-migration backup: the version did not change.
    const prep = await prepareBrainDb(dbPath);
    expect(prep.backupPath).toBeUndefined();

    const db = await openDb();
    expect(await tableNames(db)).not.toContain("brain_recipes");
    await createTables(db);
    await migrateSchema(db);
    expect(await tableNames(db)).toEqual(
      expect.arrayContaining(["brain_recipes", "brain_recipe_steps", "brain_recipe_lex", "brain_recipes_fts"]),
    );
    expect(
      (await db.get<{ content: string }>("SELECT content FROM brain_semantic WHERE title = 'keep'"))?.content,
    ).toBe("fact");
    expect((await db.get<{ id: string }>("SELECT id FROM brain_sessions"))?.id).toBe("s1");
    const ver = await db.get<{ user_version: number }>("PRAGMA user_version");
    expect(ver?.user_version).toBe(BRAIN_SCHEMA_VERSION);
    await db.close();
  });

  it("applies defaults, and cascades steps when a recipe is deleted", async () => {
    const db = await openDb();
    await createTables(db);
    await db.run("INSERT INTO brain_recipes (id) VALUES ('r1')");
    const r = await db.get<Record<string, unknown>>("SELECT * FROM brain_recipes WHERE id = 'r1'");
    expect(r).toMatchObject({
      status: "candidate",
      scope: "project",
      oracle_kind: "",
      replay_count: 0,
      ok_count: 0,
      reverted_count: 0,
      failed_verify_count: 0,
      helpful_count: 0,
      unhelpful_count: 0,
      slots: "[]",
      preconditions: "[]",
    });
    await db.run(
      "INSERT INTO brain_recipe_steps (recipe_id, seq, kind, path, blob_hash, checkpoint_id) VALUES ('r1', 0, 'write_file', 'src/a.ts', 'abc', 'cp1')",
    );
    await db.run("INSERT INTO brain_recipe_steps (recipe_id, seq, kind, command) VALUES ('r1', 1, 'command', 'npm test')");
    expect((await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipe_steps"))?.n).toBe(2);

    await db.run("DELETE FROM brain_recipes WHERE id = 'r1'");
    expect((await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipe_steps"))?.n).toBe(0);
    await db.close();
  });

  it("rejects invalid status, scope, oracle kind, step kind, orphans, and duplicate seq", async () => {
    const db = await openDb();
    await createTables(db);
    await expect(db.run("INSERT INTO brain_recipes (id, status) VALUES ('a', 'trusted')")).rejects.toThrow();
    await expect(db.run("INSERT INTO brain_recipes (id, scope) VALUES ('a', 'world')")).rejects.toThrow();
    await expect(db.run("INSERT INTO brain_recipes (id, oracle_kind) VALUES ('a', 'vibes')")).rejects.toThrow();

    await db.run("INSERT INTO brain_recipes (id) VALUES ('r')");
    await expect(
      db.run("INSERT INTO brain_recipe_steps (recipe_id, seq, kind) VALUES ('r', 0, 'raw_fs_write')"),
    ).rejects.toThrow();
    await expect(
      db.run("INSERT INTO brain_recipe_steps (recipe_id, seq, kind) VALUES ('missing', 0, 'command')"),
    ).rejects.toThrow();
    await db.run("INSERT INTO brain_recipe_steps (recipe_id, seq, kind) VALUES ('r', 0, 'command')");
    await expect(
      db.run("INSERT INTO brain_recipe_steps (recipe_id, seq, kind) VALUES ('r', 0, 'command')"),
    ).rejects.toThrow();
    await db.close();
  });

  it("recipe ids are unique (dedupe key)", async () => {
    const db = await openDb();
    await createTables(db);
    await db.run("INSERT INTO brain_recipes (id) VALUES ('same')");
    await expect(db.run("INSERT INTO brain_recipes (id) VALUES ('same')")).rejects.toThrow();
    await db.close();
  });

  it("adds family_id to a pre-P1 brain_recipes table without throwing on open", async () => {
    // Shape of ~/.knoxcoder/memory/brain.sqlite before P1 families: recipes exist,
    // but family_id / slot_values / pinned / notes do not. createTables used to
    // CREATE INDEX on family_id first and abort before migrateSchema could ALTER.
    const db = await openDb();
    await db.exec(`
      CREATE TABLE brain_recipes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'project',
        status TEXT NOT NULL DEFAULT 'candidate',
        title TEXT NOT NULL DEFAULT '',
        intent_text TEXT NOT NULL DEFAULT '',
        intent_fingerprint TEXT NOT NULL DEFAULT '',
        slots TEXT NOT NULL DEFAULT '[]',
        preconditions TEXT NOT NULL DEFAULT '[]',
        oracle_kind TEXT NOT NULL DEFAULT '',
        oracle_command TEXT NOT NULL DEFAULT '',
        oracle_passed_at DATETIME DEFAULT NULL,
        replay_count INTEGER NOT NULL DEFAULT 0,
        ok_count INTEGER NOT NULL DEFAULT 0,
        reverted_count INTEGER NOT NULL DEFAULT 0,
        failed_verify_count INTEGER NOT NULL DEFAULT 0,
        capture_count INTEGER NOT NULL DEFAULT 1,
        user_accepted_at DATETIME DEFAULT NULL,
        source_session_id TEXT DEFAULT NULL,
        memory_id INTEGER DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_replayed_at DATETIME DEFAULT NULL
      )
    `);
    await db.run("INSERT INTO brain_recipes (id, title) VALUES ('r1', 'pre-family')");

    await expect(createRecipeTables(db)).resolves.toBeUndefined();
    await expect(createTables(db)).resolves.toBeUndefined();
    await migrateSchema(db);

    const cols = (await db.all<{ name: string }[]>("PRAGMA table_info(brain_recipes)")).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["family_id", "slot_values", "pinned", "notes", "helpful_count", "unhelpful_count"]),
    );
    const row = await db.get<{ family_id: string; slot_values: string; pinned: number; notes: string; title: string }>(
      "SELECT family_id, slot_values, pinned, notes, title FROM brain_recipes WHERE id = 'r1'",
    );
    expect(row).toMatchObject({ family_id: "", slot_values: "{}", pinned: 0, notes: "", title: "pre-family" });
    await db.run("UPDATE brain_recipes SET family_id = 'fam' WHERE id = 'r1'");
    expect((await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipes WHERE family_id = 'fam'"))?.n).toBe(1);
    const fts = await db.get<{ recipe_id: string }>(
      `SELECT lex.recipe_id AS recipe_id FROM brain_recipes_fts
         JOIN brain_recipe_lex lex ON lex.id = brain_recipes_fts.rowid
        WHERE brain_recipes_fts MATCH '"pre-family"'`,
    );
    expect(fts?.recipe_id).toBe("r1");
    await db.close();
  });

  it("are cleared by the real brain wipe", async () => {
    const prev = process.env.KNOX_GLOBAL_DIR;
    process.env.KNOX_GLOBAL_DIR = dir;
    try {
      const { get, close } = await import("./connection");
      const { wipeAll } = await import("./wipe");
      const live = await get();
      await live.run("INSERT INTO brain_recipes (id) VALUES ('r1')");
      await live.run("INSERT INTO brain_recipe_steps (recipe_id, seq, kind) VALUES ('r1', 0, 'command')");
      expect((await live.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipes"))?.n).toBe(1);

      const result = await wipeAll();
      expect(result.recreated).toBe(true);
      const fresh = await get();
      expect((await fresh.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipes"))?.n).toBe(0);
      expect((await fresh.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipe_steps"))?.n).toBe(0);
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
