/**
 * MC-51 outcome-aware recall and MC-52 contradiction handling.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyOutcomeWeight, conflictsWith } from "./memoryOutcomes.js";

const testDir = path.join(os.tmpdir(), `brain-outcomes-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let Ebbinghaus: typeof import("./Ebbinghaus.js").Ebbinghaus;
let outcomes: typeof import("./memoryOutcomes.js");
let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ Ebbinghaus } = await import("./Ebbinghaus.js"));
  ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
  outcomes = await import("./memoryOutcomes.js");
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  await BrainStore.saveConfig("memory_scope", "global");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

describe("MC-51 outcome-aware strength (pure)", () => {
  it("verified outcomes strengthen, reverts weaken more, both bounded", () => {
    const base = Ebbinghaus.memoryStrength(2);
    expect(Ebbinghaus.outcomeAdjustedStrength(base, 3, 0)).toBeGreaterThan(base);
    expect(Ebbinghaus.outcomeAdjustedStrength(base, 0, 1)).toBeLessThan(base);
    expect(Ebbinghaus.outcomeAdjustedStrength(base, 1, 1)).toBeLessThan(base);
    expect(Ebbinghaus.outcomeFactor(1000, 0)).toBe(1.3);
    expect(Ebbinghaus.outcomeFactor(0, 1000)).toBe(0.4);
    expect(Ebbinghaus.outcomeFactor(0, 0)).toBe(1);
  });

  it("boost cannot admit a below-threshold candidate; penalty always applies unless pinned", () => {
    expect(applyOutcomeWeight(0.3, { verified: 6, reverted: 0 }, 0.6)).toBe(0.3);
    expect(applyOutcomeWeight(0.7, { verified: 6, reverted: 0 }, 0.6)).toBeGreaterThan(0.7);
    expect(applyOutcomeWeight(0.7, { verified: 0, reverted: 2 }, 0.6)).toBeLessThan(0.7);
    expect(applyOutcomeWeight(0.7, { verified: 0, reverted: 2 }, 0.6, true)).toBe(0.7);
    expect(applyOutcomeWeight(0.7, undefined, 0.6)).toBe(0.7);
  });
});

describe("MC-52 conflict detection (pure)", () => {
  const mk = (id: number, title: string, content: string, category = "decision") => ({ id, category, title, content });
  it("detects same-subject different-content decisions only", () => {
    expect(conflictsWith(mk(2, "Indentation style", "Use spaces"), mk(1, "Indentation style", "Use tabs"))).toBe(true);
    expect(conflictsWith(mk(2, "Indentation style", "Use tabs"), mk(1, "Indentation style", "Use tabs"))).toBe(false);
    expect(conflictsWith(mk(2, "Database choice", "Postgres"), mk(1, "Indentation style", "Use tabs"))).toBe(false);
    expect(conflictsWith(mk(2, "Indentation style", "a", "fact"), mk(1, "Indentation style", "b", "fact"))).toBe(false);
  });
});

describe("MC-51 / MC-52 with a real brain", () => {
  it("recall returns the newer decision and explains the change", async () => {
    await BrainManager.trackSession("s-mc52", "t", testDir);
    const store = (title: string, content: string) =>
      BrainManager.store({ category: "decision", title, content, keywords: "quartzfmt indentation", session_id: "s-mc52", importance: 0.8 });
    const oldId = await store("quartzfmt indentation style", "quartzfmt indentation uses tabs everywhere");
    const newId = await store("quartzfmt indentation style", "quartzfmt indentation uses spaces everywhere");
    const db = await BrainStore.get();
    expect(newId).not.toBe(oldId);
    const sup = await db.get("SELECT new_id FROM brain_memory_supersessions WHERE old_id = ?", [oldId]);
    expect((sup as any).new_id).toBe(newId);

    const res = await RetrievalFusion.search({ query: "quartzfmt indentation", sessionId: "s-mc52", limit: 5, minScore: 0.01 } as any);
    const ids = res.filter((r) => r.type === "semantic").map((r) => r.id);
    expect(ids).toContain(newId);
    expect(ids).not.toContain(oldId);

    const notes = await outcomes.explainSupersession(db as any, newId);
    expect(notes[0]).toContain("tabs");
  });

  it("reverted outcomes demote a memory in recall", async () => {
    await BrainManager.trackSession("s-mc51", "t", testDir);
    const aId = await BrainManager.store({ category: "fact", title: "zephyrlint rule alpha", content: "zephyrlint rule alpha applies to imports", keywords: "zephyrlint", session_id: "s-mc51", importance: 0.5 });
    const db = await BrainStore.get();
    const run = async () =>
      (await RetrievalFusion.search({ query: "zephyrlint rule alpha", sessionId: "s-mc51", limit: 5, minScore: 0.01 } as any)).find((r) => r.id === aId)?.score ?? 0;
    const before = await run();
    expect(before).toBeGreaterThan(0);
    await outcomes.recordRecallOutcome(db as any, [aId], "reverted");
    const after = await run();
    expect(after).toBeLessThan(before);
    const loaded = await outcomes.loadOutcomes(db as any, [aId]);
    expect(loaded.get(aId)).toEqual({ verified: 0, reverted: 1 });
  });
});
