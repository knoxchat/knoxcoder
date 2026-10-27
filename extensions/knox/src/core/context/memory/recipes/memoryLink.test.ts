import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildRecipeMemory, parseRecipeId, recipeGraphEntities, recipeMemoryIsVerified } from "./memoryLink";
import type { Recipe } from "./types";

const testDir = path.join(os.tmpdir(), `recipe-memory-link-${Date.now()}`);
const HASH = "a".repeat(64);
const ID = "f".repeat(64);

let BrainManager: typeof import("../brain/BrainManager.js").BrainManager;
let BrainStore: typeof import("../brain/BrainStore.js").BrainStore;

beforeAll(async () => {
  fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = testDir;
  ({ BrainManager } = await import("../brain/BrainManager.js"));
  ({ BrainStore } = await import("../brain/BrainStore.js"));
  await BrainStore.get();
  await BrainStore.saveConfig("auto_extract_enabled", "false");
  await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  await BrainStore.saveConfig("memory_scope", "global");
});

afterAll(() => {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: ID,
    projectId: "p1",
    scope: "project",
    status: "verified",
    title: "Create a Button component",
    intentText: "Create a Button component",
    intentFingerprint: "create a button component",
    slots: [{ name: "componentName", kind: "identifier" }],
    preconditions: [],
    steps: [
      { kind: "write_file", path: "src/Button.tsx", blobHash: HASH, checkpointId: "cp1" },
      { kind: "command", command: "npm test" },
    ],
    sourceCheckpointIds: ["cp1"],
    oracle: { kind: "build", passedAt: "2026-01-01T00:00:00.000Z", command: "npm run build" },
    stats: { replays: 0, ok: 0, reverted: 0, failedVerify: 0 },
    captureCount: 2,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...over,
  };
}

describe("buildRecipeMemory", () => {
  it("describes the recipe as a workflow memory carrying the recipe id, never bytes", () => {
    const m = buildRecipeMemory(recipe());
    expect(m.category).toBe("workflow");
    expect(parseRecipeId(m.content)).toBe(ID);
    expect(m.content).toContain("+ src/Button.tsx");
    expect(m.content).toContain("$ npm test");
    expect(m.content).toContain("Varies by: componentName");
    expect(m.content).not.toContain(HASH);
  });

  it("redacts secrets", () => {
    const m = buildRecipeMemory(recipe({ intentText: "use key sk-abcdefghijklmnopqrstuvwxyz123456 for Button" }));
    expect(m.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });

  it("parseRecipeId ignores content without a well-formed marker", () => {
    expect(parseRecipeId("recipe_id: nope")).toBeUndefined();
    expect(parseRecipeId(undefined)).toBeUndefined();
    expect(parseRecipeId(`text recipe_id: ${ID}`)).toBeUndefined();
  });

  it("treats a linked recipe memory as verified unless it was reverted", () => {
    const content = buildRecipeMemory(recipe()).content;
    expect(recipeMemoryIsVerified(content)).toBe(true);
    expect(recipeMemoryIsVerified(content, { verified: 2, reverted: 0 })).toBe(true);
    expect(recipeMemoryIsVerified(content, { verified: 1, reverted: 1 })).toBe(false);
    expect(recipeMemoryIsVerified("just a fact", { verified: 2, reverted: 0 })).toBe(true);
    expect(recipeMemoryIsVerified("just a fact")).toBeUndefined();
  });

  it("extracts file, symbol and package entities without common nouns", () => {
    const entities = recipeGraphEntities(
      recipe({
        preconditions: [{ kind: "framework", value: "react" }],
        steps: [
          { kind: "write_file", path: "src/Button.tsx", blobHash: HASH },
          { kind: "write_file", path: "src/index.ts", blobHash: HASH },
        ],
      }),
    );
    expect(entities.some((e) => e.entity_type === "file" && e.name === "src/Button.tsx")).toBe(true);
    expect(entities.some((e) => e.entity_type === "class" && e.name === "Button")).toBe(true);
    expect(entities.some((e) => e.entity_type === "technology" && e.name === "react")).toBe(true);
    expect(entities.some((e) => e.name.toLowerCase() === "index")).toBe(false);
  });
});

describe("recall surfaces the recipe id", () => {
  it("returns the memory and its recipe id for a known intent", async () => {
    const memoryId = await BrainManager.store(buildRecipeMemory(recipe()));
    await BrainManager.store({
      category: "fact",
      title: "Unrelated",
      content: "The deploy pipeline uses GitHub Actions.",
      importance: 0.5,
    });

    const res = await BrainManager.recall({ query: "Create a Button component", include_episodic: false });
    const hit = res.semantic.find((s) => s.id === memoryId);
    expect(hit).toBeDefined();
    expect(hit!.recipe_id).toBe(ID);
    expect(res.semantic.filter((s) => s.recipe_id).length).toBe(1);
  });
});
