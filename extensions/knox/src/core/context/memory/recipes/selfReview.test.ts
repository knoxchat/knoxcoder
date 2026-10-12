import { describe, expect, it } from "vitest";

import { errorSignature, findDuplicateRecipes, findRepeats, mergedStats, planMemoryUpdates, type ReviewEvent } from "./selfReview";
import type { Recipe } from "./types";

function r(id: string, ok: number, over: Partial<Recipe> = {}): Recipe {
  return {
    id, projectId: "p", scope: "project", status: "verified", title: "", intentText: "", intentFingerprint: "fp",
    slots: [], preconditions: [], steps: [{ kind: "write_file", path: "a.ts", blobHash: id }], sourceCheckpointIds: [],
    stats: { replays: ok, ok, reverted: 0, failedVerify: 0 }, captureCount: 1, createdAt: id, updatedAt: id, ...over,
  };
}

describe("selfReview", () => {
  it("normalizes volatile parts of error text", () => {
    expect(errorSignature("ENOENT /Users/a/x.ts line 12")).toBe(errorSignature("ENOENT /tmp/y.ts line 99"));
  });
  it("finds only failures repeated >= 3 times", () => {
    const ev: ReviewEvent[] = [
      ...[1, 2, 3].map((n) => ({ kind: "build_fail" as const, text: `TS2304 at /src/f${n}.ts:${n}`, recipeId: "r1" })),
      { kind: "tool_error", text: "once" },
      { kind: "tool_error", text: "once" },
    ];
    const f = findRepeats(ev);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "build_fail", count: 3, recipeIds: ["r1"] });
  });
  it("keeps the best duplicate and sums stats", () => {
    const a = r("a", 1), b = r("b", 5), c = r("c", 2, { status: "retired" });
    expect(findDuplicateRecipes([a, b, c])).toEqual([{ keepId: "b", dropIds: ["a"] }]);
    expect(mergedStats([a, b])).toEqual({ replays: 6, ok: 6, reverted: 0, failedVerify: 0 });
  });
  it("plans error_fix, quarantine and merge updates", () => {
    const ev = [1, 2, 3].map(() => ({ kind: "build_fail" as const, text: "boom", recipeId: "a" }));
    const u = planMemoryUpdates(ev, [r("a", 1), r("b", 5)]);
    expect(u.map((x) => x.action).sort()).toEqual(["add_error_fix", "merge_recipes", "quarantine_recipe"]);
  });
});
