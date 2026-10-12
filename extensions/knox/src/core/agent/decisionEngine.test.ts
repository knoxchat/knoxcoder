import { describe, expect, it } from "vitest";
import { decide, type DecisionInput } from "./decisionEngine.js";
import type { RecipeMatch } from "../context/memory/recipes/RecipeMatcher.js";
import type { Recipe } from "../context/memory/recipes/types.js";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "a".repeat(64),
    projectId: "p",
    scope: "project",
    status: "verified",
    title: "t",
    intentText: "t",
    intentFingerprint: "t",
    slots: [],
    preconditions: [],
    steps: [],
    sourceCheckpointIds: [],
    stats: { replays: 5, ok: 5, reverted: 0, failedVerify: 0 },
    captureCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function match(over: Partial<RecipeMatch> = {}, r: Partial<Recipe> = {}): RecipeMatch {
  return {
    recipe: recipe(r),
    score: 1,
    reason: "fingerprint_exact",
    why: "same",
    fingerprintSimilarity: 1,
    fusionScore: 0,
    replayable: true,
    ...over,
  };
}

const OK = { ok: true, failures: [], summary: "" };

function base(over: Partial<DecisionInput> = {}): DecisionInput {
  return { match: match(), preconditions: OK, autoReplay: "exact", permissionMode: "acceptEdits", ...over };
}

describe("DecisionEngine decision table", () => {
  it("generate when nothing matches", () => {
    expect(decide({}).mode).toBe("generate");
  });

  it("generate when the recipe is not verified", () => {
    expect(decide(base({ match: match({}, { status: "candidate" }) })).mode).toBe("generate");
  });

  it("generate when the score is below the floor", () => {
    expect(decide(base({ match: match({ score: 0.1, replayable: false }) })).mode).toBe("generate");
  });

  it("suggest when autoReplay is off", () => {
    expect(decide(base({ autoReplay: "off" })).mode).toBe("suggest");
    expect(decide({ match: match(), preconditions: OK }).mode).toBe("suggest");
  });

  it("suggest below the replay threshold", () => {
    const d = decide(base({ match: match({ score: 0.6, replayable: false, reason: "fingerprint_similar" }) }));
    expect(d.mode).toBe("suggest");
  });

  it("suggest, with the reason, when preconditions fail", () => {
    const d = decide(
      base({ preconditions: { ok: false, failures: [], summary: "Replay refused: required file a.ts does not exist" } }),
    );
    expect(d.mode).toBe("suggest");
    expect(d.why).toContain("a.ts");
  });

  it("suggest when preconditions were not checked", () => {
    expect(decide(base({ preconditions: undefined })).mode).toBe("suggest");
  });

  it("exact for a clean exact match", () => {
    const d = decide(base());
    expect(d.mode).toBe("exact");
    expect(d.needsConfirmation).toBe(false);
    expect(d.recipeId).toBe("a".repeat(64));
    expect(d.why).toContain("used 5x, 0 reverts");
  });

  it("never exact if the recipe has recent reverts", () => {
    const m = match({}, { stats: { replays: 5, ok: 4, reverted: 1, failedVerify: 0 } });
    expect(decide(base({ match: m })).mode).toBe("suggest");
    expect(decide(base({ recentReverts: 2 })).mode).toBe("suggest");
  });

  it("recentReverts=0 overrides lifetime reverts", () => {
    const m = match({}, { stats: { replays: 5, ok: 4, reverted: 1, failedVerify: 0 } });
    expect(decide(base({ match: m, recentReverts: 0 })).mode).toBe("exact");
  });

  it("adapt for a similar (not exact) replayable match", () => {
    const d = decide(base({ match: match({ score: 0.9, reason: "fingerprint_similar_fusion" }) }));
    expect(d.mode).toBe("adapt");
  });

  it("adapt when slots are unfilled or files drifted", () => {
    expect(decide(base({ unfilledSlots: 1 })).mode).toBe("adapt");
    expect(decide(base({ drifted: true })).mode).toBe("adapt");
  });

  it("hard tasks downgrade adapt to suggest but keep exact", () => {
    expect(decide(base({ unfilledSlots: 2, difficulty: "hard" })).mode).toBe("suggest");
    expect(decide(base({ difficulty: "hard" })).mode).toBe("exact");
  });

  it("asks for confirmation in ask mode and default permission mode", () => {
    expect(decide(base({ autoReplay: "ask" })).needsConfirmation).toBe(true);
    expect(decide(base({ permissionMode: "default" })).needsConfirmation).toBe(true);
    expect(decide(base({ permissionMode: "fullAuto" })).needsConfirmation).toBe(false);
  });
});
