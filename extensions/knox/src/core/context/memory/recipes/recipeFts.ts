/**
 * MEM-34 — recipe retrieval channel index.
 *
 * FTS5 over title / intent / fingerprint / paths. `brain_recipe_lex` is the
 * integer-rowid content table (recipe ids are sha256 text). Triggers keep the
 * index in sync so recall is MATCH, not `list LIMIT 1000`.
 *
 * Additive: CREATE IF NOT EXISTS, no schema-version bump. FTS5 missing →
 * no throw; RecipeStore.search falls back to title/intent/path LIKE plus
 * fingerprint + memory_id indexes.
 */

import { cjkExpandSql } from "../brain/cjkFts.js";
import type { DatabaseConnection } from "../../../util/refreshIndex.js";

const ID_EXPR = /^(?:new|old|r)\.(?:id|recipe_id)$/;

const LEX_TRIGGERS = [
  "brain_recipe_lex_insert",
  "brain_recipe_lex_update",
  "brain_recipe_lex_delete",
  "brain_recipe_lex_steps_insert",
  "brain_recipe_lex_steps_update",
  "brain_recipe_lex_steps_delete",
] as const;

const FTS_TRIGGERS = [
  "brain_recipes_fts_insert",
  "brain_recipes_fts_delete",
  "brain_recipes_fts_update",
] as const;

/** Space-joined step paths plus slash/dot-split tokens (`src/Button.tsx` → `src Button tsx`). */
export function recipePathsSql(recipeIdExpr: string): string {
  if (!ID_EXPR.test(recipeIdExpr)) {
    throw new Error(`recipePathsSql: unsafe id ${recipeIdExpr}`);
  }
  return `(
    SELECT ifnull(group_concat(path || ' ' || replace(replace(path, '/', ' '), '.', ' '), ' '), '')
    FROM brain_recipe_steps
    WHERE recipe_id = ${recipeIdExpr} AND path != ''
  )`;
}

