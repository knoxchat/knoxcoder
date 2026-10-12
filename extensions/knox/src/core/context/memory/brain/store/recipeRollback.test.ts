/**
 * MC-85: downgrade and rollback safety for the recipe tables.
 *
 * Downgrading Knox means an older build opens a database that has recipe tables it has never heard
 * of. That is safe only if (a) the new tables are standalone (no foreign key to or from the older
 * tables, so older deletes cannot fail or cascade into them), (b) the schema version did not move
 * (no backup/restore churn), and (c) removing them leaves every older table intact.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RecipeStore } from "../../recipes/RecipeStore";
import { linkRecipeMemory } from "../../recipes/memoryLink";
import { BRAIN_SCHEMA_VERSION, applyBrainPragmas, prepareBrainDb } from "./dbSafety";
import { createTables, migrateSchema } from "./schema";

// Everything this feature added. Anything not listed here is a pre-existing table.
const NEW_TABLES = ["brain_recipes", "brain_recipe_steps", "brain_memory_outcomes", "brain_memory_supersessions"];

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-rollback-"));
  dbPath = path.join(dir, "brain.sqlite");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function openDb() {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await applyBrainPragmas(db);
  return db;
}
type Db = Awaited<ReturnType<typeof openDb>>;

const tables = async (db: Db) =>
  (await db.all<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map(
    (r) => r.name,
  );

async function seed(db: Db) {
  await createTables(db);
  await db.run("INSERT INTO brain_sessions (id, workspace_directory, project_id) VALUES ('s1', '/w', 'p')");
  await db.run("INSERT INTO brain_semantic (title, content) VALUES ('keep', 'fact')");
  await db.run("INSERT INTO brain_recipes (id, status) VALUES ('r1', 'verified')");
  await db.run("INSERT INTO brain_recipe_steps (recipe_id, seq, kind) VALUES ('r1', 0, 'command')");
  await db.run("INSERT INTO brain_memory_outcomes (memory_id, verified_count) VALUES (1, 2)");
  await db.run("INSERT INTO brain_memory_supersessions (old_id, new_id) VALUES (1, 2)");
}

describe("downgrade (MC-85)", () => {
  it("new tables are standalone: no foreign key into or out of the older tables", async () => {
    const db = await openDb();
    await createTables(db);
    for (const t of await tables(db)) {
      const fks = await db.all<{ table: string }[]>(`PRAGMA foreign_key_list(${t})`);
      for (const fk of fks) {
        if (NEW_TABLES.includes(t)) expect(NEW_TABLES, `${t} references ${fk.table}`).toContain(fk.table);
        else expect(NEW_TABLES, `${t} references new table ${fk.table}`).not.toContain(fk.table);
      }
    }
    await db.close();
  });

  it("the schema version did not move, so an older build takes no backup and does not reset the file", async () => {
    const db = await openDb();
    await seed(db);
    await db.exec(`PRAGMA user_version = ${BRAIN_SCHEMA_VERSION}`);
    await db.close();
    const prep = await prepareBrainDb(dbPath);
    expect(prep).toEqual({ fromVersion: BRAIN_SCHEMA_VERSION });
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("older code can read, write and delete its own rows with the recipe tables present", async () => {
    const db = await openDb();
    await seed(db);
    // What an older build does: ordinary work on its own tables, ignorant of the new ones.
    await db.run("INSERT INTO brain_semantic (title, content) VALUES ('later', 'more')");
    await db.run("DELETE FROM brain_semantic WHERE title = 'keep'");
    await db.run("DELETE FROM brain_sessions WHERE id = 's1'");
    expect((await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_semantic"))?.n).toBe(1);
    expect((await db.get<{ integrity_check: string }>("PRAGMA integrity_check"))?.integrity_check).toBe("ok");
    expect((await db.all("PRAGMA foreign_key_check")).length).toBe(0);
    // And nothing it did touched the recipe data.
    expect((await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipes"))?.n).toBe(1);
    await db.close();
  });

  it("dropping every new table leaves the older tables untouched, and upgrading again recreates them", async () => {
    const db = await openDb();
    await seed(db);
    const before = (await tables(db)).filter((t) => !NEW_TABLES.includes(t)).sort();

    await db.exec("DROP TABLE brain_recipe_steps; DROP TABLE brain_recipes; DROP TABLE brain_memory_outcomes; DROP TABLE brain_memory_supersessions;");
    expect((await tables(db)).sort()).toEqual(before);
    expect((await db.get<{ content: string }>("SELECT content FROM brain_semantic WHERE title = 'keep'"))?.content).toBe("fact");

    await createTables(db);
    await migrateSchema(db);
    expect(await tables(db)).toEqual(expect.arrayContaining(NEW_TABLES));
    expect((await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_recipes"))?.n).toBe(0);
    await db.close();
  });
});

describe("wipe (MC-85)", () => {
  it("clears every table this feature added, not only the recipe pair", async () => {
    const prev = process.env.KNOX_GLOBAL_DIR;
    process.env.KNOX_GLOBAL_DIR = dir;
    try {
      const { get, close } = await import("./connection");
      const { wipeAll } = await import("./wipe");
      const live = await get();
      await live.run("INSERT INTO brain_recipes (id, status) VALUES ('r1', 'verified')");
      await live.run("INSERT INTO brain_recipe_steps (recipe_id, seq, kind) VALUES ('r1', 0, 'command')");
      await live.run("INSERT INTO brain_memory_outcomes (memory_id, verified_count) VALUES (1, 2)");
      await live.run("INSERT INTO brain_memory_supersessions (old_id, new_id) VALUES (1, 2)");

      const { backup } = await wipeAll();
      // The pre-wipe backup keeps the data, so a wipe is recoverable.
      expect(backup && fs.existsSync(backup)).toBe(true);

      const fresh = await get();
      for (const t of NEW_TABLES) {
        expect((await fresh.get<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`))?.n, t).toBe(0);
      }
      await close();
    } finally {
      if (prev === undefined) delete process.env.KNOX_GLOBAL_DIR;
      else process.env.KNOX_GLOBAL_DIR = prev;
    }
  });
});

describe("memory rollback leaves recipes safe (MC-85)", () => {
  it("a recipe whose linked memory was rolled back away is relinked, not left dangling", async () => {
    const db = await openDb();
    await createTables(db);
    const store = new RecipeStore(db as any);
    const created = (
      await store.create({
        projectId: "p",
        intentFingerprint: "make thing",
        title: "t",
        steps: [{ kind: "command", command: "npm test" }],
        oracle: { kind: "build", passedAt: "2026-01-01T00:00:00.000Z", command: "npm run build" },
      })
    ).recipe;
    await store.verify(created.id);

    let next = 10;
    const stored: number[] = [];
    const storeMemory = async () => (stored.push(next), next++);

    let recipe = (await store.get(created.id))!;
    recipe = await linkRecipeMemory(store, recipe, storeMemory);
    expect(recipe.memoryId).toBe(10);

    // Linked and still there: nothing happens.
    recipe = await linkRecipeMemory(store, recipe, storeMemory, async () => true);
    expect(stored).toEqual([10]);

    // Memory DB rolled back past memory 10: relink to a fresh memory.
    recipe = await linkRecipeMemory(store, recipe, storeMemory, async () => false);
    expect(recipe.memoryId).toBe(11);
    expect((await store.get(created.id))?.memoryId).toBe(11);
    await db.close();
  });
});
