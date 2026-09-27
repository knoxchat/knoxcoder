/**
 * REL-13 — Explicit task identity.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyTaskBias,
  TASK_SAME_BOOST,
  type FusionResult,
} from "./RetrievalFusion.js";
import {
  ensureTaskForTurn,
  getOpenTask,
  isExplicitNewQuestion,
  resetTaskContext,
  taskTitleFromMessage,
} from "./TaskContext.js";
import type { SemanticMemory } from "./types.js";

const testDir = path.join(os.tmpdir(), `brain-task-${Date.now()}`);

let BrainManager: typeof import("./BrainManager.js").BrainManager;
let BrainStore: typeof import("./BrainStore.js").BrainStore;
let AutoMemory: typeof import("./AutoMemory.js").AutoMemory;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("./BrainManager.js"));
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ AutoMemory } = await import("./AutoMemory.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  await BrainStore.saveConfig("memory_scope", "project");
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
  await db.exec("DELETE FROM brain_semantic");
  await db.exec("DELETE FROM brain_tasks");
  await db.exec("DELETE FROM brain_session_topics");
  await db.exec("DELETE FROM brain_sessions");
  resetTaskContext();
  AutoMemory.resetTopicTracking();
}

function stubHit(id: number, score: number, taskId: string | null): FusionResult {
  return {
    id,
    type: "semantic",
    score,
    scores: { fts5: 0.5, trigram: 0.2, graph: 0, recency: 0.5, importance: 0.5 },
    data: { id, task_id: taskId } as SemanticMemory,
  };
}

describe("REL-13 TaskContext helpers (pure)", () => {
  it("treats 'new question:' as an explicit new task", () => {
    expect(isExplicitNewQuestion("new question: how do I style the button?")).toBe(true);
    expect(isExplicitNewQuestion("continue")).toBe(false);
    expect(taskTitleFromMessage("new question: style the button")).toBe("style the button");
  });

  it("boosts the current task after the gate", () => {
    const ranked = applyTaskBias(
      [stubHit(1, 0.7, "task-a"), stubHit(2, 0.7, "task-b")],
      { currentTaskId: "task-b" },
    );
    expect(ranked[0].id).toBe(2);
    expect(ranked[0].score).toBeCloseTo(0.7 + TASK_SAME_BOOST);
    expect(ranked[1].score).toBe(0.7);
  });
});

describe("REL-13 task identity (sqlite)", () => {
  it("two sequential tasks in one session have two rows and tagged memories", async () => {
    await reset();
    const sessionId = "rel13-two-tasks";
    await BrainManager.trackSession(sessionId, "Two tasks", testDir);

    const taskA = await ensureTaskForTurn(
      sessionId,
      "Implement OAuth login with JWT refresh",
      "new_task",
    );
    expect(taskA).toBeTruthy();
    await AutoMemory.extract(
      "We decided to use JWT refresh with OAuth for the login flow.",
      "user",
      sessionId,
    );

    const taskB = await ensureTaskForTurn(
      sessionId,
      "new question: update the README badges",
      "new_task",
    );
    expect(taskB).toBeTruthy();
    expect(taskB!.id).not.toBe(taskA!.id);
    await AutoMemory.extract(
      "We decided to put shields.io badges in the README header.",
      "user",
      sessionId,
    );

    const tasks = await BrainStore.listSessionTasks(sessionId);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.id === taskA!.id)?.closed_at).toBeTruthy();
    expect(tasks.find((t) => t.id === taskB!.id)?.closed_at).toBeNull();
    expect(tasks.find((t) => t.id === taskB!.id)?.id).toBe(taskB!.id);

    const db = await BrainStore.get();
    const rows = (await db.all(
      "SELECT title, task_id FROM brain_semantic WHERE source_session_id = ? ORDER BY id ASC",
      [sessionId],
    )) as { title: string; task_id: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const oauth = rows.find((r) => /oauth|jwt/i.test(r.title));
    const readme = rows.find((r) => /readme|badge/i.test(r.title));
    expect(oauth?.task_id).toBe(taskA!.id);
    expect(readme?.task_id).toBe(taskB!.id);
  });

  it("continue stays on the open task; new question closes it", async () => {
    await reset();
    const sessionId = "rel13-continue";
    await BrainManager.trackSession(sessionId, "Continue", testDir);

    const opened = await ensureTaskForTurn(
      sessionId,
      "Implement OAuth login with JWT refresh",
      "new_task",
    );
    const continued = await ensureTaskForTurn(sessionId, "continue", "continuation");
    expect(continued?.id).toBe(opened?.id);
    expect((await getOpenTask(sessionId))?.id).toBe(opened?.id);

    const next = await ensureTaskForTurn(
      sessionId,
      "new question: how do I style the button?",
      "new_task",
    );
    expect(next?.id).not.toBe(opened?.id);
    const tasks = await BrainStore.listSessionTasks(sessionId);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.id === opened!.id)?.closed_at).toBeTruthy();
    expect(tasks.find((t) => t.id === next!.id)?.closed_at).toBeNull();
    expect(tasks.find((t) => t.id === next!.id)?.title.toLowerCase()).toContain("style");
  });
});
