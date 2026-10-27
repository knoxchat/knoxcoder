import { describe, expect, it } from "vitest";

import { captureAuditEvent, matchAuditEvent, replayAuditEvent, revertAuditEvent, summarizeRecipeMetrics } from "./metrics";
import { replayExact, type ReplayPorts } from "./replayer";
import type { Recipe } from "./types";

const RESULT = "x".repeat(400); // 100 tokens at 4 chars per token

function recipe(): Recipe {
  return {
    id: "r".repeat(64),
    projectId: "p",
    scope: "project",
    status: "verified",
    title: "t",
    intentText: "",
    intentFingerprint: "f",
    slots: [],
    preconditions: [],
    steps: [{ kind: "write_file", path: "src/a.ts", blobHash: "h-new", baseBlobHash: "h-old" }],
    sourceCheckpointIds: [],
    oracle: { kind: "build", passedAt: "2026-01-01T00:00:00.000Z", command: "npm run build" },
    stats: { replays: 0, ok: 0, reverted: 0, failedVerify: 0 },
    captureCount: 2,
    createdAt: "",
    updatedAt: "",
  };
}

function ports(verifyOk: boolean): ReplayPorts {
  return {
    readBlob: async () => RESULT,
    currentHash: async () => "h-old",
    createCheckpoint: async () => "cp",
    restoreCheckpoint: async () => undefined,
    writeFile: async () => ({ ok: true }),
    deleteFile: async () => ({ ok: true }),
    runCommand: async () => ({ ok: true }),
    verify: async () => ({ ok: verifyOk }),
  };
}

describe("recipe metrics (MC-71)", () => {
  it("counts a real exact replay: one LLM call avoided and the tokens the model would have written", async () => {
    const result = await replayExact(recipe(), ports(true));
    const event = replayAuditEvent(result, { mode: "exact", writtenText: [RESULT] })!;
    expect(event.outcome).toBe("success");
    expect(summarizeRecipeMetrics([event])).toMatchObject({
      attempts: 1, applied: 1, failedVerify: 0, reverted: 0, llmCallsAvoided: 1, tokensSaved: 100, wrongApplyRate: 0, slotReplays: 0,
    });
  });

  it("a poisoned recipe is a wrong apply and saves nothing", async () => {
    const result = await replayExact(recipe(), ports(false));
    expect(result.status).toBe("failed_verify");
    const summary = summarizeRecipeMetrics([replayAuditEvent(result, { mode: "exact", writtenText: [RESULT] })!]);
    expect(summary).toMatchObject({ attempts: 1, failedVerify: 1, llmCallsAvoided: 0, tokensSaved: 0, wrongApplyRate: 1 });
  });

  it("wrong-apply rate = (failed verify + later reverts) / attempts", () => {
    const ok = (n: number) => replayAuditEvent({ status: "applied", recipeId: "a", appliedPaths: ["f"] }, { mode: "exact", writtenText: ["x".repeat(n)] })!;
    const bad = replayAuditEvent({ status: "failed_verify", recipeId: "a", appliedPaths: [] }, { mode: "exact", writtenText: [] })!;
    const summary = summarizeRecipeMetrics([ok(40), ok(40), ok(40), bad, revertAuditEvent("a")]);
    expect(summary.attempts).toBe(4);
    expect(summary.wrongApplyRate).toBe(0.5);
    expect(summary.tokensSaved).toBe(30);
  });

  it("adapt still spends a call and subtracts its reply; refused and drifted runs are not counted", () => {
    const adapt = replayAuditEvent({ status: "applied", recipeId: "a", appliedPaths: ["f"] }, { mode: "adapt", writtenText: ["x".repeat(400)], adaptReply: "y".repeat(80) })!;
    expect(adapt.counts).toMatchObject({ llmCallsAvoided: 0, tokensSaved: 80 });
    for (const status of ["refused", "drifted", "failed_apply"] as const) {
      expect(replayAuditEvent({ status, recipeId: "a", appliedPaths: [] }, { mode: "exact", writtenText: [] })).toBeUndefined();
    }
  });

  it("ignores unrelated events and an empty log", () => {
    expect(summarizeRecipeMetrics([{ action: "create" }])).toMatchObject({ attempts: 0, wrongApplyRate: 0 });
    expect(summarizeRecipeMetrics([])).toMatchObject({ attempts: 0 });
  });

  it("counts slot replays, capture skips, and matcher near-misses", () => {
    const slotted = replayAuditEvent(
      { status: "applied", recipeId: "a", appliedPaths: ["f"] },
      { mode: "exact", writtenText: ["x".repeat(40)], slotted: true },
    )!;
    const summary = summarizeRecipeMetrics([
      slotted,
      captureAuditEvent({ captured: false, reason: "no_mutation" }),
      captureAuditEvent({ captured: false, reason: "no_oracle" }),
      captureAuditEvent({ captured: true, recipeId: "a" }),
      matchAuditEvent({ replayable: false, title: "Create Button", score: 0.62 }),
      matchAuditEvent({ replayable: true, title: "Create Button", score: 1 }),
    ]);
    expect(summary.slotReplays).toBe(1);
    expect(summary.skips).toBe(2);
    expect(summary.skipReasons).toEqual({ no_mutation: 1, no_oracle: 1 });
    expect(summary.nearMisses).toBe(1);
  });
});
