import fs from "fs";
import os from "os";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBrainPragmas } from "../brain/store/dbSafety";
import { createTables } from "../brain/store/schema";
import {
  computeFamilyId,
  computeFamilyIdFromRecipe,
  isFamilyCandidate,
  linkRecipeFamily,
  pickBestVariant,
  stepsShapeCompatible,
  templatizePath,
} from "./family";
import { RecipeStore } from "./RecipeStore";
import type { Recipe } from "./types";

function r(over: Partial<Recipe> = {}): Recipe {
  return {
    id: over.id ?? "a".repeat(64),
    projectId: "p",
    scope: "project",
    status: "verified",
    title: "t",
    intentText: "Create a React component Button",
    intentFingerprint: "create react component button",
    slots: [],
    preconditions: [],
    steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "aaa" }],
    sourceCheckpointIds: [],
    stats: { replays: 0, ok: 0, reverted: 0, failedVerify: 0 },
    captureCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("family identity (P1.1 / P1.9)", () => {
  it("templates slot values out of paths", () => {
    expect(templatizePath("src/components/Button.tsx", { componentName: "Button" })).toBe(
      "src/components/{componentName}.tsx",
    );
  });

  it("family id ignores blob hashes and is stable under slot-value changes", () => {
    const a = computeFamilyId({
      projectId: "p",
      familyFingerprint: "create component $name",
      slots: [{ name: "componentName", kind: "identifier" }],
      steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "aaa" }],
      slotValues: { componentName: "Button" },
    });
    const b = computeFamilyId({
      projectId: "p",
      familyFingerprint: "create component $name",
      slots: [{ name: "componentName", kind: "identifier" }],
      steps: [{ kind: "write_file", path: "src/Card.tsx", blobHash: "bbb" }],
      slotValues: { componentName: "Card" },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("picks the variant with the best track record, then recency, then open-file proximity", () => {
    const weak = r({ id: "1".repeat(64), stats: { replays: 1, ok: 1, reverted: 0, failedVerify: 0 } });
    const strong = r({
      id: "2".repeat(64),
      stats: { replays: 4, ok: 4, reverted: 0, failedVerify: 0 },
      lastReplayedAt: "2026-02-01T00:00:00Z",
    });
    expect(pickBestVariant([weak, strong]).id).toBe(strong.id);
    const near = r({
      id: "3".repeat(64),
      stats: strong.stats,
      lastReplayedAt: strong.lastReplayedAt,
      steps: [{ kind: "write_file", path: "src/Header.tsx", blobHash: "c" }],
    });
    expect(pickBestVariant([strong, near], ["src/Header.tsx"]).id).toBe(near.id);
  });

  it("treats Button vs Card as family candidates and not a lint-script recipe", () => {
    const button = r();
    const card = r({
      id: "c".repeat(64),
      intentText: "Create a React component Card",
      intentFingerprint: "card component create react",
      steps: [{ kind: "write_file", path: "src/Card.tsx", blobHash: "bbb" }],
    });
    const lint = r({
      id: "d".repeat(64),
      intentText: "add a lint script",
      intentFingerprint: "add lint script",
      steps: [{ kind: "write_file", path: "package.json", blobHash: "ccc" }],
    });
    expect(stepsShapeCompatible(button.steps, card.steps)).toBe(true);
    expect(isFamilyCandidate(button, card)).toBe(true);
    expect(isFamilyCandidate(button, lint)).toBe(false);
  });
});

describe("linkRecipeFamily (P1.2 / P1.3)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof open>>;
  let store: RecipeStore;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-recipe-family-"));
    db = await open({ filename: path.join(dir, "brain.sqlite"), driver: sqlite3.Database });
    await applyBrainPragmas(db);
    await createTables(db);
    store = new RecipeStore(db as any);
  });
  afterEach(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const oracle = { kind: "build" as const, passedAt: "2026-01-01T00:00:00.000Z" };

  it("extracts slots and example values when a second success lands", async () => {
    const button = await store.create({
      projectId: "p1",
      title: "Create Button",
      intentText: "Create a React component Button",
      intentFingerprint: "button component create react",
      steps: [{ kind: "write_file", path: "src/Button.tsx", blobHash: "aaa", checkpointId: "cp1" }],
      oracle,
    });
    const card = await store.create({
      projectId: "p1",
      title: "Create Card",
      intentText: "Create a React component Card",
      intentFingerprint: "card component create react",
      steps: [{ kind: "write_file", path: "src/Card.tsx", blobHash: "bbb", checkpointId: "cp2" }],
      oracle,
    });
    const linked = await linkRecipeFamily(store, card.recipe);
    expect(linked.slots).toEqual([
      { name: "componentName", kind: "identifier", examples: ["Button", "Card"] },
    ]);
    expect(linked.slotValues).toEqual({ componentName: "Card" });
    expect(linked.familyId).toBeTruthy();
    const peer = await store.get(button.recipe.id);
    expect(peer?.familyId).toBe(linked.familyId);
    expect(peer?.slotValues).toEqual({ componentName: "Button" });
    expect(computeFamilyIdFromRecipe(linked)).toBe(linked.familyId);
  });
});
