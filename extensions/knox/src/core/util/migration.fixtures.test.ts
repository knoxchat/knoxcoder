/**
 * Upgrade tests: data directories written by 1.138.2 and 2.0.0-beta (see
 * scripts/gen-migration-fixtures.mjs) must open, migrate and keep their data
 * under the current code.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../test/fixtures/migration");
const VERSIONS = fs.readdirSync(FIXTURES).filter((n) => fs.statSync(path.join(FIXTURES, n)).isDirectory());

describe("fixtures exist", () => {
  it("covers 1.138.2 and 2.0.0-beta", () => {
    expect(VERSIONS).toEqual(expect.arrayContaining(["v1.138.2", "v2.0.0-beta"]));
  });
});

describe.each(VERSIONS)("upgrade from %s", (version) => {
  let home: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "knox-migrate-"));
    fs.cpSync(path.join(FIXTURES, version), home, { recursive: true });
    prevEnv = process.env.KNOX_GLOBAL_DIR;
    process.env.KNOX_GLOBAL_DIR = home;
    vi.resetModules();
  });
  afterEach(async () => {
    const { brainState } = await import("../context/memory/brain/store/state.js");
    await brainState.db?.close?.().catch(() => {});
    brainState.db = null;
    if (prevEnv === undefined) delete process.env.KNOX_GLOBAL_DIR;
    else process.env.KNOX_GLOBAL_DIR = prevEnv;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("Memory Brain: backs up, migrates, stamps the version and keeps every row", async () => {
    const dbFile = path.join(home, "memory", "brain.sqlite");
    const { get } = await import("../context/memory/brain/store/connection.js");
    const { BRAIN_SCHEMA_VERSION, backupsDir } = await import(
      "../context/memory/brain/store/dbSafety.js"
    );

    const db = await get();

    expect((await db.get<{ user_version: number }>("PRAGMA user_version"))?.user_version).toBe(
      BRAIN_SCHEMA_VERSION,
    );
    expect(
      ((await db.all("SELECT id FROM brain_sessions ORDER BY id")) as { id: string }[]).map((r) => r.id),
    ).toEqual(["sess-a", "sess-b"]);
    expect((await db.get<{ n: number }>("SELECT COUNT(*) n FROM brain_episodic"))?.n).toBe(2);
    const semantic = (await db.all("SELECT title FROM brain_semantic ORDER BY id")) as { title: string }[];
    expect(semantic.map((r) => r.title)).toEqual(["Auth lives in auth.ts", "Use pnpm"]);

    const backups = fs.readdirSync(backupsDir(dbFile)).filter((f) => f.endsWith(".sqlite"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^brain-v0-/);
    expect(fs.readdirSync(path.dirname(dbFile)).some((f) => f.includes(".corrupt-"))).toBe(false);
  });

  it("Memory Brain: a second open does not back up again", async () => {
    const dbFile = path.join(home, "memory", "brain.sqlite");
    const first = await import("../context/memory/brain/store/connection.js");
    await first.get();
    const { brainState } = await import("../context/memory/brain/store/state.js");
    await brainState.db?.close?.();
    brainState.db = null;

    await first.get();
    const { backupsDir } = await import("../context/memory/brain/store/dbSafety.js");
    expect(fs.readdirSync(backupsDir(dbFile)).filter((f) => f.endsWith(".sqlite"))).toHaveLength(1);
  });

  it("sessions: list, load, save and delete keep other sessions intact", async () => {
    const { default: history } = await import("./history.js");

    const listed = history.list({});
    expect(listed.map((s) => s.sessionId).sort()).toEqual(["sess-a", "sess-b"]); // old-format entry filtered
    expect(history.list({ workspaceDirectory: "/work/app" }).map((s) => s.sessionId)).toEqual(["sess-a"]);

    const loaded = history.load("sess-a");
    expect(loaded.title).toBe("Fix login");
    expect(loaded.history).toHaveLength(2);

    history.save({ ...loaded, title: "Fix login (renamed)" });
    history.save({ sessionId: "sess-new", title: "New", workspaceDirectory: "/work/app", history: [] });
    expect(history.list({}).map((s) => s.sessionId).sort()).toEqual(["sess-a", "sess-b", "sess-new"]);
    expect(history.list({}).find((s) => s.sessionId === "sess-a")?.title).toBe("Fix login (renamed)");
    expect(history.load("sess-b").history).toHaveLength(2);

    history.delete("sess-b");
    expect(history.list({}).map((s) => s.sessionId).sort()).toEqual(["sess-a", "sess-new"]);
    // The legacy entry is never dropped from the file by a rewrite.
    const raw = JSON.parse(fs.readFileSync(path.join(home, "sessions", "sessions.json"), "utf8"));
    expect(raw.some((s: { session_id?: string }) => s.session_id === "ancient")).toBe(true);
    // No stray temp files from atomic writes or lock dirs.
    expect(fs.readdirSync(path.join(home, "sessions")).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock"))).toEqual([]);
  });

  it("sessions: files are stamped with a schema version; the old file is kept once", async () => {
    const { default: history } = await import("./history.js");
    const { SESSION_SCHEMA_VERSION } = await import("./schemaVersions.js");
    const file = path.join(home, "sessions", "sess-a.json");
    const before = fs.readFileSync(file, "utf8");
    expect(JSON.parse(before).schemaVersion).toBeUndefined();

    history.save(history.load("sess-a"));
    expect(JSON.parse(fs.readFileSync(file, "utf8")).schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(fs.readFileSync(`${file}.v0.bak`, "utf8")).toBe(before);

    history.save(history.load("sess-a")); // already current: no further backups
    expect(fs.readdirSync(path.join(home, "sessions")).filter((f) => f.startsWith("sess-a.json.v"))).toEqual(["sess-a.json.v0.bak"]);
  });

  it("sessions: a file from a newer schema still loads and is backed up before rewrite", async () => {
    const { default: history } = await import("./history.js");
    const file = path.join(home, "sessions", "sess-a.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...data, schemaVersion: 99, future: true }));
    expect(history.load("sess-a").title).toBe("Fix login");
    history.save(history.load("sess-a"));
    expect(fs.existsSync(`${file}.v99.bak`)).toBe(true);
  });

  it("config.yaml: unknown schema is reported, editing keeps a one-time backup", async () => {
    const { configSchemaProblem } = await import("./schemaVersions.js");
    const { editConfigFile, getConfigYamlPath } = await import("./paths.js");
    const p = getConfigYamlPath();
    const original = fs.readFileSync(p, "utf8");
    expect(configSchemaProblem(original)).toBeUndefined();
    expect(configSchemaProblem("name: x\nschema: v9\n")).toMatch(/v9/);
    expect(configSchemaProblem("name: x\n")).toBeUndefined();

    editConfigFile((c) => ({ ...c, name: "edited" }));
    expect(fs.readFileSync(`${p}.vpre-edit.bak`, "utf8")).toBe(original);
    editConfigFile((c) => ({ ...c, name: "edited again" }));
    expect(fs.readFileSync(`${p}.vpre-edit.bak`, "utf8")).toBe(original);
    expect(YAML.parse(fs.readFileSync(p, "utf8")).name).toBe("edited again");
  });

  it("config.yaml: an existing file is left untouched and parses to the same models", async () => {
    const { getConfigYamlPath } = await import("./paths.js");
    const before = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
    const p = getConfigYamlPath();
    expect(p).toBe(path.join(home, "config.yaml"));
    expect(fs.readFileSync(p, "utf8")).toBe(before);
    const parsed = YAML.parse(before);
    expect(parsed.schema).toBe("v1");
    expect(parsed.models[0]).toMatchObject({ provider: "openai", model: "gpt-4o" });
  });
});
