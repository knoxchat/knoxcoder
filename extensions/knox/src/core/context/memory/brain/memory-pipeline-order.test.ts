/**
 * MEM-31 — live pipeline S → T → A → P → H → B_g → B_s.
 */
import { readFileSync } from "fs";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testDir = path.join(os.tmpdir(), `brain-mem31-${Date.now()}`);
const here = path.dirname(fileURLToPath(import.meta.url));

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let ContextBuilder: typeof import("./ContextBuilder.js").ContextBuilder;
let ContextSections: typeof import("./ContextSections.js").ContextSections;
let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;
let NeuralArchitecture: typeof import("./regions/NeuralArchitecture.js").NeuralArchitecture;
let PrefrontalCortex: typeof import("./regions/PrefrontalCortex.js").PrefrontalCortex;
let Amygdala: typeof import("./regions/Amygdala.js").Amygdala;
let CURRENT_TURN_SLOT_ID: typeof import("./WorkingMemory.js").CURRENT_TURN_SLOT_ID;
let BOXED_O_X: typeof import("./regions/flow.js").BOXED_O_X;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;

  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ ContextBuilder } = await import("./ContextBuilder.js"));
  ({ ContextSections } = await import("./ContextSections.js"));
  ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
  ({ NeuralArchitecture } = await import("./regions/NeuralArchitecture.js"));
  ({ PrefrontalCortex } = await import("./regions/PrefrontalCortex.js"));
  ({ Amygdala } = await import("./regions/Amygdala.js"));
  ({ CURRENT_TURN_SLOT_ID } = await import("./WorkingMemory.js"));
  ({ BOXED_O_X } = await import("./regions/flow.js"));

  await BrainStore.get();
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function resetDatabase(): Promise<void> {
  const db = await BrainStore.get();
  await db.exec("DELETE FROM brain_procedures");
  await db.exec("DELETE FROM brain_learning_patterns");
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
  MemoryPipeline.resetInjectStateForTests();
}

