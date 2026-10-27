import { describe, expect, it } from "vitest";

import { formatComposePreview, pathsDisjoint, planCompose, recipeWritePaths } from "./compose";
import type { RecipeMatch } from "./RecipeMatcher";
import type { Recipe } from "./types";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "a".repeat(64),
    projectId: "p",
    scope: "project",
    status: "verified",
    title: "Create Button",
    intentText: "create a Button component",
    intentFingerprint: "create button component",
    slots: [],
    preconditions: [],
    steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "h1" }],
    sourceCheckpointIds: [],
    stats: { replays: 3, ok: 3, reverted: 0, failedVerify: 0 },
    captureCount: 2,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function match(r: Recipe, over: Partial<RecipeMatch> = {}): RecipeMatch {
  return {
    recipe: r,
    score: 0.95,
    reason: "fingerprint_similar",
    why: "similar",
    fingerprintSimilarity: 0.9,
    fusionScore: 0,
    fileOverlap: 0,
    replayable: true,
    ...over,
  };
}

describe("planCompose", () => {
  it("plans two disjoint verified recipes in matcher order", () => {
    const component = recipe();
    const test = recipe({
      id: "b".repeat(64),
      title: "Add Button test",
      steps: [{ kind: "write_file", path: "src/Button.test.tsx", blobHash: "h2" }],
    });
    const plan = planCompose([match(component), match(test)]);
    expect(plan?.recipes.map((r) => r.id)).toEqual([component.id, test.id]);
    expect(plan?.why).toMatch(/2 disjoint/);
    expect(formatComposePreview(plan!)).toMatch(/1\. Create Button/);
    expect(formatComposePreview(plan!)).toMatch(/2\. Add Button test/);
  });

  it("refuses overlapping paths, slotted recipes, and a single match", () => {
    const a = recipe();
    const overlap = recipe({
      id: "b".repeat(64),
      title: "Edit Button",
      steps: [
        { kind: "write_file", path: "src/Button.tsx", blobHash: "h2" },
        { kind: "write_file", path: "src/Button.css", blobHash: "h3" },
      ],
    });
    expect(planCompose([match(a), match(overlap)])).toBeUndefined();
    expect(planCompose([match(a)])).toBeUndefined();
    expect(
      planCompose([
        match(a),
        match(
          recipe({
            id: "c".repeat(64),
            title: "Create Card",
            slots: [{ name: "componentName", kind: "identifier" }],
            steps: [{ kind: "write_file", path: "src/Card.tsx", blobHash: "h4" }],
          }),
        ),
      ]),
    ).toBeUndefined();
  });

  it("skips command-only children and candidates", () => {
    const files = recipe();
    const command = recipe({
      id: "b".repeat(64),
      title: "run tests",
      steps: [{ kind: "command", command: "npm test" }],
    });
    const candidate = recipe({
      id: "c".repeat(64),
      status: "candidate",
      steps: [{ kind: "write_file", path: "src/Card.tsx", blobHash: "h" }],
    });
    expect(planCompose([match(files), match(command), match(candidate)])).toBeUndefined();
    expect(pathsDisjoint(recipeWritePaths(files), recipeWritePaths(command))).toBe(false);
  });
});
