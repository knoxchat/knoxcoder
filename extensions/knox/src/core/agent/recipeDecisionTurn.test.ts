import { describe, expect, it } from "vitest";
import { intentFingerprint } from "../context/memory/recipes/intentFingerprint.js";
import type { PreconditionEnv } from "../context/memory/recipes/preconditions.js";
import type { Recipe } from "../context/memory/recipes/types.js";
import { decideRecipeForTurn } from "./recipeDecisionTurn.js";

const INTENT = "add a lint script to package.json";

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: "b".repeat(64),
    projectId: "p1",
    scope: "project",
    status: "verified",
    title: INTENT,
    intentText: INTENT,
    intentFingerprint: intentFingerprint(INTENT),
    slots: [],
    preconditions: [{ kind: "file_exists", value: "package.json" }],
    steps: [],
    sourceCheckpointIds: [],
    stats: { replays: 3, ok: 3, reverted: 0, failedVerify: 0 },
    captureCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function env(files: string[]): PreconditionEnv {
  return {
    rootEntries: async () => files,
    readText: async () => undefined,
    exists: async (p) => files.includes(p),
    dirtyPaths: async () => [],
  };
}

const args = { message: INTENT, projectId: "p1", autoReplay: "exact" as const };

describe("decideRecipeForTurn", () => {
  it("generate with no recipes", async () => {
    const e = await decideRecipeForTurn({ listRecipes: async () => [], env: env([]) }, args);
    expect(e).toMatchObject({ type: "recipe_decision", mode: "generate", recipe: undefined });
  });

  it("exact when the recipe matches and preconditions pass", async () => {
    const e = await decideRecipeForTurn({ listRecipes: async () => [recipe()], env: env(["package.json"]) }, args);
    expect(e.mode).toBe("exact");
    expect(e.recipe).toMatchObject({ id: "b".repeat(64), uses: 3, reverts: 0 });
  });

  it("suggest, with the reason, when a precondition fails", async () => {
    const e = await decideRecipeForTurn({ listRecipes: async () => [recipe()], env: env([]) }, args);
    expect(e.mode).toBe("suggest");
    expect(e.why).toContain("package.json");
  });

  it("suggest when autoReplay is off, without touching the workspace", async () => {
    const probe = env(["package.json"]);
    probe.exists = async () => {
      throw new Error("should not be called");
    };
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [recipe()], env: probe },
      { ...args, autoReplay: "off" },
    );
    expect(e.mode).toBe("suggest");
  });

  it("adapt when the recipe has slots", async () => {
    const r = recipe({ slots: [{ name: "x", kind: "identifier" }] });
    const e = await decideRecipeForTurn({ listRecipes: async () => [r], env: env(["package.json"]) }, args);
    expect(e.mode).toBe("adapt");
  });

  it("ignores recipes from other projects", async () => {
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [recipe({ projectId: "other" })], env: env(["package.json"]) },
      args,
    );
    expect(e.mode).toBe("generate");
  });

  it("never exact when target files drifted since capture (MC-36)", async () => {
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [recipe()], env: env(["package.json"]), isDrifted: async () => true },
      args,
    );
    expect(e.mode).not.toBe("exact");
  });

  it("treats a failing drift probe as drifted", async () => {
    const e = await decideRecipeForTurn(
      {
        listRecipes: async () => [recipe()],
        env: env(["package.json"]),
        isDrifted: async () => {
          throw new Error("disk");
        },
      },
      args,
    );
    expect(e.mode).not.toBe("exact");
  });

  it("only probes drift once preconditions pass", async () => {
    let probed = false;
    await decideRecipeForTurn(
      {
        listRecipes: async () => [recipe()],
        env: env([]),
        isDrifted: async () => ((probed = true), false),
      },
      args,
    );
    expect(probed).toBe(false);
  });
});