describe("MEM-31 live pipeline order", () => {
  it("describes the boxed O(x) and one live stage list", () => {
    expect(BOXED_O_X).toBe("O(x) = B_s(B_g(H(P(A(T(S(x)))))))");
    expect(NeuralArchitecture.describeFlow()).toContain(BOXED_O_X);
    expect(NeuralArchitecture.describeFlow()).toContain("B_s→H");
    expect(NeuralArchitecture.liveStageOrder()).toEqual([
      "S",
      "T",
      "A",
      "P",
      "H",
      "B_g",
      "B_s",
    ]);
  });

  it("processPreTurn is MemoryPipeline.runPreTurn", () => {
    const source = readFileSync(path.join(here, "regions/NeuralArchitecture.ts"), "utf8");
    expect(source).toMatch(/MemoryPipeline\.runPreTurn/);
    expect(source).not.toMatch(/RetrievalFusion\.search/);
    expect(source).not.toMatch(/ContextBuilder\.buildDetailed/);
  });

  it("runPreTurn and processPreTurn share phase order, I₀, and lastInject", async () => {
    await resetDatabase();
    const sessionId = "mem31-same-path";
    await BrainManager.trackSession(sessionId, "MEM-31 same path", testDir);

    const viaPipeline = await MemoryPipeline.runPreTurn({
      message: "URGENT: review JWT refresh authentication now!!!",
      session_id: sessionId,
      goal: "Review JWT refresh",
    });
    const injectAfterPipeline = MemoryPipeline.getLastInject();

    MemoryPipeline.resetInjectStateForTests();
    PrefrontalCortex.resetAll();

    const viaNeural = await NeuralArchitecture.processPreTurn({
      message: "URGENT: review JWT refresh authentication now!!!",
      session_id: sessionId,
      goal: "Review JWT refresh",
    });

    expect(viaPipeline.phases.map((p) => p.phase)).toEqual([
      "sensory_input",
      "encoding",
      "working_memory",
      "retrieval",
      "output_generation",
    ]);
    expect(viaNeural.phases.map((p) => p.phase)).toEqual(
      viaPipeline.phases.map((p) => p.phase),
    );
    expect(viaPipeline.phases.find((p) => p.phase === "working_memory")?.audit?.flow).toBe(
      "T→A→P",
    );
    expect(viaNeural.salience?.i0).toBeGreaterThan(0.5);
    expect(viaPipeline.salience?.i0).toBeCloseTo(viaNeural.salience?.i0 ?? 0);
    expect(MemoryPipeline.getLastInject()?.items.length).toBeGreaterThan(0);
    expect(injectAfterPipeline?.items.some((i) => i.kind === "goal")).toBe(true);
  });

  it("Amygdala is a live I₀ stage, not a 0.55 WM gate", async () => {
    await resetDatabase();
    const sessionId = "mem31-amygdala";
    await BrainManager.trackSession(sessionId, "MEM-31 A", testDir);

    const mild = Amygdala.weight("hello there", "user");
    const urgent = Amygdala.weight("URGENT CRITICAL: fix authentication now!!!", "user");
    expect(urgent.i0).toBeGreaterThan(mild.i0);
    expect(urgent.valence).toBe("urgency");

    await MemoryPipeline.runPreTurn({
      message: "hello there",
      session_id: sessionId,
    });
    const mildApplied = MemoryPipeline.getLastSalience();
    expect(mildApplied?.i0).toBeCloseTo(mild.i0);
    expect(BrainManager.getWorkingMemory().get(CURRENT_TURN_SLOT_ID)).toBeDefined();
    expect(PrefrontalCortex.getSalienceHint(sessionId)?.salience).toBeCloseTo(mild.salience, 1);
    expect(PrefrontalCortex.getGoal(sessionId)).toBeNull();

    await MemoryPipeline.runPreTurn({
      message: "URGENT CRITICAL: fix authentication now!!!",
      session_id: sessionId,
    });
    const urgentApplied = MemoryPipeline.getLastSalience();
    expect(urgentApplied?.i0).toBeGreaterThan(mildApplied?.i0 ?? 0);
    expect(urgentApplied?.valence).toBe("urgency");
  });

  it("B_g selects procedures before ContextBuilder and skips a second hunt", async () => {
    await resetDatabase();
    const sessionId = "mem31-basal";
    await BrainManager.trackSession(sessionId, "MEM-31 B_g", testDir);
    await BrainStore.addProcedure({
      name: "JWT refresh rotation",
      description: "Rotate JWT refresh tokens during authentication",
      steps: ["issue access token", "rotate refresh token"],
      trigger_pattern: "jwt refresh authentication",
      category: "coding",
    });

    const spy = vi.spyOn(ContextSections, "collectProcedureCandidates");
    const result = await MemoryPipeline.runPreTurn({
      message: "How does JWT refresh authentication work?",
      session_id: sessionId,
      goal: "Understand JWT refresh authentication",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.procedural_hits).toBeGreaterThanOrEqual(1);
    expect(result.context?.items.some((i) => i.kind === "procedure")).toBe(true);
    expect(
      result.phases.find((p) => p.phase === "output_generation")?.audit?.procedural_hits,
    ).toBeGreaterThanOrEqual(1);
    spy.mockRestore();

    const skipSpy = vi.spyOn(ContextSections, "collectProcedureCandidates");
    await ContextBuilder.buildDetailed({
      message: "How does JWT refresh authentication work?",
      session_id: sessionId,
      procedure_hits: [],
      pattern_hits: [],
      include_graph: false,
    });
    expect(skipSpy).not.toHaveBeenCalled();
    skipSpy.mockRestore();
  });

  it("B_s→H queues injects on assemble so post-turn can attribute", async () => {
    await resetDatabase();
    const sessionId = "mem31-bs-h";
    const token = "knoxmem31bsh42";
    await BrainManager.trackSession(sessionId, "MEM-31 Bs→H", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: `Login ${token} oauth jwt refresh`,
      content: `The ${token} oauth-jwt-refresh service stores login facts.`,
      keywords: `${token}, oauth, jwt, refresh`,
      importance: 0.99,
      session_id: sessionId,
    });

    const built = await MemoryPipeline.runPreTurn({
      message: `${token} oauth jwt refresh login`,
      session_id: sessionId,
      turn_id: "mem31-bs-h:1",
    });
    expect(MemoryPipeline.getLastInject()?.turn_id).toBe("mem31-bs-h:1");
    expect(built.context?.items.some((item) => item.id === id && item.cite)).toBe(true);

    const attribution = await MemoryPipeline.attributeTurn({
      message: `Reuse the login service [mem:semantic:${id}]`,
      session_id: sessionId,
      turn_id: "mem31-bs-h:1",
      assistant_message: `Reuse the login service [mem:semantic:${id}]`,
      turn_succeeded: true,
    });
    expect(attribution.injected).toBeGreaterThan(0);
    expect(attribution.cited).toBeGreaterThan(0);
  });
});
