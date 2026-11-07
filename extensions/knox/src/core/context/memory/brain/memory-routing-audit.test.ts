/**
 * MEM-71 — Part X routing audit: δ(x) cuts, coding vs general, W follows Model(x).
 */
import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DELTA_EASY_MAX,
  DELTA_HARD_MIN,
  detectTaskType,
  difficultyFromDelta,
  scoreAndRoute,
  scoreDifficulty,
} from "./TaskRouter.js";

const testDir = path.join(os.tmpdir(), `brain-mem71-${Date.now()}`);

let BrainStore: typeof import("./BrainStore.js").BrainStore;
let resetRoutedWindow: typeof import("./window.js").resetRoutedWindow;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainStore } = await import("./BrainStore.js"));
  ({ resetRoutedWindow } = await import("./window.js"));
  await BrainStore.get();
});

afterEach(() => {
  resetRoutedWindow();
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("MEM-71 Part X routing", () => {
  it("uses δ(x) cuts < 0.3 / 0.3–0.7 / ≥ 0.7", () => {
    expect(DELTA_EASY_MAX).toBe(0.3);
    expect(DELTA_HARD_MIN).toBe(0.7);
    expect(difficultyFromDelta(0.299)).toBe("easy");
    expect(difficultyFromDelta(0.3)).toBe("medium");
    expect(difficultyFromDelta(0.699)).toBe("medium");
    expect(difficultyFromDelta(0.7)).toBe("hard");
  });

  it("classifies TaskType as code vs general", () => {
    expect(detectTaskType("hi")).toBe("general");
    expect(detectTaskType("what is the weather")).toBe("general");
    expect(detectTaskType("fix the bug in src/foo.ts")).toBe("code");
    expect(detectTaskType("```ts\nconst x = 1;\n```")).toBe("code");
    expect(detectTaskType("hello", 1)).toBe("code");
  });

  it("scores a short chat as easy/general and a coded task as code", () => {
    const easy = scoreDifficulty({ message: "hi" });
    expect(easy.difficulty).toBe("easy");
    expect(easy.taskType).toBe("general");
    expect(easy.delta).toBe(easy.score);
    expect(easy.score).toBeLessThan(DELTA_EASY_MAX);

    const coded = scoreDifficulty({
      message: "x".repeat(4000) + "\n```\nfn main() {}\n```",
      toolCount: 2,
      codeBlockCount: 1,
    });
    expect(coded.taskType).toBe("code");
    expect(coded.difficulty).toBe("medium");
    expect(coded.delta).toBeGreaterThanOrEqual(DELTA_EASY_MAX);
    expect(coded.delta).toBeLessThan(DELTA_HARD_MIN);
  });

  it("W follows Model(x) per call", async () => {
    await BrainStore.saveConfig("easy_model", "tiny-easy");
    await BrainStore.saveConfig("hard_model", "big-hard");

    const easy = scoreAndRoute({
      message: "hi",
      llm: { model: "tiny-easy", contextLength: 8000, completionOptions: { maxTokens: 1024 } },
    });
    expect(easy.modelId).toBe("tiny-easy");
    expect(easy.w).toBe(8000);
    expect(easy.taskType).toBe("general");

    const hard = scoreAndRoute({
      message: "x".repeat(5000) + "```\n".repeat(10),
      toolCount: 6,
      codeBlockCount: 4,
      llm: { model: "current", contextLength: 32_000 },
    });
    expect(hard.difficulty).toBe("hard");
    expect(hard.taskType).toBe("code");
    expect(hard.modelId).toBe("big-hard");
    expect(hard.w).not.toBe(32_000);
    expect(hard.w).toBeGreaterThan(easy.w);

    await BrainStore.saveConfig("easy_model", "");
    await BrainStore.saveConfig("hard_model", "");
  });
});
