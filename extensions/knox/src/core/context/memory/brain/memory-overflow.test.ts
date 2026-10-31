/**
 * MEM-30 — overflow injects a session summary node, not compress-oldest.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { planRecentShare } from "./memoryConfigAccess.js";
import { splitTurnsByRecentShare } from "./SummaryTree.js";

const testDir = path.join(os.tmpdir(), `brain-mem30-${Date.now()}`);
const OLD_TURN_TOKEN = "knoxOverflowOldTurnToken";

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let ContextSections: typeof import("./ContextSections.js").ContextSections;
let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;

function overflowWindow() {
  return {
    llm: { model: "tiny", contextLength: 8000, completionOptions: { maxTokens: 2000 } },
    system_tokens: 1500,
    goal_tokens: 200,
    recent_tokens: 5000,
  };
}

describe("MEM-30 recent share (pure)", () => {
  it("does not overflow when C_recent leaves a remainder", () => {
    const plan = planRecentShare({
      w: 8000,
      wOut: 2000,
      systemTokens: 1500,
      goalTokens: 200,
      recentTokens: 500,
      wMemCap: 4096,
    });
    expect(plan.usable).toBe(4300);
    expect(plan.recentShare).toBe(204);
    expect(plan.overflowed).toBe(false);
    expect(plan.recentTokens).toBe(500);
  });

  it("collapses C_recent to its share when occupancy leaves no remainder", () => {
    const plan = planRecentShare({
      w: 8000,
      wOut: 2000,
      systemTokens: 1500,
      goalTokens: 200,
      recentTokens: 5000,
      wMemCap: 4096,
    });
    expect(plan.overflowed).toBe(true);
    expect(plan.recentTokens).toBe(204);
    expect(plan.recentTokensRaw).toBe(5000);
    expect(plan.recentShare + 4096).toBe(plan.usable);
  });

  it("drops oldest turns first and keeps originals' ids", () => {
    const turns = [
      { id: 1, content: "aaaa", token_count: 40 },
      { id: 2, content: "bbbb", token_count: 40 },
      { id: 3, content: "cccc", token_count: 10 },
    ];
    const split = splitTurnsByRecentShare(turns, 15);
    expect(split.keptTurnIds).toEqual([3]);
    expect(split.droppedTurnIds).toEqual([1, 2]);
  });
});

describe("MEM-30 ContextBuilder overflow", () => {
  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ ContextBuilder } = await import("./ContextBuilder.js"));
    ({ ContextSections } = await import("./ContextSections.js"));
    ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
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
    await db.exec("DELETE FROM brain_session_topics");
    await db.exec("DELETE FROM brain_sessions");
    (BrainManager as { workingMem?: unknown }).workingMem = null;
  }

  async function seedOverflowSession(sessionId: string): Promise<number[]> {
    await BrainManager.trackSession(sessionId, "MEM-30 overflow", testDir);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const tail = i === 0 ? ` ${OLD_TURN_TOKEN}` : "";
      ids.push(await BrainManager.recordMessage(
        sessionId,
        "user",
        `${"oauth jwt refresh turn preamble ".repeat(40)}${tail}`,
        { tokenCount: 400 },
      ));
    }
    return ids;
  }

  it("injects a session/tree node and drops raw old turns from this call only", async () => {
    await reset();
    const sessionId = "mem30-overflow";
    const turnIds = await seedOverflowSession(sessionId);
    const originals = (await BrainStore.getEpisodicBySession(sessionId, 20))
      .map((row) => ({ id: row.id, content: row.content }));

    const built = await ContextBuilder.buildDetailed({
      message: "update the README badges",
      session_id: sessionId,
      include_graph: false,
      include_procedures: false,
      include_patterns: false,
      ...overflowWindow(),
    });

    expect(built.recent_overflow).toBe(true);
    expect(built.recent_tokens_raw).toBe(5000);
    expect(built.recent_tokens).toBe(204);
    expect(built.w_mem).toBeGreaterThan(0);
    expect(built.summary_node_id).toBeTruthy();
    expect(built.dropped_turn_ids?.length).toBeGreaterThan(0);
    expect(built.dropped_turn_ids).toEqual(expect.arrayContaining(turnIds));
    expect(built.context).toContain(`[summary-node ${built.summary_node_id}]`);
    expect(built.items.some((i) => i.title === "Session summary node")).toBe(true);
    expect(built.context).not.toContain("more entries, compressed");
    expect(built.context).not.toContain(OLD_TURN_TOKEN);

    const recalled = built.context.replace(/[\s\S]*on using that tool.\]/, "");
    const memoryOnly = recalled.replace(/=== Current Task ===[\s\S]*$/, "").replace("</memory-context>", "");
    expect(ContextSections.estimateTokens(memoryOnly)).toBeLessThanOrEqual((built.w_mem ?? 0) + 16);

    const after = await BrainStore.getEpisodicBySession(sessionId, 20);
    expect(after.map((row) => ({ id: row.id, content: row.content }))).toEqual(originals);
    expect(after.some((row) => row.content.includes(OLD_TURN_TOKEN))).toBe(true);
  });

  it("bypasses REL-10 overlap when C_recent overflows", async () => {
    await reset();
    const sessionId = "mem30-rel10";
    await seedOverflowSession(sessionId);
    await BrainStore.updateSession(sessionId, {
      summary: "We settled on oauth jwt refresh tokens for the auth service.",
    });

    const built = await ContextBuilder.buildDetailed({
      message: "update the README badges",
      session_id: sessionId,
      include_graph: false,
      include_procedures: false,
      include_patterns: false,
      ...overflowWindow(),
    });
    expect(built.recent_overflow).toBe(true);
    expect(built.context).toContain("Current Session Context");
    expect(built.items.some((i) => i.title === "Session summary node")).toBe(true);
  });

  it("does not use compress-oldest when the inject stays under budget", async () => {
    await reset();
    const sessionId = "mem30-no-overflow";
    await BrainManager.trackSession(sessionId, "MEM-30 fit", testDir);
    await BrainManager.store({
      category: "fact",
      title: "ReadmeLayout",
      content: "readme badges shields belong in the docs header layout",
      keywords: "readme, badges",
      session_id: sessionId,
      importance: 0.8,
    });

    const built = await ContextBuilder.buildDetailed({
      message: "readme badges layout",
      session_id: sessionId,
      max_tokens: 80,
      include_graph: false,
      include_procedures: false,
      include_patterns: false,
      llm: { model: "tiny", contextLength: 8000, completionOptions: { maxTokens: 2000 } },
      system_tokens: 500,
      recent_tokens: 200,
    });
    expect(built.recent_overflow).toBe(false);
    expect(built.recent_tokens).toBe(200);
    expect(built.context).not.toContain("more entries, compressed");
    expect(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ContextBuilder.ts"), "utf8"))
      .not.toContain("compressContextSections");
  });

  it("pipeline pre-turn records overflow on φ₈", async () => {
    await reset();
    const sessionId = "mem30-pipeline";
    await seedOverflowSession(sessionId);
    const result = await MemoryPipeline.runPreTurn({
      message: "update the README badges",
      session_id: sessionId,
      ...overflowWindow(),
    });
    expect(result.context?.recent_overflow).toBe(true);
    expect(result.context?.summary_node_id).toBeTruthy();
    const output = result.phases.find((p) => p.phase === "output_generation");
    expect(output?.audit?.recent_overflow).toBe(true);
    expect(output?.audit?.summary_node_id).toBe(result.context?.summary_node_id);
    expect(Array.isArray(output?.audit?.dropped_turn_ids)).toBe(true);
  });
});
