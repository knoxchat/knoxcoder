/**
 * Batch M — MEM-64 … MEM-68: scope, as-of, reserved tree slots, channel cost, A4.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendRelevanceScope,
  filterSemanticByProjectScope,
  isUserGlobalCategory,
  USER_GLOBAL_CATEGORIES,
} from "./projectScope.js";
import { detectAsOfIntent, toSqliteUtc } from "./RetrievalQuery.js";
import { mergeReservedCandidates, resolveReservedTreeSlots } from "./reservedSlots.js";
import {
  BeamCapacity,
  exceedsBeamCapacity,
  resetBeamCapacityForTests,
  treeRoutedCount,
} from "./beamCapacity.js";
import { pprPushBudget, PPR_ALPHA_DEFAULT, PPR_EPSILON_DEFAULT } from "./channels/ppr.js";
import { treeVisitBudget, TREE_BEAM_DEFAULT, TREE_BRANCHING_DEFAULT } from "./SummaryTree.js";
import { FTS_MATCH_HARD_CAP } from "./RetrievalFusion.js";
import { getLastSearchMeta } from "./channelCost.js";
import { queryScopeClause } from "./store/validity.js";

describe("MEM-64 relevance scope (pure)", () => {
  it("preference and workflow are the user-global categories", () => {
    expect([...USER_GLOBAL_CATEGORIES]).toEqual(["preference", "workflow"]);
    expect(isUserGlobalCategory("preference")).toBe(true);
    expect(isUserGlobalCategory("fact")).toBe(false);
  });

  it("SQL lets user-global rows through an empty or foreign project list", () => {
    const extra: string[] = [];
    const params: unknown[] = [];
    expect(appendRelevanceScope(extra, params, "source_session_id", [], "category")).toBe("ok");
    expect(extra.join(" ")).toContain("preference");
    expect(params).toEqual([]);

    extra.length = 0;
    expect(appendRelevanceScope(extra, params, "source_session_id", ["s-a"], "category")).toBe("ok");
    expect(extra[0]).toContain("OR");
    expect(params).toEqual(["s-a"]);

    extra.length = 0;
    expect(appendRelevanceScope(extra, params, "session_id", [])).toBe("none");
  });

  it("JS filter keeps a preference from another project", () => {
    const rows = [
      { category: "fact", source_session_id: "here" },
      { category: "preference", source_session_id: "other" },
      { category: "workflow", source_session_id: "other" },
      { category: "fact", source_session_id: "other" },
    ] as any[];
    const kept = filterSemanticByProjectScope(rows, ["here"]);
    expect(kept.map((r) => r.category).sort()).toEqual(["fact", "preference", "workflow"]);
  });
});

describe("MEM-65 as-of intent (pure)", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("default retrieve is valid-now (no as-of)", () => {
    expect(detectAsOfIntent("how do we ship the auth service")).toBeNull();
    expect(queryScopeClause("semantic").params).toEqual([]);
    expect(queryScopeClause("semantic").sql).toContain("brain_memory_supersessions");
  });

  it("parses last month, last week, ISO dates, and originally", () => {
    expect(detectAsOfIntent("what did we use last month", now)).toEqual({
      asOf: "2026-05-01 00:00:00",
      phrase: "last month",
      kind: "relative",
    });
    expect(detectAsOfIntent("the setup from last week", now)?.kind).toBe("relative");
    expect(detectAsOfIntent("on 2025-01-15 what was the theme", now)).toMatchObject({
      asOf: "2025-01-15 00:00:00",
      kind: "date",
    });
    expect(detectAsOfIntent("what did we use before for auth", now)?.kind).toBe("originally");
    const asOf = queryScopeClause("semantic", "s", { asOf: "2025-01-15 00:00:00" });
    expect(asOf.sql).not.toContain("brain_memory_supersessions");
    expect(asOf.params).toContain("2025-01-15 00:00:00");
  });

  it("toSqliteUtc is UTC sqlite datetime", () => {
    expect(toSqliteUtc(now)).toBe("2026-06-15 12:00:00");
  });
});

describe("MEM-66 reserved tree slots (pure)", () => {
  it("derives B·b when the config is 0", () => {
    expect(resolveReservedTreeSlots({ configured: 0, beam: 4, branching: 8 })).toBe(32);
    expect(resolveReservedTreeSlots({ configured: 10, beam: 4, branching: 8 })).toBe(10);
  });

  it("keeps a tree-routed gold leaf that the fused head dropped", () => {
    const ranked = Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, score: 60 - i }));
    ranked.push({ key: "gold", score: 0.01 });
    const kept = mergeReservedCandidates(ranked, 50, new Set(["gold"]), 32);
    expect(kept).toHaveLength(51);
    expect(kept.some((r) => r.key === "gold")).toBe(true);
    expect(kept.slice(0, 50).every((r) => r.key !== "gold")).toBe(true);
  });

  it("does not evict fused-head rows to make room", () => {
    const ranked = [
      { key: "a", score: 3 },
      { key: "b", score: 2 },
      { key: "tree", score: 1 },
    ];
    const kept = mergeReservedCandidates(ranked, 2, new Set(["tree"]), 8);
    expect(kept.map((r) => r.key)).toEqual(["a", "b", "tree"]);
  });
});

describe("MEM-67 channel cost limits (pure)", () => {
  it("lexical MATCH window is capped well below a 1e5 scan", () => {
    expect(FTS_MATCH_HARD_CAP).toBeLessThanOrEqual(2048);
    expect(FTS_MATCH_HARD_CAP).toBeGreaterThan(0);
  });

  it("retrieve path does not COUNT(*) semantic or episodic tables to pick LIKE", () => {
    const countSemantic = /SELECT COUNT\(\*\) AS n FROM brain_semantic/;
    const countEpisodic = /SELECT COUNT\(\*\) AS n FROM brain_episodic/;
    const files = [
      "RetrievalFusion.ts",
      "KnowledgeGraph.ts",
      "store/semantic.ts",
      "store/episodic.ts",
      "channels/ripgrep.ts",
    ];
    for (const rel of files) {
      const src = fs.readFileSync(new URL(`./${rel}`, import.meta.url), "utf8");
      expect(src, rel).not.toMatch(countSemantic);
      expect(src, rel).not.toMatch(countEpisodic);
    }
  });

  it("PPR push budget is O(1/(αε)) and independent of |V|", () => {
    const budget = pprPushBudget(PPR_ALPHA_DEFAULT, PPR_EPSILON_DEFAULT);
    expect(budget).toBe(Math.ceil(1 / (PPR_ALPHA_DEFAULT * PPR_EPSILON_DEFAULT)));
    expect(pprPushBudget(0.15, 1e-4)).toBe(budget);
  });

  it("tree visit budget is O(B b log_b N)", () => {
    const n = 1e5;
    const cap = treeVisitBudget(TREE_BEAM_DEFAULT, TREE_BRANCHING_DEFAULT, n);
    const levels = Math.ceil(Math.log(n) / Math.log(TREE_BRANCHING_DEFAULT));
    expect(cap).toBe(TREE_BEAM_DEFAULT * TREE_BRANCHING_DEFAULT * levels);
    expect(cap).toBeLessThan(n / 10);
  });
});

describe("MEM-68 beam capacity (pure)", () => {
  it("triggers when tree-routed leaves exceed B", () => {
    expect(exceedsBeamCapacity(4, 4)).toBe(false);
    expect(exceedsBeamCapacity(5, 4)).toBe(true);
    expect(treeRoutedCount([{ ranks: { tree: 1 } }, { scores: { tree: 0.2 } }, { scores: { tree: 0 } }])).toBe(2);
  });

  it("publishes the share of queries with |G_W| > B", () => {
    resetBeamCapacityForTests();
    BeamCapacity.record(false);
    BeamCapacity.record(true);
    BeamCapacity.record(true);
    expect(BeamCapacity.stats()).toEqual({ queries: 3, over_beam: 2 });
    expect(BeamCapacity.share()).toBeCloseTo(2 / 3, 10);
    resetBeamCapacityForTests();
  });
});

const testDir = path.join(os.tmpdir(), `brain-mem-m-${Date.now()}`);

describe("MEM-64/65 live retrieve", () => {
  let BrainManager: typeof import("./BrainManager.js").BrainManager;
  let BrainStore: typeof import("./BrainStore.js").BrainStore;
  let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
  let Hippocampus: typeof import("./regions/Hippocampus.js").Hippocampus;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
    ({ Hippocampus } = await import("./regions/Hippocampus.js"));
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "project");
    await BrainStore.saveConfig("retrieval_threshold", "0.15");
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function reset(): Promise<void> {
    const db = await BrainStore.get();
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_sessions");
    await db.exec("DELETE FROM brain_summary_tree");
    await db.exec("DELETE FROM brain_memory_supersessions");
  }

  it("a global preference is visible in every project; a fact from the other project is not", async () => {
    await reset();
    const wa = path.join(testDir, "ws-a");
    const wb = path.join(testDir, "ws-b");
    fs.mkdirSync(wa, { recursive: true });
    fs.mkdirSync(wb, { recursive: true });
    await BrainManager.trackSession("m64-a", "A", wa);
    await BrainManager.trackSession("m64-b", "B", wb);
    const prefToken = "knoxmem64preftoken";
    const factToken = "knoxmem64facttoken";
    await BrainManager.store({
      category: "preference",
      title: "Editor tabs",
      content: `Always use spaces not tabs ${prefToken}`,
      keywords: prefToken,
      session_id: "m64-b",
      importance: 0.8,
    });
    await BrainManager.store({
      category: "fact",
      title: "Secret of B",
      content: `Project B only ${factToken}`,
      keywords: factToken,
      session_id: "m64-b",
      importance: 0.8,
    });
    const { hashProjectId } = await import("./projectScope.js");
    const projectA = hashProjectId(wa);
    const scoped = await RetrievalFusion.search({
      query: `${prefToken} ${factToken}`,
      includeEpisodic: false,
      sessionId: "m64-a",
      projectSessionIds: await BrainStore.listSessionIdsByProject(projectA),
    });
    const titles = scoped.map((r) => (r.data as { title?: string }).title);
    expect(titles.some((t) => t?.includes("Editor tabs"))).toBe(true);
    expect(titles.some((t) => t?.includes("Secret of B"))).toBe(false);
  });

  it("as-of retrieve returns the superseded fact that was valid then", async () => {
    await reset();
    await BrainStore.saveConfig("memory_scope", "global");
    const sessionId = "m65";
    await BrainManager.trackSession(sessionId, "as-of", testDir);
    const oldId = await BrainStore.storeSemantic({
      category: "decision",
      title: "Auth was JWT",
      content: "we used jwt-refresh knoxmem65oldtoken for auth",
      session_id: sessionId,
      keywords: "knoxmem65oldtoken, jwt",
    });
    const newId = await BrainStore.storeSemantic({
      category: "decision",
      title: "Auth is session cookies",
      content: "we now use session-cookies knoxmem65newtoken for auth",
      session_id: sessionId,
      keywords: "knoxmem65newtoken, cookies",
    });
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic SET valid_from='2026-01-01 00:00:00', valid_to='2026-03-01 00:00:00' WHERE id = ?`,
      [oldId],
    );
    await db.run(
      `UPDATE brain_semantic SET valid_from='2026-03-01 00:00:00', valid_to=NULL WHERE id = ?`,
      [newId],
    );
    await db.run(
      `INSERT OR IGNORE INTO brain_memory_supersessions (old_id, new_id) VALUES (?, ?)`,
      [oldId, newId],
    );

    const nowHits = await RetrievalFusion.search({
      query: "knoxmem65oldtoken knoxmem65newtoken auth",
      includeEpisodic: false,
      sessionId,
    });
    expect(nowHits.some((h) => h.id === newId)).toBe(true);
    expect(nowHits.some((h) => h.id === oldId)).toBe(false);

    const past = await RetrievalFusion.search({
      query: "knoxmem65oldtoken auth",
      includeEpisodic: false,
      sessionId,
      asOf: "2026-02-01 00:00:00",
      queryTime: "2026-02-01 00:00:00",
    });
    expect(past.some((h) => h.id === oldId)).toBe(true);
    expect(past.some((h) => h.id === newId)).toBe(false);

    const viaIntent = await Hippocampus.fusionRetrieve({
      message: "what did we use before on 2026-02-01 for knoxmem65oldtoken auth",
      session_id: sessionId,
      includeEpisodic: false,
    });
    expect(viaIntent.some((h) => h.id === oldId)).toBe(true);
    await BrainStore.saveConfig("memory_scope", "project");
  });

  it("search meta exposes per-channel latency and visited counts", async () => {
    await reset();
    await BrainStore.saveConfig("memory_scope", "global");
    const sessionId = "m67";
    await BrainManager.trackSession(sessionId, "cost", testDir);
    await BrainManager.store({
      category: "fact",
      title: "Cost leaf",
      content: "knoxmem67costtoken lives here",
      keywords: "knoxmem67costtoken",
      session_id: sessionId,
    });
    await RetrievalFusion.search({
      query: "knoxmem67costtoken",
      includeEpisodic: false,
      sessionId,
    });
    const meta = getLastSearchMeta();
    expect(meta).toBeTruthy();
    expect(meta!.channels.map((c) => c.channel).sort()).toEqual(["graph", "lexical", "ripgrep", "tree"]);
    expect(meta!.channels.every((c) => Number.isFinite(c.latency_ms) && c.visited >= 0)).toBe(true);
    await BrainStore.saveConfig("memory_scope", "project");
  });
});
