import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import { loadAttributionFromBrain } from "./attributionLoad";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("loadAttributionFromBrain", () => {
  it("returns undefined when the sqlite file is missing", async () => {
    expect(await loadAttributionFromBrain("/no/such/brain.sqlite")).toBeUndefined();
  });

  it("reads attribution rows and the live θ / w_s knobs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-attr-load-"));
    dirs.push(dir);
    const sqlitePath = path.join(dir, "brain.sqlite");
    const db = await open({ filename: sqlitePath, driver: sqlite3.Database });
    await applyBrainPragmas(db);
    await createTables(db);
    await db.run(
      `INSERT INTO brain_attribution (turn_id, session_id, mem_type, mem_id, injected, cited, helpful, channel, score)
       VALUES ('t1', 's', 'semantic', '1', 1, 1, 1, 'lexical', 0.4)`,
    );
    await db.run(
      `INSERT INTO brain_attribution (turn_id, session_id, mem_type, mem_id, injected, cited, helpful, channel)
       VALUES ('t2', 's', 'semantic', '2', 1, 0, NULL, 'graph')`,
    );
    await db.run(`INSERT INTO brain_config (key, value) VALUES ('calibrated_theta', '0.4')`);
    await db.run(`INSERT INTO brain_config (key, value) VALUES ('w_lexical', '1.2')`);
    await db.close();

    const dump = await loadAttributionFromBrain(sqlitePath);
    expect(dump?.current.theta).toBe(0.4);
    expect(dump?.current.weights.lexical).toBe(1.2);
    expect(dump?.current.weights.graph).toBe(1);
    expect(dump?.rows).toEqual([
      { injected: 1, cited: 1, helpful: 1, channel: "lexical", score: 0.4, mem_type: "semantic", mem_id: "1" },
      { injected: 1, cited: 0, helpful: null, channel: "graph", score: null, mem_type: "semantic", mem_id: "2" },
    ]);
  });
});
