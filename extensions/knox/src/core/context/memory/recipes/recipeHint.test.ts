import { describe, expect, it } from "vitest";

import {
  buildRecipeHint,
  buildRecipeStub,
  parseRecipeHintCites,
  recipeHintCite,
  recipeHintInjectItem,
} from "./recipeHint";
import type { Recipe } from "./types";

const recipe = {
  id: "abcdef123456",
  title: "Add Button",
  intentText: "",
  slots: [{ name: "componentName", kind: "identifier" }],
  preconditions: [],
  oracle: { kind: "build", passedAt: "" },
  stats: { replays: 2, ok: 2, reverted: 0, failedVerify: 0 },
  steps: [
    { kind: "write_file", path: "src/Button.tsx", blobHash: "h1" },
    { kind: "write_file", path: "bin.png", blobHash: "h2" },
    { kind: "write_file", path: "gone.ts", blobHash: "h3" },
    { kind: "command", command: "npm run build" },
  ],
} as unknown as Recipe;

describe("buildRecipeHint", () => {
  it("includes text blobs, skips binary and missing, redacts secrets", async () => {
    const blobs: Record<string, string | Uint8Array> = {
      h1: "export const Button = () => 'x'; // token=sk_live_abcdefghijklmnop1234",
      h2: new Uint8Array([137, 80, 0, 71]),
    };
    const hint = await buildRecipeHint(recipe, async (h) => blobs[h]);
    expect(hint).toContain("File: src/Button.tsx");
    expect(hint).toContain("export const Button");
    expect(hint).not.toContain("abcdefghijklmnop1234");
    expect(hint).toContain("bin.png (content unavailable)");
    expect(hint).toContain("gone.ts (content unavailable)");
    expect(hint).toContain("Command: npm run build");
    expect(hint).toContain("componentName");
    expect(hint).toContain(`[mem:recipe:${recipe.id}]`);
    expect(recipeHintCite(recipe)).toBe(`[mem:recipe:${recipe.id}]`);
    expect(parseRecipeHintCites(hint)).toEqual([recipe.id]);
    expect(recipeHintInjectItem(recipe)).toMatchObject({
      kind: "recipe",
      mem_id: recipe.id,
      cite: `[mem:recipe:${recipe.id}]`,
      reason: "recipe-hint",
    });
  });
  it("builds a stub with title, paths, slots, id and why but no file bodies", () => {
    const stub = buildRecipeStub(recipe, { why: "similar intent" });
    expect(stub).toContain(`[mem:recipe:${recipe.id}]`);
    expect(stub).toContain("<verified_recipe_stub");
    expect(stub).toContain("src/Button.tsx");
    expect(stub).toContain("componentName");
    expect(stub).toContain("similar intent");
    expect(stub).toContain(`id=${JSON.stringify(recipe.id)}`);
    expect(stub).toContain(`recipe_id: ${recipe.id}`);
    expect(stub).not.toContain("export const");
  });

  it("includes why, preconditions, and prefers a diff against current files", async () => {
    const slotted = {
      ...recipe,
      preconditions: [{ kind: "file_exists", value: "package.json" }],
    } as unknown as Recipe;
    const hint = await buildRecipeHint(
      slotted,
      async () => "export const Button = () => 'x';\n",
      6000,
      {
        why: "matched Jaccard 0.9",
        readCurrent: async () => "export const Old = () => 'x';\n",
      },
    );
    expect(hint).toContain("matched Jaccard 0.9");
    expect(hint).toContain("file_exists=package.json");
    expect(hint).toContain("@@");
    expect(hint).toContain("-export const Old");
    expect(hint).not.toContain("```\nexport const Button");
  });

  it("respects the size cap", async () => {
    const hint = await buildRecipeHint(recipe, async () => "x".repeat(5000), 2500);
    expect(hint.length).toBeLessThan(3200);
    expect(hint).toContain("more steps omitted");
  });
});
