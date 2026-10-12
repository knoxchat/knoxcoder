import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BRAIN_SCHEMA_VERSION, applyBrainPragmas, prepareBrainDb } from "./dbSafety";
import { createTables, migrateSchema } from "./schema";

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
      expect.arrayContaining(["brain_recipes", "brain_recipe_steps"]),
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
