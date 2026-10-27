import { describe, expect, it } from "vitest";

import { errorSignature, findDuplicateRecipes, findRepeats, mergedStats, planFamilyDrafts, planMemoryUpdates, type ReviewEvent } from "./selfReview";
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
    const a = r("a", 1, { steps: [{ kind: "write_file", path: "a.ts", blobHash: "same" }] });
    const b = r("b", 5, { steps: [{ kind: "write_file", path: "a.ts", blobHash: "same" }] });
    const c = r("c", 2, { status: "retired", steps: [{ kind: "write_file", path: "a.ts", blobHash: "same" }] });
    expect(findDuplicateRecipes([a, b, c])).toEqual([{ keepId: "b", dropIds: ["a"] }]);
    expect(mergedStats([a, b])).toEqual({ replays: 6, ok: 6, reverted: 0, failedVerify: 0 });
  });
  it("does not absorb variants that share a path shape but differ in bytes (P1.8)", () => {
    const a = r("a", 1);
    const b = r("b", 5);
    expect(findDuplicateRecipes([a, b])).toEqual([]);
  });
  it("plans error_fix, quarantine and merge updates", () => {
    const ev = [1, 2, 3].map(() => ({ kind: "build_fail" as const, text: "boom", recipeId: "a" }));
    const same = { steps: [{ kind: "write_file" as const, path: "a.ts", blobHash: "same" }] };
    const u = planMemoryUpdates(ev, [r("a", 1, same), r("b", 5, same)]);
    expect(u.map((x) => x.action).sort()).toEqual(["add_error_fix", "merge_recipes", "quarantine_recipe"]);
  });
  it("user_correction repeats add error_fix and quarantine the named recipe (P7.1)", () => {
    const ev = [1, 2, 3].map(() => ({ kind: "user_correction" as const, text: "not this: skipped recipe Button", recipeId: "a" }));
    const u = planMemoryUpdates(ev, [r("a", 1)]);
    expect(u.map((x) => x.action).sort()).toEqual(["add_error_fix", "quarantine_recipe"]);
  });
  it("drafts slot extraction for unmerged variants and not for identical snapshots (P7.3)", () => {
    const button = r("a", 1, { title: "Create Button", steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "aaa" }] });
    const card = r("b", 1, { title: "Create Card", steps: [{ kind: "write_file", path: "src/Card.tsx", blobHash: "bbb" }] });
    const twins = r("c", 1, { steps: [{ kind: "write_file", path: "a.ts", blobHash: "same" }] });
    const twin2 = r("d", 1, { steps: [{ kind: "write_file", path: "a.ts", blobHash: "same" }] });
    expect(planFamilyDrafts([button, card])).toEqual([
      expect.objectContaining({ kind: "extract_slots", recipeIds: ["a", "b"] }),
    ]);
    expect(planFamilyDrafts([twins, twin2])).toEqual([]);
    expect(planFamilyDrafts([r("e", 1, { slots: [{ name: "n", kind: "identifier" }], familyId: "fam" }), card])).toEqual([]);
  });
});
