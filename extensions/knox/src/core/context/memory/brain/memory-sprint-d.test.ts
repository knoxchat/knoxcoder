/**
 * Sprint D — REL-14 / REL-19 / REL-20 / REL-18 (automated chat-path proxy).
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-sprint-d-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;
let PrefrontalCortex: typeof import("./regions/PrefrontalCortex.js").PrefrontalCortex;
let WorkingMemory: typeof import("./WorkingMemory.js").WorkingMemory;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
  ({ PrefrontalCortex } = await import("./regions/PrefrontalCortex.js"));
  ({ WorkingMemory } = await import("./WorkingMemory.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  await BrainStore.saveConfig("memory_scope", "project");
  await BrainStore.saveConfig("retrieval_threshold", "0.6");
  await BrainStore.saveConfig("retrieval_require_lexical", "true");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function reset(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_collection_items");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_associations");
  await db.exec("DELETE FROM brain_graph_edges");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_entities");
  await db.exec("DELETE FROM brain_sessions");
  await db.exec("DELETE FROM brain_audit_log");
  (BrainManager as any).workingMem = null;
  (BrainManager as any).workingMemSessionId = null;
  (BrainManager as any).activeSessionId = null;
  PrefrontalCortex.resetAll();
  await BrainStore.saveConfig("retrieval_require_lexical", "true");
  await BrainStore.saveConfig("wm_mismatch_decay", "0.25");
}

async function storeAlpha(sessionId: string): Promise<number> {
  await BrainManager.trackSession(sessionId, "Sprint D", testDir);
  return BrainManager.store({
    category: "fact",
    title: "Unique token mismatch-alpha-aaa",
    content: "mismatch-alpha-aaa is the marker fact for this session.",
    keywords: "mismatch-alpha-aaa, unique, token",
    session_id: sessionId,
    importance: 0.99,
  });
}

async function storeCheckpoint(sessionId: string): Promise<number> {
  await BrainManager.trackSession(sessionId, "Sprint D", testDir);
  return BrainManager.store({
    category: "fact",
    title: "Git checkpoint restore flow",
    content: "git checkpoints snapshot workspace files for rollback.",
    keywords: "git, checkpoint, restore, rollback",
    session_id: sessionId,
    importance: 0.99,
  });
}

describe("REL-14 user mismatch feedback", () => {
  it("Not relevant prevents the item from injecting on the next turn of the same topic", async () => {
    await reset();
    const sessionId = "rel14-demote";
    const alphaId = await storeAlpha(sessionId);
    await BrainStore.addSessionTopic(
      sessionId,
      "alpha-topic",
      "mismatch-alpha-aaa unique token",
      0,
      2,
      0.9,
    );
    const db = await BrainStore.get();
    const topic = await BrainStore.getLatestSessionTopic(sessionId);
    await db.run("UPDATE brain_semantic SET topic_id = ? WHERE id = ?", [
      topic?.id ?? null,
      alphaId,
    ]);

    const before = await MemoryPipeline.runPreTurn({
      message: "what was mismatch-alpha-aaa?",
      session_id: sessionId,
    });
    expect(before.context?.items.some((i) => i.id === alphaId)).toBe(true);

    expect(await BrainManager.recordMismatch(alphaId, sessionId)).toBe(true);
    const mem = await BrainStore.getSemanticById(alphaId);
    expect(mem?.mismatch_count).toBe(1);
    expect(mem?.mismatch_until).toBeTruthy();
    const tags = await BrainStore.getTagsForMemory("semantic", alphaId);
    expect(tags.some((t) => t.tag === "mismatch")).toBe(true);

    const after = await MemoryPipeline.runPreTurn({
      message: "what was mismatch-alpha-aaa?",
      session_id: sessionId,
    });
    expect(after.context?.items.some((i) => i.id === alphaId)).toBe(false);
  });

  it("pin overrides demote if the user pins later", async () => {
    await reset();
    const sessionId = "rel14-pin-override";
    const alphaId = await storeAlpha(sessionId);
    await BrainStore.addSessionTopic(
      sessionId,
      "alpha-topic",
      "mismatch-alpha-aaa unique token",
      0,
      2,
      0.9,
    );
    const topic = await BrainStore.getLatestSessionTopic(sessionId);
    const db = await BrainStore.get();
    await db.run("UPDATE brain_semantic SET topic_id = ? WHERE id = ?", [
      topic?.id ?? null,
      alphaId,
    ]);

    expect(await BrainManager.recordMismatch(alphaId, sessionId)).toBe(true);
    let result = await MemoryPipeline.runPreTurn({
      message: "what was mismatch-alpha-aaa?",
      session_id: sessionId,
    });
    expect(result.context?.items.some((i) => i.id === alphaId)).toBe(false);

    expect(await BrainManager.pinMemory(alphaId)).toBe(true);
    result = await MemoryPipeline.runPreTurn({
      message: "now explain how git checkpoints work",
      session_id: sessionId,
    });
    const pinned = result.context?.items.find((i) => i.id === alphaId);
    expect(pinned).toBeTruthy();
    expect(pinned?.pinned).toBe(true);
    expect(pinned?.reason.startsWith("pinned")).toBe(true);
  });
});

describe("REL-19 observability", () => {
  it("pipeline:output_generation audit includes item count and retrieval_query", async () => {
    await reset();
    const sessionId = "rel19-audit";
    await storeAlpha(sessionId);
    await storeCheckpoint(sessionId);

    await MemoryPipeline.runPreTurn({
      message: "what was mismatch-alpha-aaa?",
      session_id: sessionId,
    });

    const entries = await BrainStore.getAuditLog({
      action: "pipeline:output_generation",
      limit: 5,
    });
    expect(entries.length).toBeGreaterThan(0);
    const details =
      typeof entries[0].details === "string"
        ? JSON.parse(entries[0].details)
        : entries[0].details;
    expect(details.retrieval_query).toBeTruthy();
    expect(String(details.retrieval_query).toLowerCase()).toMatch(/mismatch|alpha/);
    expect(details.item_count).toBeGreaterThan(0);
    expect(Array.isArray(details.items)).toBe(true);
    const alpha = details.items.find(
      (i: { id: number }) => typeof i.id === "number",
    );
    expect(alpha).toBeTruthy();
    expect(alpha).toHaveProperty("fusion_score");
    expect(alpha).toHaveProperty("gate_passed");
  });

  it("injected semantic reason is specific lexical evidence, not a generic match line", async () => {
    await reset();
    const sessionId = "rel19-reason";
    await storeCheckpoint(sessionId);
    const result = await MemoryPipeline.runPreTurn({
      message: "how do git checkpoints restore files?",
      session_id: sessionId,
    });
    const item = result.context?.items.find((i) => i.kind === "semantic");
    expect(item?.reason).toMatch(/lexical:/);
    expect(item?.reason).toMatch(/checkpoint/);
    expect(item?.reason).not.toMatch(/Matched current message/);
    expect(item?.evidence?.length).toBeGreaterThan(0);
  });
});

describe("REL-20 precision config knobs", () => {
  it("keys persist in brain_config and reload into MemoryConfig", async () => {
    await reset();
    await BrainStore.saveConfig("retrieval_require_lexical", "false");
    await BrainStore.saveConfig("topic_shift_jaccard", "0.42");
    await BrainStore.saveConfig("wm_mismatch_decay", "0.4");
    await BrainStore.saveConfig("wm_inject_min_relevance", "0.5");
    await BrainStore.saveConfig("summary_inject_min_overlap", "0.3");
    await BrainStore.saveConfig("pinned_unmatched_cap", "1");
    await BrainStore.saveConfig("retrieval_continuation_expand", "false");
    await BrainStore.saveConfig("fts5_use_and_for_content", "false");

    const db = await BrainStore.get();
    const rows = (await db.all(
      "SELECT key, value FROM brain_config WHERE key IN (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "retrieval_require_lexical",
        "topic_shift_jaccard",
        "wm_mismatch_decay",
        "wm_inject_min_relevance",
        "summary_inject_min_overlap",
        "pinned_unmatched_cap",
        "retrieval_continuation_expand",
        "fts5_use_and_for_content",
      ],
    )) as Array<{ key: string; value: string }>;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.retrieval_require_lexical).toBe("false");
    expect(byKey.topic_shift_jaccard).toBe("0.42");
    expect(byKey.pinned_unmatched_cap).toBe("1");

    await BrainStore.reloadConfig();
    const cfg = BrainStore.getConfig();
    expect(cfg.retrieval_require_lexical).toBe(false);
    expect(cfg.topic_shift_jaccard).toBe(0.42);
    expect(cfg.wm_mismatch_decay).toBe(0.4);
    expect(cfg.wm_inject_min_relevance).toBe(0.5);
    expect(cfg.summary_inject_min_overlap).toBe(0.3);
    expect(cfg.pinned_unmatched_cap).toBe(1);
    expect(cfg.retrieval_continuation_expand).toBe(false);
    expect(cfg.fts5_use_and_for_content).toBe(false);

    await BrainStore.saveConfig("retrieval_require_lexical", "true");
    await BrainStore.saveConfig("retrieval_continuation_expand", "true");
    await BrainStore.saveConfig("fts5_use_and_for_content", "true");
    await BrainStore.saveConfig("topic_shift_jaccard", "0.35");
    await BrainStore.saveConfig("wm_mismatch_decay", "0.25");
    await BrainStore.saveConfig("wm_inject_min_relevance", "0.35");
    await BrainStore.saveConfig("summary_inject_min_overlap", "0.2");
    await BrainStore.saveConfig("pinned_unmatched_cap", "2");
  });

  it("wm_mismatch_decay from config is used by attendTo", async () => {
    await reset();
    await BrainStore.saveConfig("wm_mismatch_decay", "0.9");
    const wm = new WorkingMemory({
      maxSlots: 7,
      tokenBudget: 8000,
      ttlSeconds: 3600,
      decayRatePerSecond: 0,
    });
    wm.add({
      id: "task-a",
      content: "oauth jwt refresh tokens",
      source: "user",
      relevance: 0.9,
    });
    wm.attendTo("update the README badges shields");
    const left = wm.getAll().find((i) => i.id === "task-a");
    expect(left).toBeUndefined();
    await BrainStore.saveConfig("wm_mismatch_decay", "0.25");
  });
});

describe("REL-18 checklist (pipeline / chat inject path)", () => {
  it("A. unique token retrieves that memory", async () => {
    await reset();
    const sessionId = "rel18-a";
    const alphaId = await storeAlpha(sessionId);
    const result = await MemoryPipeline.runPreTurn({
      message: "what was mismatch-alpha-aaa?",
      session_id: sessionId,
    });
    expect(result.context?.items.some((i) => i.id === alphaId)).toBe(true);
  });

  it("B. topic switch does not list the alpha memory", async () => {
    await reset();
    const sessionId = "rel18-b";
    const alphaId = await storeAlpha(sessionId);
    await storeCheckpoint(sessionId);
    const result = await MemoryPipeline.runPreTurn({
      message: "now explain how git checkpoints work",
      session_id: sessionId,
    });
    expect(result.context?.items.some((i) => i.id === alphaId)).toBe(false);
    expect(
      result.context?.items.some((i) => /checkpoint/i.test(i.title + i.reason)),
    ).toBe(true);
  });

  it("C. continue after checkpoint stays on checkpoint, not alpha", async () => {
    await reset();
    const sessionId = "rel18-c";
    await storeAlpha(sessionId);
    const ckptId = await storeCheckpoint(sessionId);
    await BrainManager.recordMessage(
      sessionId,
      "user",
      "explain how git checkpoints restore workspace files",
      { importance: 0.8 },
    );
    const result = await MemoryPipeline.runPreTurn({
      message: "continue",
      session_id: sessionId,
      goal: "continue",
    });
    const titles = (result.context?.items ?? []).map((i) => i.title).join(" ");
    expect(titles).not.toMatch(/mismatch-alpha-aaa/i);
    expect(
      result.context?.items.some((i) => i.id === ckptId) ||
        /checkpoint/i.test(titles),
    ).toBe(true);
  });

  it("E. pinned alpha may appear as pinned on a checkpoint query", async () => {
    await reset();
    const sessionId = "rel18-e";
    const alphaId = await storeAlpha(sessionId);
    await storeCheckpoint(sessionId);
    expect(await BrainManager.pinMemory(alphaId)).toBe(true);
    const result = await MemoryPipeline.runPreTurn({
      message: "now explain how git checkpoints work",
      session_id: sessionId,
    });
    const alpha = result.context?.items.find((i) => i.id === alphaId);
    expect(alpha?.pinned).toBe(true);
    expect(alpha?.reason.startsWith("pinned")).toBe(true);
  });

  it("F. Not relevant sticks across the next turn", async () => {
    await reset();
    const sessionId = "rel18-f";
    const alphaId = await storeAlpha(sessionId);
    const first = await MemoryPipeline.runPreTurn({
      message: "what was mismatch-alpha-aaa?",
      session_id: sessionId,
    });
    expect(first.context?.items.some((i) => i.id === alphaId)).toBe(true);
    expect(await BrainManager.recordMismatch(alphaId, sessionId)).toBe(true);
    const second = await MemoryPipeline.runPreTurn({
      message: "what was mismatch-alpha-aaa?",
      session_id: sessionId,
    });
    expect(second.context?.items.some((i) => i.id === alphaId)).toBe(false);
  });
});
