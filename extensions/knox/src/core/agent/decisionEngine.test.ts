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
    fileOverlap: 0,
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
    const d = decide(base({ match: match({ score: 0.6, replayable: false, reason: "fingerprint_similar", fingerprintSimilarity: 0.62 }) }));
    expect(d.mode).toBe("suggest");
    expect(d.why).toMatch(/similar to "t", 62% overlap, not reused/);
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

  it("suggests similar matches when autoReplay is exact; adapt is opt-in", () => {
    const similar = match({ score: 0.9, reason: "fingerprint_similar_fusion" });
    expect(decide(base({ match: similar })).mode).toBe("suggest");
    const d = decide(base({ match: similar, autoReplay: "adapt" }));
    expect(d.mode).toBe("adapt");
    expect(d.needsConfirmation).toBe(true);
  });

  it("asks for slot values, asks on a clean merge, and adapts drifted files only when adapt is on", () => {
    const slots = decide(base({ unfilledSlots: 1, match: match({}, { slots: [{ name: "x", kind: "identifier" }] }) }));
    expect(slots.mode).toBe("exact");
    expect(slots.needsConfirmation).toBe(true);
    const merged = decide(base({ drifted: true, merged: true }));
    expect(merged.mode).toBe("exact");
    expect(merged.needsConfirmation).toBe(true);
    expect(decide(base({ drifted: true })).mode).toBe("suggest");
    const adapted = decide(base({ drifted: true, autoReplay: "adapt" }));
    expect(adapted.mode).toBe("adapt");
    expect(adapted.needsConfirmation).toBe(true);
  });

  it("hard tasks downgrade adapt to suggest but keep exact", () => {
    expect(decide(base({ drifted: true, autoReplay: "adapt", difficulty: "hard" })).mode).toBe("suggest");
    expect(decide(base({ difficulty: "hard" })).mode).toBe("exact");
  });

  it("parameterized exact always asks, even on Automatic", () => {
    const d = decide(
      base({
        match: match({}, { slots: [{ name: "componentName", kind: "identifier" }] }),
        unfilledSlots: 0,
        slotFilledFromMessage: 1,
        parameterizedSlots: 1,
        guessedSlots: 0,
      }),
    );
    expect(d.mode).toBe("exact");
    expect(d.needsConfirmation).toBe(true);
  });

  it("byte-identical slotted replay may auto-apply on Automatic + Auto permission", () => {
    const d = decide(
      base({
        match: match({}, { slots: [{ name: "componentName", kind: "identifier" }] }),
        unfilledSlots: 0,
        slotFilledFromMessage: 1,
        parameterizedSlots: 0,
        guessedSlots: 0,
      }),
    );
    expect(d.mode).toBe("exact");
    expect(d.needsConfirmation).toBe(false);
  });

  it("asks for confirmation in ask mode and default permission mode", () => {
    expect(decide(base({ autoReplay: "ask" })).needsConfirmation).toBe(true);
    expect(decide(base({ permissionMode: "default" })).needsConfirmation).toBe(true);
    expect(decide(base({ permissionMode: "fullAuto" })).needsConfirmation).toBe(false);
    expect(decide(base({ permissionMode: "acceptEdits" })).needsConfirmation).toBe(false);
  });

  it("Ask permission still confirms a byte-identical exact replay", () => {
    const d = decide(base({ permissionMode: "default", autoReplay: "exact" }));
    expect(d.mode).toBe("exact");
    expect(d.needsConfirmation).toBe(true);
  });

  it("asks before composing disjoint recipes", () => {
    const d = decide(base({ composeCount: 2, permissionMode: "fullAuto" }));
    expect(d.mode).toBe("exact");
    expect(d.needsConfirmation).toBe(true);
    expect(d.why).toMatch(/2 disjoint recipes will run in sequence/);
  });

  it("asks when two recipes clear the replay threshold", () => {
    const d = decide(base({ competingReplayable: 2, permissionMode: "fullAuto" }));
    expect(d.mode).toBe("exact");
    expect(d.needsConfirmation).toBe(true);
    expect(d.why).toMatch(/2 recipes match/);
  });

  it("asks before replaying a command-only recipe", () => {
    const d = decide(
      base({
        match: match({}, { steps: [{ kind: "command", command: "npm test" }] }),
        permissionMode: "fullAuto",
      }),
    );
    expect(d.mode).toBe("exact");
    expect(d.needsConfirmation).toBe(true);
    expect(d.why).toMatch(/command recipe/);
  });

  it("explains a global precondition miss", () => {
    const d = decide(
      base({
        match: match({}, { scope: "global" }),
        preconditions: { ok: false, failures: [{ precondition: { kind: "framework", value: "react" }, reason: "framework react not detected" }], summary: "Replay refused: framework react not detected" },
      }),
    );
    expect(d.mode).toBe("suggest");
    expect(d.why).toBe("global recipe refused (framework react not detected)");
  });
});
