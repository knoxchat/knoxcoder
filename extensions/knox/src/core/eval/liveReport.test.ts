import { describe, expect, it } from "vitest";

import {
  checkTrend,
  compareParity,
  parseHistory,
  toHistoryEntry,
  type LiveRun,
} from "./liveReport";
import { LIVE_TASKS } from "./liveTasks";

const run = (taskId: string, path: LiveRun["path"], pass: boolean): LiveRun => ({
  taskId,
  path,
  pass,
  stoppedReason: "completed",
  steps: 2,
  promptTokens: 100,
  completionTokens: 10,
  ms: 1,
});

describe("live eval report", () => {
  it("passes when the paths agree and fails on a larger drop", () => {
    const same = [run("a", "loop", true), run("a", "chatTurn", true)];
    expect(compareParity(same).ok).toBe(true);

    const worse = [
      run("a", "loop", true),
      run("b", "loop", true),
      run("a", "chatTurn", false),
      run("b", "chatTurn", false),
    ];
    const verdict = compareParity(worse);
    expect(verdict.ok).toBe(false);
    expect(verdict.regressions.map((r) => r.taskId)).toEqual(["a", "b"]);
    expect(compareParity(worse, 2).ok).toBe(true);
  });

  it("task checks reject untouched workspaces", () => {
    for (const task of LIVE_TASKS) {
      if (task.id === "secret-write-denied") {
        continue;
      }
      const out = task.check({
        stoppedReason: "completed",
        steps: 0,
        summary: "",
        files: task.workspace,
        toolTrace: [],
      });
      expect(out.pass, task.id).toBe(false);
    }
  });

  it("tracks history and flags a regression or token blow-up", () => {
    const meta = { model: "m", variant: "full", costUsd: null };
    const good = toHistoryEntry(
      [run("a", "chatTurn", true), run("b", "chatTurn", true)],
      { ...meta, date: "d1" },
    );
    expect(checkTrend([], good).ok).toBe(true);
    const bad = toHistoryEntry(
      [run("a", "chatTurn", false), run("b", "chatTurn", true)],
      { ...meta, date: "d2" },
    );
    const verdict = checkTrend([good], bad);
    expect(verdict.ok).toBe(false);
    expect(verdict.regressed).toEqual([{ taskId: "a", from: 1, to: 0 }]);
    const fat = { ...good, avgTokens: good.avgTokens * 2 };
    expect(checkTrend([good], fat).ok).toBe(false);
    // other model: no baseline
    expect(checkTrend([good], { ...bad, model: "x" }).ok).toBe(true);
    const text = [good, bad].map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n";
    expect(parseHistory(text)).toHaveLength(2);
  });
});
