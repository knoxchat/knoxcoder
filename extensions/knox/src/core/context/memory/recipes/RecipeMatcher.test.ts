import { describe, expect, it } from "vitest";
import { intentFingerprint } from "./intentFingerprint.js";
import { MIN_MATCH_SCORE, REPLAY_THRESHOLD, bestMatch, matchRecipes, recipeAppliesInProject, trackRecordFactor } from "./RecipeMatcher.js";
import type { Recipe } from "./types.js";

let n = 0;
function recipe(intent: string, over: Partial<Recipe> = {}): Recipe {
  n++;
  return {
    id: String(n).padStart(64, "0"),
    projectId: "p1",
    scope: "project",
    status: "verified",
    title: intent,
    intentText: intent,
    intentFingerprint: intentFingerprint(intent),
    slots: [],
    preconditions: [],
    steps: [],
    sourceCheckpointIds: [],
    stats: { replays: 0, ok: 0, reverted: 0, failedVerify: 0 },
    captureCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const LIBRARY = [
  recipe("create a React component called Button", { memoryId: 1 }),
  recipe("add eslint config", { memoryId: 2 }),
  recipe("fix failing unit tests in src/api/user.ts", { memoryId: 3 }),
  recipe("install axios package", { memoryId: 4 }),
  recipe("delete the login page", { memoryId: 5 }),
];

describe("RecipeMatcher (MC-21)", () => {
  it("exact fingerprint (EN paraphrase and ZH) scores 1 and is replayable", () => {
    for (const msg of ["please add a Button react component", "请帮我创建一个 React 组件 Button"]) {
      const m = bestMatch({ message: msg, projectId: "p1", recipes: LIBRARY })!;
      expect(m.recipe.memoryId).toBe(1);
      expect(m.score).toBe(1);
      expect(m.reason).toBe("fingerprint_exact");
      expect(m.replayable).toBe(true);
    }
  });

  it("only verified recipes match", () => {
    for (const status of ["candidate", "quarantined", "retired"] as const) {
      const r = recipe("create Card component", { status });
      expect(matchRecipes({ message: "create Card component", projectId: "p1", recipes: [r] })).toEqual([]);
    }
  });

  it("does not cross projects", () => {
    const r = recipe("create Card component", { projectId: "other" });
    expect(matchRecipes({ message: "create Card component", recipes: [r], projectId: "p1" })).toEqual([]);
    expect(recipeAppliesInProject(r, "p1")).toBe(false);
    expect(recipeAppliesInProject(r, "other")).toBe(true);
    expect(recipeAppliesInProject({ ...r, scope: "global" }, "p1")).toBe(true);
    expect(recipeAppliesInProject(r, undefined)).toBe(false);
    expect(matchRecipes({ message: "create Card component", recipes: [recipe("create Card component")] })).toEqual([]);
  });

  it("a different slot value is similar but not replayable", () => {
    const m = bestMatch({ message: "create a React component called Card", projectId: "p1", recipes: LIBRARY })!;
    expect(m.recipe.memoryId).toBe(1);
    expect(m.reason).toBe("fingerprint_similar");
    expect(m.replayable).toBe(false);
  });

  it("a slotted family treats a different name as the same kind of work (P1.9)", () => {
    const slotted = recipe("create a React component called Button", {
      memoryId: 1,
      slots: [{ name: "componentName", kind: "identifier", examples: ["Button", "Card"] }],
      slotValues: { componentName: "Button" },
      familyId: "fam1",
    });
    const m = bestMatch({
      message: "create a React component called Card",
      projectId: "p1",
      recipes: [slotted],
    })!;
    expect(m.replayable).toBe(true);
    expect(m.reason).toBe("fingerprint_exact");
    expect(m.score).toBe(1);
  });

  it("collapses family variants to the best track record", () => {
    const weak = recipe("create a React component called Button", {
      familyId: "fam",
      slots: [{ name: "componentName", kind: "identifier", examples: ["Button"] }],
      slotValues: { componentName: "Button" },
      stats: { replays: 1, ok: 1, reverted: 0, failedVerify: 0 },
    });
    const strong = recipe("create a React component called Card", {
      familyId: "fam",
      slots: [{ name: "componentName", kind: "identifier", examples: ["Button", "Card"] }],
      slotValues: { componentName: "Card" },
      stats: { replays: 4, ok: 4, reverted: 0, failedVerify: 0 },
    });
    const hits = matchRecipes({
      message: "create a React component called Header",
      projectId: "p1",
      recipes: [weak, strong],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].recipe.id).toBe(strong.id);
  });

  it("fusion evidence lifts a similar match but cannot reach replay alone", () => {
    const without = bestMatch({ message: "create a React component called Card", projectId: "p1", recipes: LIBRARY })!;
    const withFusion = bestMatch({
      message: "create a React component called Card",
      recipes: LIBRARY,
      projectId: "p1",
      fusionHits: [{ memoryId: 1, score: 1 }],
    })!;
    expect(withFusion.score).toBeGreaterThan(without.score);
    expect(withFusion.reason).toBe("fingerprint_similar_fusion");
    expect(withFusion.replayable).toBe(false);
    // Fusion on an unrelated recipe does not create a match.
    expect(
      matchRecipes({ message: "rewrite the database layer", projectId: "p1", recipes: LIBRARY, fusionHits: [{ memoryId: 2, score: 1 }] }),
    ).toEqual([]);
  });

  it("reverts and failed verifies lower the score and are explained", () => {
    const clean = recipe("create Card component");
    const bad = recipe("create Card component", { stats: { replays: 4, ok: 1, reverted: 2, failedVerify: 1 } });
    expect(trackRecordFactor(bad.stats)).toBeLessThan(trackRecordFactor(clean.stats));
    const [first, second] = matchRecipes({ message: "create Card component", projectId: "p1", recipes: [bad, clean] });
    expect(first.recipe.id).toBe(clean.id);
    expect(second.score).toBeLessThan(first.score);
    expect(second.why).toMatch(/2 reverts, 1 failed/);
  });

  it("returns nothing for empty or unrelated messages", () => {
    expect(matchRecipes({ message: "", projectId: "p1", recipes: LIBRARY })).toEqual([]);
    expect(matchRecipes({ message: "explain how closures work", projectId: "p1", recipes: LIBRARY })).toEqual([]);
  });

  it("ranks deterministically and honors limit", () => {
    const a = recipe("create Card component");
    const b = recipe("create Card component");
    const r1 = matchRecipes({ message: "create Card component", projectId: "p1", recipes: [a, b], limit: 1 });
    const r2 = matchRecipes({ message: "create Card component", projectId: "p1", recipes: [b, a], limit: 1 });
    expect(r1).toHaveLength(1);
    expect(r1[0].recipe.id).toBe(r2[0].recipe.id);
  });

  it("precision >= 0.9 at the replay threshold on the matching fixtures", () => {
    // [message, expected memoryId or null when nothing should be replayed]
    const cases: [string, number | null][] = [
      ["create a React component called Button", 1],
      ["Please make a Button React component", 1],
      ["新建 Button 组件 react", 1],
      ["add the eslint config", 2],
      ["请添加 eslint config", 2],
      ["fix failing unit tests in src/other/thing.ts", 3],
      ["修复 src/api/user.ts 的 测试", 3],
      ["install the axios package", 4],
      ["安装 axios 依赖", 4],
      ["delete login page", 5],
      ["请移除 login 页面", 5],
      // near misses: must NOT replay
      ["create a React component called Card", null],
      ["delete the Button component", null],
      ["install lodash package", null],
      ["add prettier config", null],
      ["create the login page", null],
      ["fix failing integration tests", null],
      ["explain the login page", null],
      ["rename Button component", null],
    ];
    let replayed = 0;
    let correct = 0;
    for (const [message, expected] of cases) {
      const m = bestMatch({ message, projectId: "p1", recipes: LIBRARY });
      if (m?.replayable) {
        replayed++;
        if (m.recipe.memoryId === expected) correct++;
      }
    }
    const positives = cases.filter(([, e]) => e !== null).length;
    expect(replayed).toBeGreaterThan(0);
    expect(correct / replayed).toBeGreaterThanOrEqual(0.9);
    expect(correct / positives).toBeGreaterThanOrEqual(0.9); // and recall stays useful
  });

  it("thresholds are sane", () => {
    expect(MIN_MATCH_SCORE).toBeLessThan(REPLAY_THRESHOLD);
  });

  it("open / mentioned files lift a similar match but cannot admit a zero-token miss", () => {
    const r = recipe("create a React component called Button", {
      steps: [{ kind: "write_file", path: "src/Button.tsx" }],
    });
    const without = bestMatch({ message: "create a React component called Card", projectId: "p1", recipes: [r] })!;
    const withFiles = bestMatch({
      message: "create a React component called Card in src/Button.tsx",
      projectId: "p1",
      recipes: [r],
      openPaths: ["src/Button.tsx"],
    })!;
    expect(withFiles.fileOverlap).toBeGreaterThan(0);
    expect(withFiles.score).toBeGreaterThan(without.score);
    expect(withFiles.replayable).toBe(false);
    expect(
      matchRecipes({
        message: "rewrite the database layer",
        projectId: "p1",
        recipes: [r],
        openPaths: ["src/Button.tsx"],
      }),
    ).toEqual([]);
  });

  it("a pinned recipe outranks an otherwise equal hit", () => {
    const plain = recipe("create a React component called Button");
    const pinned = recipe("create a React component called Button", { pinned: true });
    const hits = matchRecipes({
      message: "create a React component called Card",
      projectId: "p1",
      recipes: [plain, pinned],
    });
    expect(hits[0].recipe.id).toBe(pinned.id);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("pin cannot admit a zero-token miss", () => {
    const pinned = recipe("create Card component", { pinned: true });
    expect(matchRecipes({ message: "rewrite the database layer", projectId: "p1", recipes: [pinned] })).toEqual([]);
  });

  it("returns top-k families, not only the best", () => {
    const a = recipe("create Card component");
    const b = recipe("create Card component");
    const hits = matchRecipes({ message: "create Card component", projectId: "p1", recipes: [a, b] });
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.replayable)).toBe(true);
  });
});
