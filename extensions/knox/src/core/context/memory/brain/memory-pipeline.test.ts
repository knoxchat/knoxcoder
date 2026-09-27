/**
 * Part III — 8-Phase Memory Cycle tests (IMP-01, IMP-06).
 *
 * Covers:
 *   φ₁–φ₈ phase order and execution
 *   φ₃ Thalamus(Prefrontal(x)) planning step
 *   φ₅ long-term storage (M₄/M₅)
 *   Cycle invariant audit logging
 *   φ₇ sleep sub-phases
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-pipeline-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;
let PrefrontalCortex: typeof import("./regions/PrefrontalCortex.js").PrefrontalCortex;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
  ({ PrefrontalCortex } = await import("./regions/PrefrontalCortex.js"));

  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "true");
  await BrainStore.saveConfig("enable_knowledge_extraction", "true");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

async function resetDatabase(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_collection_items");
  await db.exec("DELETE FROM brain_tags");
  await db.exec("DELETE FROM brain_associations");
  await db.exec("DELETE FROM brain_graph_edges");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_episodic");
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_sessions");
  await db.exec("DELETE FROM brain_audit_log");
  PrefrontalCortex.resetAll();
}

describe("Part III — 8-Phase Memory Cycle", () => {
  it("runs pre-turn phases φ₁→φ₂→φ₃→φ₆→φ₈ in order", async () => {
    await resetDatabase();
    const sessionId = "phase-order-session";
    await BrainManager.trackSession(sessionId, "Phase Order", testDir);

    const result = await MemoryPipeline.runPreTurn({
      message: "How does authentication work in this project?",
      session_id: sessionId,
      goal: "Understand auth flow",
    });

    const order = result.phases.map((p) => p.phase);
    expect(order).toEqual([
      "sensory_input",
      "encoding",
      "working_memory",
      "retrieval",
      "output_generation",
    ]);
    expect(result.context?.context).toBeTruthy();
  });

  it("φ₃ applies Prefrontal planning before Thalamus attention", async () => {
    await resetDatabase();
    PrefrontalCortex.resetAll();
    const plan = PrefrontalCortex.plan("What is the best way to implement JWT refresh tokens?");
    expect(plan.intent).toContain("?");
    expect(plan.framed).toContain("JWT");

    const sessionId = "prefontal-plan-session";
    await BrainManager.trackSession(sessionId, "Prefrontal Plan", testDir);
    await MemoryPipeline.runPreTurn({
      message: "Implement a secure login handler with rate limiting",
      session_id: sessionId,
    });
    expect(PrefrontalCortex.getGoal()).toContain("Implement");
  });

  it("runs post-turn φ₄→φ₅ consolidation and long-term storage", async () => {
    await resetDatabase();
    const sessionId = "post-turn-session";
    await BrainManager.trackSession(sessionId, "Post Turn", testDir);

    const turnContent =
      "User: We decided to use PostgreSQL with connection pooling.\n" +
      "Assistant: I'll configure pgBouncer with a max pool size of 20 connections.";

    const result = await MemoryPipeline.runPostTurn({
      message: turnContent,
      session_id: sessionId,
      role: "assistant",
      turn_content: turnContent,
    });

    expect(result.phases.length).toBeGreaterThanOrEqual(2);
    expect(result.phases[0].phase).toBe("consolidation");
    expect(result.phases[1].phase).toBe("long_term_storage");
  });

  it("runs full 8-phase cycle including φ₇ sleep consolidation", async () => {
    await resetDatabase();
    const sessionId = "full-cycle-session";
    await BrainManager.trackSession(sessionId, "Full Cycle", testDir);

    const result = await MemoryPipeline.runFullCycle({
      message: "full cycle memory test query",
      session_id: sessionId,
      turn_content:
        "User: How does auth work?\nAssistant: We use JWT with refresh token rotation.",
      role: "assistant",
    });

    const names = result.phases.map((p) => p.phase);
    expect(names).toContain("sensory_input");
    expect(names).toContain("encoding");
    expect(names).toContain("working_memory");
    expect(names).toContain("consolidation");
    expect(names).toContain("long_term_storage");
    expect(names).toContain("retrieval");
    expect(names).toContain("output_generation");
    expect(names).toContain("sleep_consolidation");
    expect(result.phases.length).toBeGreaterThanOrEqual(8);
  });

  it("logs cycle invariant to audit trail", async () => {
    await resetDatabase();
    const sessionId = "audit-cycle-session";
    await BrainManager.trackSession(sessionId, "Audit Cycle", testDir);

    await MemoryPipeline.runPreTurn({
      message: "audit cycle invariant test",
      session_id: sessionId,
    });

    const entries = await BrainStore.getAuditLog({
      action: "pipeline:cycle_invariant",
      limit: 5,
    });
    expect(entries.length).toBeGreaterThan(0);
    const details =
      typeof entries[0].details === "string"
        ? JSON.parse(entries[0].details)
        : entries[0].details;
    expect(details.mode).toBe("pre_turn");
    expect(details.canonical_order).toContain("sleep_consolidation");
  });

  it("returns enriched phase status with cycle invariant", async () => {
    await resetDatabase();
    const sessionId = "status-session";
    await BrainManager.trackSession(sessionId, "Status", testDir);

    await MemoryPipeline.runPreTurn({
      message: "phase status test",
      session_id: sessionId,
    });

    const status = BrainManager.getPhaseStatus();
    expect(status).toHaveProperty("active_phase");
    expect(status).toHaveProperty("last_completed");
    expect(status).toHaveProperty("cycle_invariant_met");
    expect(status).toHaveProperty("canonical_order");
    expect(status.canonical_order).toHaveLength(8);
    expect(status.cycle_invariant_met).toBe(true);
    expect(status.last_completed?.phase).toBeTruthy();
  });

  it("φ₇ sleep cycle returns sub-phase counts (IMP-06)", async () => {
    await resetDatabase();
    await BrainManager.store({
      category: "fact",
      title: "Sleep sub-phase test",
      content: "Content for sleep consolidation sub-phase testing.",
      importance: 0.8,
    });

    const cycle = await BrainManager.consolidate();
    expect(cycle.sub_phases).toBeDefined();
    expect(typeof cycle.sub_phases.nrem_replay).toBe("number");
    expect(typeof cycle.sub_phases.rem_distill).toBe("number");
    expect(typeof cycle.sub_phases.promote).toBe("number");
  });
});
