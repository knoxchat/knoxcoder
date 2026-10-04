#!/usr/bin/env node
/**
 * Regenerates the data-directory fixtures used by
 * src/core/test/migration.fixtures.test.ts.
 *
 * For each released tag the Memory Brain database is produced by running THAT
 * TAG's own `createTables` (taken from git, not from the working tree), then
 * seeded with a few rows. sessions/ and config.yaml are written in the shape
 * that tag's `history.ts` / `default.ts` produce (unchanged between the tags
 * except the sessions.json "old format" entry kept to exercise the filter).
 *
 *   node scripts/gen-migration-fixtures.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const outRoot = path.resolve(here, "../src/core/test/fixtures/migration");
const SCHEMA = "extensions/knox/src/core/context/memory/brain/store/schema.ts";
const TAGS = ["v1.138.2", "v2.0.0-beta"];

async function createTablesFromTag(tag) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "knox-fixture-"));
  const src = path.join(tmp, "schema.ts");
  fs.writeFileSync(src, execFileSync("git", ["show", `${tag}:${SCHEMA}`], { cwd: repoRoot, encoding: "utf8" }));
  const out = path.join(tmp, "schema.mjs");
  await build({ entryPoints: [src], outfile: out, format: "esm", platform: "node", logLevel: "silent" });
  const mod = await import(pathToFileURL(out).href);
  return { createTables: mod.createTables, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

for (const tag of TAGS) {
  const dir = path.join(outRoot, tag);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });

  // --- Memory Brain (user_version stays 0: versioning did not exist yet)
  const { createTables, cleanup } = await createTablesFromTag(tag);
  const dbFile = path.join(dir, "memory", "brain.sqlite");
  const db = await open({ filename: dbFile, driver: sqlite3.Database });
  await db.exec("PRAGMA journal_mode = DELETE;");
  await createTables(db);
  await db.run("INSERT INTO brain_sessions (id, title, workspace_directory) VALUES ('sess-a', 'Fix login', '/work/app')");
  await db.run("INSERT INTO brain_sessions (id, title, workspace_directory) VALUES ('sess-b', 'Refactor', '/work/lib')");
  await db.run("INSERT INTO brain_episodic (session_id, content) VALUES ('sess-a', 'user asked to fix login redirect')");
  await db.run("INSERT INTO brain_episodic (session_id, content, role) VALUES ('sess-a', 'patched auth.ts', 'assistant')");
  await db.run("INSERT INTO brain_semantic (title, content, source_session_id, keywords) VALUES ('Auth lives in auth.ts', 'Login flow is in src/auth.ts', 'sess-a', 'auth,login')");
  await db.run("INSERT INTO brain_semantic (title, content) VALUES ('Use pnpm', 'Repo uses pnpm workspaces')");
  await db.close();
  cleanup();

  // --- sessions (history.ts layout)
  const sessions = [
    { sessionId: "sess-a", title: "Fix login", dateCreated: "1750000000000", workspaceDirectory: "/work/app" },
    { sessionId: "sess-b", title: "Refactor", dateCreated: "1750000100000", workspaceDirectory: "/work/lib" },
    // pre-1.x entry shape that list() must keep filtering out
    { session_id: "ancient", title: "legacy", date_created: "1600000000000" },
  ];
  fs.writeFileSync(path.join(dir, "sessions", "sessions.json"), JSON.stringify(sessions, undefined, 2));
  for (const [id, title, ws] of [["sess-a", "Fix login", "/work/app"], ["sess-b", "Refactor", "/work/lib"]]) {
    fs.writeFileSync(
      path.join(dir, "sessions", `${id}.json`),
      JSON.stringify(
        {
          sessionId: id,
          title,
          workspaceDirectory: ws,
          history: [
            { message: { role: "user", content: `hello from ${id}` }, contextItems: [] },
            { message: { role: "assistant", content: "done" }, contextItems: [] },
          ],
        },
        undefined,
        2,
      ),
    );
  }

  // --- config.yaml (defaultConfig plus a user model, as the GUI would write it)
  fs.writeFileSync(
    path.join(dir, "config.yaml"),
    [
      "name: Knox",
      'version: "1.0.0"',
      "schema: v1",
      "models:",
      "  - name: My GPT",
      "    provider: openai",
      "    model: gpt-4o",
      "    apiKey: sk-fixture-not-real",
      "context:",
      "  - provider: file",
      "  - provider: diff",
      "  - provider: memory",
      "",
    ].join("\n"),
  );
  console.log(`wrote ${path.relative(repoRoot, dir)}`);
}
