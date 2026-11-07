/**
 * Consolidate used one `WHERE id IN (?,?,…)` over every live leaf.
 * SQLite then threw `too many SQL variables` and stalled the extension host.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SQLITE_BIND_CHUNK,
  bindChunkSize,
  chunkList,
  sqlPlaceholders,
} from "./store/sqlChunks.js";

const testDir = path.join(os.tmpdir(), `brain-sql-chunks-${Date.now()}`);
const OVER_BIND = SQLITE_BIND_CHUNK * 2 + 20;

let BrainStore: typeof import("./BrainStore.js").BrainStore;
let recomputeMemoryTiers: typeof import("./store/tiers.js").recomputeMemoryTiers;
let checkLosslessness: typeof import("./invariants.js").checkLosslessness;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ recomputeMemoryTiers } = await import("./store/tiers.js"));
  ({ checkLosslessness } = await import("./invariants.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_summary_tree");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_sessions");
}

describe("sqlChunks helper", () => {
  it("keeps each statement under SQLITE_MAX_VARIABLE_NUMBER headroom", () => {
    expect(SQLITE_BIND_CHUNK).toBeLessThanOrEqual(500);
    expect(bindChunkSize(1)).toBe(SQLITE_BIND_CHUNK - 1);
    expect(bindChunkSize(0)).toBe(SQLITE_BIND_CHUNK);
    expect(sqlPlaceholders(3)).toBe("?,?,?");
    expect(chunkList([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("consolidate bind lists", () => {
  it("recomputeMemoryTiers updates more than SQLITE_BIND_CHUNK rows without SQLITE_ERROR", async () => {
    await reset();
    const db = await BrainStore.get();
    await db.exec("BEGIN");
    for (let i = 0; i < OVER_BIND; i++) {
      await db.run(
        `INSERT INTO brain_semantic
           (category, title, content, keywords, importance_score, i0,
            helpful_count, unhelpful_count, stability, tier, created_at, last_accessed_at)
         VALUES ('fact', ?, 'x', '', 0.01, 0.01, 0, 0, 1, 'hot',
                 datetime('now', '-400 days'), datetime('now', '-400 days'))`,
        [`bind-chunk-${i}`],
      );
    }
    await db.exec("COMMIT");

    const result = await recomputeMemoryTiers();
    expect(result.demoted).toBe(OVER_BIND);
    const leftover = await db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM brain_semantic WHERE tier = 'hot' AND tombstoned_at IS NULL",
    );
    expect(leftover?.c ?? -1).toBe(0);
    const frozen = await db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM brain_semantic WHERE tier = 'frozen'",
    );
    expect(frozen?.c).toBe(OVER_BIND);
  });

  it("checkLosslessness looks up more than SQLITE_BIND_CHUNK tree leaves without SQLITE_ERROR", async () => {
    await reset();
    const db = await BrainStore.get();
    await db.exec("BEGIN");
    for (let i = 0; i < OVER_BIND; i++) {
      const row = await db.run(
        `INSERT INTO brain_semantic (category, title, content, keywords) VALUES ('fact', ?, 'x', '')`,
        [`leaf-${i}`],
      );
      await db.run(
        `INSERT INTO brain_summary_tree (parent_id, kind, leaf_type, leaf_id, text, token_count)
         VALUES (NULL, 'leaf', 'semantic', ?, 'x', 1)`,
        [String(row.lastID)],
      );
    }
    await db.exec("COMMIT");

    const report = await checkLosslessness();
    expect(report.checked).toBe(true);
    expect(report.leaves).toBe(OVER_BIND);
    expect(report.dangling).toBe(0);
    expect(report.met).toBe(true);
  });
});
