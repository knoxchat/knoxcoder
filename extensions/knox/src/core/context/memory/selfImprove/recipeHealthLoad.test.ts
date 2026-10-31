import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { RecipeStore } from "../recipes/RecipeStore";
import {
  loadRecipeHealthFromBrain,
  recipeHealthExtrasFromAuditJsonl,
} from "./recipeHealthLoad";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("loadRecipeHealthFromBrain", () => {
  it("returns undefined when the sqlite file is missing", async () => {
    expect(await loadRecipeHealthFromBrain("/no/such/brain.sqlite")).toBeUndefined();
  });

  it("reads live recipe counts and audit skip extras (P7.4 production)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-health-"));
    dirs.push(dir);
    const sqlitePath = path.join(dir, "brain.sqlite");
    const db = await open({ filename: sqlitePath, driver: sqlite3.Database });
    await applyBrainPragmas(db);
    await createTables(db);
    const store = new RecipeStore(db as never);
    const oracle = { kind: "build" as const, passedAt: "2026-01-01T00:00:00.000Z" };
    const { recipe: verified } = await store.create({
      projectId: "p",
      title: "add lint",
      intentText: "add a lint script",
      intentFingerprint: "add lint script",
      steps: [{ kind: "write_file", path: "package.json", blobHash: "a".repeat(64), checkpointId: "cp1" }],
      oracle,
    });
    await store.transition(verified.id, "verified");
    await store.recordReplay(verified.id, "ok");
    await store.create({
      projectId: "p",
      title: "other",
      intentText: "other work",
      intentFingerprint: "other work",
      steps: [{ kind: "write_file", path: "src/a.ts", blobHash: "b".repeat(64), checkpointId: "cp2" }],
      oracle,
    });
    await db.close();

    const auditPath = path.join(dir, "events.jsonl");
    fs.writeFileSync(
      auditPath,
      [
        JSON.stringify({ action: "recipe_capture", details: { captured: false, reason: "no_oracle" } }),
        JSON.stringify({ action: "recipe_capture", details: { captured: false, reason: "no_oracle" } }),
        JSON.stringify({ action: "recipe_match", details: { replayable: false, nearMiss: true, title: "close" } }),
      ].join("\n"),
    );

    const health = await loadRecipeHealthFromBrain(sqlitePath, auditPath);
    expect(health).toMatchObject({
      verified: 1,
      candidate: 1,
      quarantined: 0,
      unlinkedVerified: 1,
      replays: 1,
      wrongApplyRate: 0,
      skips: 2,
      nearMisses: 1,
    });
    expect(health?.skipReasons).toEqual({ no_oracle: 2 });
  });

  it("parses capture skips and near-misses from audit JSONL", () => {
    const extras = recipeHealthExtrasFromAuditJsonl(
      [
        '{"action":"recipe_capture","details":{"captured":false,"reason":"secret_detected"}}',
        "not-json",
        '{"action":"recipe_capture","details":{"captured":true}}',
        '{"action":"recipe_match","details":{"replayable":false,"nearMiss":true}}',
      ].join("\n"),
    );
    expect(extras).toEqual({
      skips: 1,
      skipReasons: { secret_detected: 1 },
      nearMisses: 1,
    });
  });
});
