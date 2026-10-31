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

  it("asks for unfilled slots instead of adapting", async () => {
    const r = recipe({ slots: [{ name: "x", kind: "identifier" }] });
    const e = await decideRecipeForTurn({ listRecipes: async () => [r], env: env(["package.json"]) }, args);
    expect(e.mode).toBe("exact");
    expect(e.needsConfirmation).toBe(true);
    expect(e.slots?.[0]).toMatchObject({ name: "x", filled: false });
  });

  it("exact when slot identifiers in the message match the captured intent (T5 / MC-32)", async () => {
    const intent = "create a React component Button";
    const r = recipe({
      title: intent,
      intentText: intent,
      intentFingerprint: intentFingerprint(intent),
      slots: [{ name: "componentName", kind: "identifier" }],
      preconditions: [],
    });
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [r], env: env([]) },
      { message: intent, projectId: "p1", autoReplay: "exact" },
    );
    expect(e.mode).toBe("exact");
  });

  it("exact when a path slot is filled from the new message (P1.5)", async () => {
    const captured = "create file src/a/util.ts";
    const r = recipe({
      title: captured,
      intentText: captured,
      intentFingerprint: intentFingerprint(captured),
      slots: [{ name: "targetPath", kind: "path" }],
      slotValues: { targetPath: "src/a/util.ts" },
      preconditions: [],
    });
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [r], env: env([]) },
      { message: "create file src/b/util.ts", projectId: "p1", autoReplay: "exact" },
    );
    expect(e.mode).toBe("exact");
    expect(e.needsConfirmation).toBe(true);
    expect(e.slots?.[0]).toMatchObject({ name: "targetPath", value: "src/b/util.ts", filled: true, source: "message" });
  });

  it("fills an identifier from the focused editor (P1.6)", async () => {
    const intent = "create a React component Button";
    const r = recipe({
      title: intent,
      intentText: intent,
      intentFingerprint: intentFingerprint(intent),
      slots: [{ name: "componentName", kind: "identifier", examples: ["Button"] }],
      slotValues: { componentName: "Button" },
      preconditions: [],
    });
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [r], env: env([]) },
      {
        message: "create a component",
        projectId: "p1",
        autoReplay: "exact",
        slotExtra: { paths: ["src/Header.tsx"], identifiers: ["Header"] },
      },
    );
    expect(e.mode).toBe("exact");
    expect(e.needsConfirmation).toBe(true);
    expect(e.slots?.[0]).toMatchObject({ name: "componentName", value: "Header", source: "extra" });
  });

  it("ignores recipes from other projects", async () => {
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [recipe({ projectId: "other" })], env: env(["package.json"]) },
      args,
    );
    expect(e.mode).toBe("generate");
  });

  it("never auto-applies when target files drifted since capture (MC-36)", async () => {
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [recipe()], env: env(["package.json"]), isDrifted: async () => true },
      args,
    );
    expect(e.mode).not.toBe("exact");
  });

  it("asks on a clean merge and stays exact", async () => {
    const e = await decideRecipeForTurn(
      {
        listRecipes: async () => [recipe()],
        env: env(["package.json"]),
        previewDrift: async () => ({ drifted: true, merged: true }),
      },
      args,
    );
    expect(e.mode).toBe("exact");
    expect(e.needsConfirmation).toBe(true);
    expect(e.why).toMatch(/clean merge/);
  });

  it("Ask permission confirms a byte-identical exact replay", async () => {
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [recipe()], env: env(["package.json"]) },
      { ...args, permissionMode: "default" },
    );
    expect(e.mode).toBe("exact");
    expect(e.needsConfirmation).toBe(true);
  });

  it("composes two disjoint recipes and always asks", async () => {
    const a = recipe({
      steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "h1" }],
      preconditions: [],
    });
    const b = recipe({
      id: "c".repeat(64),
      title: "Add Button test",
      intentText: INTENT,
      intentFingerprint: intentFingerprint(INTENT),
      steps: [{ kind: "write_file", path: "src/Button.test.tsx", blobHash: "h2" }],
      preconditions: [],
    });
    const e = await decideRecipeForTurn({ listRecipes: async () => [a, b], env: env([]) }, args);
    expect(e.compose?.recipes).toHaveLength(2);
    expect(e.needsConfirmation).toBe(true);
    expect(e.preview).toMatch(/Will run 2 recipes/);
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

  it("prefers searchRecipes over listing the inventory page", async () => {
    let listed = false;
    let searched = "";
    const e = await decideRecipeForTurn(
      {
        listRecipes: async () => {
          listed = true;
          return [recipe()];
        },
        searchRecipes: async (query) => {
          searched = query;
          return [recipe()];
        },
        env: env(["package.json"]),
      },
      args,
    );
    expect(listed).toBe(false);
    expect(searched).toBe(INTENT);
    expect(e.mode).toBe("exact");
  });

  it("passes fusion hits into the matcher", async () => {
    let queried = false;
    const r = recipe({ memoryId: 7, intentFingerprint: intentFingerprint("create a Card component") });
    await decideRecipeForTurn(
      {
        listRecipes: async () => [r],
        env: env([]),
        fusionHits: async () => {
          queried = true;
          return [{ memoryId: 7, score: 0.9 }];
        },
      },
      { message: "create a Card component", projectId: "p1", autoReplay: "off" },
    );
    expect(queried).toBe(true);
  });

  it("exact-replays after the revert window, and suggests while a revert is recent", async () => {
    const old = recipe({
      stats: { replays: 5, ok: 4, reverted: 1, failedVerify: 0 },
      lastReplayedAt: "2020-01-01T00:00:00.000Z",
    });
    expect((await decideRecipeForTurn({ listRecipes: async () => [old], env: env(["package.json"]) }, args)).mode).toBe("exact");
    const recent = recipe({
      stats: { replays: 5, ok: 4, reverted: 1, failedVerify: 0 },
      lastReplayedAt: new Date().toISOString(),
    });
    expect((await decideRecipeForTurn({ listRecipes: async () => [recent], env: env(["package.json"]) }, args)).mode).toBe("suggest");
  });

  it("returns top-k matches and asks when two are replayable", async () => {
    const a = recipe();
    const b = recipe({
      id: "c".repeat(64),
      title: INTENT,
      intentText: INTENT,
      intentFingerprint: intentFingerprint(INTENT),
    });
    const e = await decideRecipeForTurn(
      { listRecipes: async () => [a, b], env: env(["package.json"]) },
      args,
    );
    expect(e.matches?.length).toBe(2);
    expect(e.needsConfirmation).toBe(true);
    expect(e.why).toMatch(/2 recipes match/);
  });

  it("explains a global recipe whose framework is missing here", async () => {
    const r = recipe({
      scope: "global",
      preconditions: [{ kind: "framework", value: "react" }],
    });
    const e = await decideRecipeForTurn({ listRecipes: async () => [r], env: env(["package.json"]) }, args);
    expect(e.mode).toBe("suggest");
    expect(e.why).toMatch(/global recipe refused/);
    expect(e.why).toMatch(/react/);
  });

  it("only probes drift once preconditions pass", async () => {
    let probed = false;
    await decideRecipeForTurn(
      {
        listRecipes: async () => [recipe()],
        env: env([]),
        previewDrift: async () => ((probed = true), { drifted: false, merged: false }),
      },
      args,
    );
    expect(probed).toBe(false);
  });
});
