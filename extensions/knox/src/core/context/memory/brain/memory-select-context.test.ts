/**
 * MEM-29 — budgeted submodular selection + start/end sandwich.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  COVERAGE_LAMBDA_DEFAULT,
  characterTrigrams,
  coverageFeatures,
  coverageSimilarity,
  sandwichOrder,
  selectBudgetedSubmodular,
  submodularObjective,
  type ContextCandidate,
} from "./selectContext.js";
import type { FusionResult } from "./RetrievalFusion.js";
import type { SemanticMemory } from "./types.js";

const testDir = path.join(os.tmpdir(), `brain-mem29-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let ContextSections: typeof import("./ContextSections.js").ContextSections;

function stub(
  key: string,
  score: number,
  tokens: number,
  text: string,
  extras: Partial<ContextCandidate> = {},
): ContextCandidate {
  const { features, item, kind, mustKeep, recordInject } = extras;
  return {
    key,
    kind: kind ?? "semantic",
    score,
    tokens,
    text,
    features: features ?? coverageFeatures(text),
    item: item ?? {
      id: Number(key.replace(/\D/g, "") || 1),
      kind: "semantic",
      title: key,
      reason: "test",
      score,
    },
    mustKeep,
    recordInject,
  };
}

describe("MEM-29 selectContext (pure)", () => {
  it("defaults λ=0.5 and empty / oversize inputs select nothing", () => {
    expect(COVERAGE_LAMBDA_DEFAULT).toBe(0.5);
    expect(selectBudgetedSubmodular([], 100).selected).toEqual([]);
    expect(selectBudgetedSubmodular([stub("a", 1, 50, "alpha")], 0).selected).toEqual([]);
    expect(selectBudgetedSubmodular([stub("a", 1, 80, "alpha")], 40).selected).toEqual([]);
  });

  it("near-duplicates add almost no coverage, so a diverse item wins the second slot", () => {
    const same = "oauth jwt refresh token login service rotating cookies";
    const a = stub("oauth-a", 1.0, 5, same);
    const dup = stub("oauth-b", 0.9, 5, same);
    const other = stub("readme-c", 0.7, 5, "readme badges shields docs header layout");
    expect(coverageSimilarity(a.features, dup.features)).toBe(1);
    expect(coverageSimilarity(a.features, other.features)).toBeLessThan(0.2);

    const result = selectBudgetedSubmodular([a, dup, other], 10, { lambda: 0.5 });
    const keys = result.selected.map((c) => c.key).sort();
    expect(keys).toContain("oauth-a");
    expect(keys).toContain("readme-c");
    expect(keys).not.toContain("oauth-b");
    expect(result.tokens).toBeLessThanOrEqual(10);
  });

  it("lazy greedy takes the better of value-greedy and value-per-token-greedy", () => {
    const bulky = stub("bulky", 10, 10, "unique bulky alpha token");
    const cheap = ["one", "two", "three"].map((name, i) =>
      stub(`cheap-${name}`, 4, 3, `distinct ${name} ${"xyzuvw"[i]} topic ${name}`),
    );
    const result = selectBudgetedSubmodular([bulky, ...cheap], 10, { lambda: 0.5 });
    const cheapF = submodularObjective(cheap, [bulky, ...cheap], 0.5);
    const bulkyF = submodularObjective([bulky], [bulky, ...cheap], 0.5);
    expect(cheapF).toBeGreaterThan(bulkyF);
    expect(result.strategy).toBe("value-per-token");
    expect(result.selected.map((c) => c.key).sort()).toEqual(
      ["cheap-one", "cheap-three", "cheap-two"],
    );
    expect(result.objective).toBeGreaterThan(result.valueObjective);
  });

  it("sandwich places the highest score at the start and the second at the end", () => {
    const items = [
      stub("high", 0.9, 4, "high item"),
      stub("mid", 0.5, 4, "mid item"),
      stub("low", 0.2, 4, "low item"),
    ];
    const ordered = sandwichOrder(items);
    expect(ordered.map((c) => c.key)).toEqual(["high", "low", "mid"]);
    const selected = selectBudgetedSubmodular(items, 20);
    expect(selected.ordered.map((c) => c.key)).toEqual(["high", "low", "mid"]);
  });

  it("mustKeep pins fill leftover budget after higher-value items", () => {
    const fact = stub("fact", 1, 6, "readme badges layout");
    const pin = stub("pin", 0.001, 4, "garden watering tomato", { mustKeep: true });
    const result = selectBudgetedSubmodular([fact, pin], 12);
    expect(result.selected.map((c) => c.key).sort()).toEqual(["fact", "pin"]);
  });

  it("character trigrams are lexical, not embeddings", () => {
    const a = characterTrigrams("AuthService");
    const b = characterTrigrams("AuthService");
    const c = characterTrigrams("grocery list");
    expect(a.size).toBeGreaterThan(0);
    expect([...a].every((t) => t.length === 3)).toBe(true);
    expect(coverageSimilarity(coverageFeatures("AuthService"), coverageFeatures("AuthService"))).toBe(1);
    expect(coverageSimilarity({ trigrams: a, entities: new Set() }, { trigrams: b, entities: new Set() })).toBe(1);
    expect(coverageSimilarity({ trigrams: a, entities: new Set() }, { trigrams: c, entities: new Set() })).toBeLessThan(0.2);
  });
});

describe("MEM-29 ContextBuilder assembly", () => {
  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ ContextBuilder } = await import("./ContextBuilder.js"));
    ({ ContextSections } = await import("./ContextSections.js"));
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "global");
    await BrainStore.saveConfig("graph_enabled", "false");
    await BrainStore.saveConfig("learning_enabled", "false");
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  async function reset(): Promise<void> {
    const db = await BrainStore.get();
    await db.exec("DELETE FROM brain_tags");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_summary_tree");
    (BrainManager as { workingMem?: unknown }).workingMem = null;
  }

  function asHit(mem: SemanticMemory, score: number): FusionResult {
    return {
      id: mem.id,
      type: "semantic",
      score,
      rel: score,
      scores: { fts5: 0.8, trigram: 0.2, graph: 0, recency: 0, importance: mem.importance_score },
      data: mem,
    };
  }

  it("sandwiches selected memories (highest start, second-highest end)", async () => {
    await reset();
    const sessionId = "mem29-sandwich";
    await BrainManager.trackSession(sessionId, "Sandwich", testDir);
    const highId = await BrainManager.store({
      category: "fact",
      title: "HighScoreFact",
      content: "highscore-alpha oauth jwt refresh login",
      keywords: "oauth, jwt, highscore",
      session_id: sessionId,
      importance: 0.9,
    });
    const midId = await BrainManager.store({
      category: "fact",
      title: "MidScoreFact",
      content: "midscore-beta readme badges shields",
      keywords: "readme, badges, midscore",
      session_id: sessionId,
      importance: 0.8,
    });
    const lowId = await BrainManager.store({
      category: "fact",
      title: "LowScoreFact",
      content: "lowscore-gamma aquarium nitrate cycle",
      keywords: "aquarium, nitrate, lowscore",
      session_id: sessionId,
      importance: 0.7,
    });
    const high = await BrainStore.getSemanticById(highId);
    const mid = await BrainStore.getSemanticById(midId);
    const low = await BrainStore.getSemanticById(lowId);
    expect(high && mid && low).toBeTruthy();

    const built = await ContextBuilder.buildDetailed({
      message: "oauth jwt readme badges aquarium nitrate",
      session_id: sessionId,
      include_graph: false,
      include_procedures: false,
      include_patterns: false,
      fusion_hits: [asHit(high!, 0.9), asHit(mid!, 0.5), asHit(low!, 0.2)],
    });
    const titles = built.items.filter((i) => i.kind === "semantic").map((i) => i.title);
    expect(titles).toEqual(["HighScoreFact", "LowScoreFact", "MidScoreFact"]);
    const ctx = built.context;
    expect(ctx.indexOf("HighScoreFact")).toBeLessThan(ctx.indexOf("LowScoreFact"));
    expect(ctx.indexOf("LowScoreFact")).toBeLessThan(ctx.indexOf("MidScoreFact"));
  });

  it("does not spend leftover per-section quotas; a diverse hit can take the second slot", async () => {
    await reset();
    const sessionId = "mem29-diversity";
    await BrainManager.trackSession(sessionId, "Diversity", testDir);
    const aId = await BrainManager.store({
      category: "fact",
      title: "OAuthDupA",
      content: "oauth jwt refresh token login service rotating cookies",
      keywords: "oauth, jwt, refresh",
      session_id: sessionId,
      importance: 0.95,
    });
    const bId = await BrainManager.store({
      category: "fact",
      title: "OAuthDupB",
      content: "oauth jwt refresh token login service rotating cookies",
      keywords: "oauth, jwt, refresh",
      session_id: sessionId,
      importance: 0.94,
    });
    const cId = await BrainManager.store({
      category: "fact",
      title: "ReadmeLayout",
      content: "readme badges shields belong in the docs header layout",
      keywords: "readme, badges, shields",
      session_id: sessionId,
      importance: 0.7,
    });
    const a = await BrainStore.getSemanticById(aId);
    const b = await BrainStore.getSemanticById(bId);
    const c = await BrainStore.getSemanticById(cId);

    const built = await ContextBuilder.buildDetailed({
      message: "oauth jwt refresh readme badges",
      session_id: sessionId,
      max_tokens: 65,
      include_graph: false,
      include_procedures: false,
      include_patterns: false,
      fusion_hits: [asHit(a!, 0.9), asHit(b!, 0.88), asHit(c!, 0.7)],
    });
    const titles = built.items.filter((i) => i.kind === "semantic").map((i) => i.title);
    expect(titles).toContain("ReadmeLayout");
    expect(titles.includes("OAuthDupA") || titles.includes("OAuthDupB")).toBe(true);
    expect(titles.includes("OAuthDupA") && titles.includes("OAuthDupB")).toBe(false);
    expect(titles.length).toBe(2);
    const recalled = built.context.replace(/[\s\S]*on using that tool.\]/, "");
    const memoryOnly = recalled.replace(/=== Current Task ===[\s\S]*$/, "").replace("</memory-context>", "");
    expect(ContextSections.estimateTokens(memoryOnly)).toBeLessThanOrEqual(50 + 8);
  });

  it("leftover computeBudget shares are not the live allocator", () => {
    const howTo = ContextSections.computeBudget("how to setup the workflow", 4000);
    const hello = ContextSections.computeBudget("hello", 4000);
    expect(howTo.procedures).toBeGreaterThan(hello.procedures);
  });
});