async function dropTriggers(db: DatabaseConnection, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

async function installLexTriggers(db: DatabaseConnection): Promise<void> {
  await dropTriggers(db, LEX_TRIGGERS);
  await db.exec(`
    CREATE TRIGGER brain_recipe_lex_insert AFTER INSERT ON brain_recipes BEGIN
      INSERT OR IGNORE INTO brain_recipe_lex(recipe_id, title, intent_text, intent_fingerprint, paths)
      VALUES (new.id, new.title, new.intent_text, new.intent_fingerprint, ${recipePathsSql("new.id")});
    END
  `);
  await db.exec(`
    CREATE TRIGGER brain_recipe_lex_update AFTER UPDATE ON brain_recipes BEGIN
      UPDATE brain_recipe_lex
         SET title = new.title,
             intent_text = new.intent_text,
             intent_fingerprint = new.intent_fingerprint
       WHERE recipe_id = new.id;
      INSERT OR IGNORE INTO brain_recipe_lex(recipe_id, title, intent_text, intent_fingerprint, paths)
      VALUES (new.id, new.title, new.intent_text, new.intent_fingerprint, ${recipePathsSql("new.id")});
    END
  `);
  await db.exec(`
    CREATE TRIGGER brain_recipe_lex_delete AFTER DELETE ON brain_recipes BEGIN
      DELETE FROM brain_recipe_lex WHERE recipe_id = old.id;
    END
  `);
  const refreshPaths = (ref: "new" | "old") => `
    UPDATE brain_recipe_lex
       SET paths = ${recipePathsSql(`${ref}.recipe_id`)}
     WHERE recipe_id = ${ref}.recipe_id
  `;
  await db.exec(`
    CREATE TRIGGER brain_recipe_lex_steps_insert AFTER INSERT ON brain_recipe_steps BEGIN
      ${refreshPaths("new")};
    END
  `);
  await db.exec(`
    CREATE TRIGGER brain_recipe_lex_steps_update AFTER UPDATE ON brain_recipe_steps BEGIN
      ${refreshPaths("new")};
    END
  `);
  await db.exec(`
    CREATE TRIGGER brain_recipe_lex_steps_delete AFTER DELETE ON brain_recipe_steps BEGIN
      ${refreshPaths("old")};
    END
  `);
}

async function installFtsTriggers(db: DatabaseConnection): Promise<void> {
  await dropTriggers(db, FTS_TRIGGERS);
  const cols = "rowid, recipe_id, title, intent_text, intent_fingerprint, paths";
  const values = (src: "new" | "old") =>
    `${src}.id, ${src}.recipe_id, ${cjkExpandSql(`${src}.title`)}, ${cjkExpandSql(`${src}.intent_text`)}, ${cjkExpandSql(`${src}.intent_fingerprint`)}, ${cjkExpandSql(`${src}.paths`)}`;
  await db.exec(`
    CREATE TRIGGER brain_recipes_fts_insert AFTER INSERT ON brain_recipe_lex BEGIN
      INSERT INTO brain_recipes_fts(${cols})
      VALUES (${values("new")});
    END
  `);
  await db.exec(`
    CREATE TRIGGER brain_recipes_fts_delete AFTER DELETE ON brain_recipe_lex BEGIN
      INSERT INTO brain_recipes_fts(brain_recipes_fts, ${cols})
      VALUES ('delete', ${values("old")});
    END
  `);
  await db.exec(`
    CREATE TRIGGER brain_recipes_fts_update AFTER UPDATE ON brain_recipe_lex BEGIN
      INSERT INTO brain_recipes_fts(brain_recipes_fts, ${cols})
      VALUES ('delete', ${values("old")});
      INSERT INTO brain_recipes_fts(${cols})
      VALUES (${values("new")});
    END
  `);
}

async function backfillLex(db: DatabaseConnection): Promise<void> {
  await db.exec(`
    DELETE FROM brain_recipe_lex
     WHERE recipe_id NOT IN (SELECT id FROM brain_recipes)
  `).catch(() => {});
  await db.exec(`
    INSERT OR IGNORE INTO brain_recipe_lex (recipe_id, title, intent_text, intent_fingerprint, paths)
    SELECT r.id, r.title, r.intent_text, r.intent_fingerprint, ${recipePathsSql("r.id")}
      FROM brain_recipes r
     WHERE NOT EXISTS (SELECT 1 FROM brain_recipe_lex l WHERE l.recipe_id = r.id)
  `);
}

/**
 * Create / repair the recipe FTS channel. Safe on fresh and legacy DBs.
 * Returns whether MATCH is usable.
 */
export async function ensureRecipeFts(db: DatabaseConnection): Promise<boolean> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS brain_recipe_lex (
      id INTEGER PRIMARY KEY,
      recipe_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      intent_text TEXT NOT NULL DEFAULT '',
      intent_fingerprint TEXT NOT NULL DEFAULT '',
      paths TEXT NOT NULL DEFAULT ''
    )
  `);
  await installLexTriggers(db);

  try {
    await db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS brain_recipes_fts USING fts5(
        recipe_id UNINDEXED,
        title,
        intent_text,
        intent_fingerprint,
        paths,
        content='brain_recipe_lex',
        content_rowid='id',
        tokenize='porter unicode61 remove_diacritics 2'
      )
    `);
  } catch {
    await backfillLex(db);
    return false;
  }

  const prev = await db.get<{ sql: string }>(
    `SELECT sql FROM sqlite_master WHERE type='trigger' AND name='brain_recipes_fts_insert'`,
  );
  const needsRebuild = Boolean(prev?.sql && !prev.sql.includes("cjk_seq"));
  await installFtsTriggers(db);
  if (needsRebuild) {
    await db.exec("DELETE FROM brain_recipe_lex").catch(() => {});
  }
  await backfillLex(db);

  const lexN = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM brain_recipe_lex");
  const ftsN = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM brain_recipes_fts").catch(() => ({ n: 0 }));
  if ((lexN?.n ?? 0) > 0 && (ftsN?.n ?? 0) === 0) {
    try {
      await db.exec(`
        INSERT INTO brain_recipes_fts(rowid, recipe_id, title, intent_text, intent_fingerprint, paths)
        SELECT id, recipe_id, ${cjkExpandSql("title")}, ${cjkExpandSql("intent_text")},
               ${cjkExpandSql("intent_fingerprint")}, ${cjkExpandSql("paths")}
          FROM brain_recipe_lex
      `);
    } catch {
      return false;
    }
  }
  return true;
}

export async function recipeFtsReady(db: DatabaseConnection): Promise<boolean> {
  const row = await db.get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='brain_recipes_fts'`,
  );
  return Boolean(row?.name);
}
