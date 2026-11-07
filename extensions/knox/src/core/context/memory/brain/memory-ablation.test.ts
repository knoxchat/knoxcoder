/**
 * MEM-59 — ablation probes: lexical judge, opt-in + budget, and the credit path.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ABLATION_DISTANCE_THRESHOLD,
  judgeAblation,
  lexicalDistance,
  vocabularyCoverage,
  type AblationRunner,
} from "./ablation.js";

describe("MEM-59 lexical judge", () => {
  it("identical answers have distance 0, disjoint answers 1", () => {
    expect(lexicalDistance("use tabs for indentation", "use tabs for indentation")).toBe(0);
    expect(lexicalDistance("alpha beta gamma", "delta epsilon zeta")).toBe(1);
  });

  it("changed needs distance AND a drop in the removed memory's vocabulary", () => {
    const memory = "Deploy with docker compose on port 5173 using the staging profile";
    const control = "Run docker compose with the staging profile and expose port 5173 for the deploy";
    const ablated = "Check the logs directory and restart the service manually after reading output";
    const verdict = judgeAblation({ ablated, control }, { original_answer: control, memory_text: memory });
    expect(verdict.via).toBe("lexical");
    expect(verdict.distance).toBeGreaterThanOrEqual(ABLATION_DISTANCE_THRESHOLD);
    expect(verdict.status).toBe("changed");
  });

  it("a different wording that keeps the memory's content is not a change", () => {
    const memory = "Deploy with docker compose on port 5173 using the staging profile";
    const control = "Run docker compose with the staging profile and expose port 5173 for the deploy";
    const ablated = "Deploy: docker compose, staging profile, port 5173";
    const verdict = judgeAblation({ ablated, control }, { original_answer: control, memory_text: memory });
    expect(verdict.status).toBe("unchanged");
    expect(vocabularyCoverage(ablated, memory)).toBeGreaterThan(0.5);
  });

  it("a different wording that drops nothing from the memory is not a change even when far apart", () => {
    const memory = "port 5173 staging profile";
    const control = "totally unrelated words about gardens and soil";
    const ablated = "completely other phrases regarding oceans and tides";
    expect(judgeAblation({ ablated, control }, { original_answer: control, memory_text: memory }).status).toBe(
      "unchanged",
    );
  });

  it("the turn's own oracle wins: control passes, ablated fails → changed", () => {
    expect(
      judgeAblation(
        { ablated: "same text", control: "same text", control_succeeded: true, ablated_succeeded: false },
        { original_answer: "same text", memory_text: "x" },
      ),
    ).toEqual({ status: "changed", via: "oracle" });
    expect(
      judgeAblation(
        { ablated: "a", control: "b", control_succeeded: true, ablated_succeeded: true },
        { original_answer: "a", memory_text: "x" },
      ).status,
    ).toBe("unchanged");
  });
});

const testDir = path.join(os.tmpdir(), `brain-mem59-${Date.now()}`);

describe("MEM-59 probes", () => {
  let Ablation: typeof import("./ablation.js");
  let BrainManager: typeof import("./BrainManager.js").BrainManager;
  let BrainStore: typeof import("./BrainStore.js").BrainStore;
  let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;

  const TOKEN = "quartzmem59leaf";
  const FACT_TEXT = `The ${TOKEN} release uses docker compose on port 5173 with the staging profile.`;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    Ablation = await import("./ablation.js");
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "global");
  });

  afterEach(async () => {
    Ablation.setAblationRunner(null);
    Ablation.setAblationRng(null);
    Ablation.clearAblationQueue();
    await BrainStore.saveConfig("ablation_enabled", "false");
    await BrainStore.saveConfig("ablation_rate", "0.02");
    await BrainStore.saveConfig("ablation_daily_budget", "10");
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
    await db.exec("DELETE FROM brain_attribution");
    await db.exec("DELETE FROM brain_tags");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_sessions");
    MemoryPipeline.resetInjectStateForTests();
  }

  async function turnWithUncitedMemory(sessionId: string, turnId: string): Promise<number> {
    await BrainManager.trackSession(sessionId, "MEM-59", testDir);
    const id = await BrainManager.store({
      category: "fact",
      title: `Release ${TOKEN} docker staging`,
      content: FACT_TEXT,
      keywords: `${TOKEN}, docker, staging`,
      importance: 0.5,
      session_id: sessionId,
    });
    await MemoryPipeline.runPreTurn({ message: `how do I deploy ${TOKEN}`, session_id: sessionId, turn_id: turnId });
    await MemoryPipeline.runPostTurn({
      message: "deploying",
      session_id: sessionId,
      user_message: `how do I deploy ${TOKEN}`,
      assistant_message: "Run docker compose with the staging profile on port 5173.",
      turn_id: turnId,
      turn_succeeded: true,
    });
    return id;
  }

  async function memoryRow(id: number) {
    const db = await BrainStore.get();
    return (await db.get(
      "SELECT helpful_count, unhelpful_count, stability FROM brain_semantic WHERE id = ?",
      [id],
    )) as { helpful_count: number; unhelpful_count: number; stability: number };
  }

  const runnerChanged: AblationRunner = {
    async regenerate() {
      return {
        control: "Run docker compose with the staging profile and expose port 5173 for the deploy",
        ablated: "Check the logs directory and restart the service manually after reading output",
      };
    },
  };
  const runnerSame: AblationRunner = {
    async regenerate() {
      return {
        control: "Run docker compose with the staging profile on port 5173",
        ablated: "Run docker compose staging profile port 5173",
      };
    },
  };

  it("is off by default: no queue, no runner call, no cost", async () => {
    await reset();
    let calls = 0;
    Ablation.setAblationRunner({
      async regenerate() {
        calls++;
        return null;
      },
    });
    Ablation.setAblationRng(() => 0);
    await turnWithUncitedMemory("mem59-off", "t-off");
    expect(await Ablation.maybeEnqueueAblation({
      turn_id: "t-off", user_message: "x", original_answer: "y", outcome: "succeeded",
    })).toBeNull();
    expect(Ablation.pendingAblations()).toBe(0);
    expect(calls).toBe(0);
  });

  it("only succeeded turns are probed, at the configured rate", async () => {
    await reset();
    await turnWithUncitedMemory("mem59-gate", "t-gate");
    await BrainStore.saveConfig("ablation_enabled", "true");
    Ablation.setAblationRunner(runnerChanged);
    Ablation.setAblationRng(() => 0); // always under the rate
    expect(await Ablation.maybeEnqueueAblation({
      turn_id: "t-gate", user_message: "x", original_answer: "y", outcome: "failed",
    })).toBeNull();
    Ablation.setAblationRng(() => 0.99); // never under 2%
    expect(await Ablation.maybeEnqueueAblation({
      turn_id: "t-gate", user_message: "x", original_answer: "y", outcome: "succeeded",
    })).toBeNull();
    Ablation.setAblationRng(() => 0);
    const job = await Ablation.maybeEnqueueAblation({
      turn_id: "t-gate", user_message: "x", original_answer: "y", outcome: "succeeded",
    });
    expect(job?.removed.cite.type).toBe("semantic");
    expect(job?.removed.text).toContain(TOKEN);
  });

  it("changed answer: h += 1, FSRS useful, ω refunded, row source='ablation'", async () => {
    await reset();
    const id = await turnWithUncitedMemory("mem59-yes", "t-yes");
    await BrainStore.saveConfig("ablation_enabled", "true");
    Ablation.setAblationRunner(runnerChanged);
    Ablation.setAblationRng(() => 0);
    const before = await memoryRow(id);
    expect(before.helpful_count).toBe(0);
    expect(before.unhelpful_count).toBeCloseTo(0.1, 10); // MEM-57 charge

    const job = await Ablation.maybeEnqueueAblation({
      turn_id: "t-yes",
      session_id: "mem59-yes",
      user_message: `how do I deploy ${TOKEN}`,
      original_answer: "Run docker compose with the staging profile on port 5173.",
      outcome: "succeeded",
    });
    expect(job).not.toBeNull();
    const [outcome] = await Ablation.drainAblationQueue();
    expect(outcome.status).toBe("changed");

    const after = await memoryRow(id);
    expect(after.helpful_count).toBe(1);
    expect(after.unhelpful_count).toBeCloseTo(0, 10);
    expect(after.stability).toBeGreaterThan(before.stability);

    const db = await BrainStore.get();
    const row = await db.get(
      "SELECT source, helpful, cited, injected FROM brain_attribution WHERE turn_id = 'ablation:t-yes'",
    );
    expect(row).toEqual({ source: "ablation", helpful: 1, cited: 0, injected: 1 });
    expect(await Ablation.ablationsToday()).toBe(1);
  });

  it("unchanged answer: logged as evidence, but h/u/S do not move", async () => {
    await reset();
    const id = await turnWithUncitedMemory("mem59-no", "t-no");
    await BrainStore.saveConfig("ablation_enabled", "true");
    Ablation.setAblationRunner(runnerSame);
    Ablation.setAblationRng(() => 0);
    const before = await memoryRow(id);
    await Ablation.maybeEnqueueAblation({
      turn_id: "t-no",
      session_id: "mem59-no",
      user_message: `how do I deploy ${TOKEN}`,
      original_answer: "Run docker compose with the staging profile on port 5173.",
      outcome: "succeeded",
    });
    const [outcome] = await Ablation.drainAblationQueue();
    expect(outcome.status).toBe("unchanged");
    expect(await memoryRow(id)).toEqual(before);
    const db = await BrainStore.get();
    const row = await db.get("SELECT source, helpful FROM brain_attribution WHERE turn_id = 'ablation:t-no'");
    expect(row).toEqual({ source: "ablation", helpful: 0 });
  });

  it("the daily budget is a hard stop", async () => {
    await reset();
    await turnWithUncitedMemory("mem59-budget", "t-b1");
    await BrainStore.saveConfig("ablation_enabled", "true");
    await BrainStore.saveConfig("ablation_daily_budget", "1");
    Ablation.setAblationRunner(runnerSame);
    Ablation.setAblationRng(() => 0);
    const first = await Ablation.maybeEnqueueAblation({
      turn_id: "t-b1", session_id: "mem59-budget", user_message: "x", original_answer: "y", outcome: "succeeded",
    });
    expect(first).not.toBeNull();
    // the queued job already counts against the budget
    expect(await Ablation.ablationBudgetRemaining()).toBe(0);
    expect(await Ablation.maybeEnqueueAblation({
      turn_id: "t-b1", session_id: "mem59-budget", user_message: "x", original_answer: "y", outcome: "succeeded",
    })).toBeNull();
    await Ablation.drainAblationQueue();
    expect(await Ablation.ablationBudgetRemaining()).toBe(0);
  });

  it("a runner that throws or declines changes nothing", async () => {
    await reset();
    const id = await turnWithUncitedMemory("mem59-err", "t-err");
    await BrainStore.saveConfig("ablation_enabled", "true");
    Ablation.setAblationRng(() => 0);
    const before = await memoryRow(id);
    Ablation.setAblationRunner({ regenerate: async () => { throw new Error("llm down"); } });
    const job = await Ablation.maybeEnqueueAblation({
      turn_id: "t-err", session_id: "mem59-err", user_message: "x", original_answer: "y", outcome: "succeeded",
    });
    expect(job).not.toBeNull();
    const [outcome] = await Ablation.drainAblationQueue();
    expect(outcome.status).toBe("error");
    expect(await memoryRow(id)).toEqual(before);
  });
});
