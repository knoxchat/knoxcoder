import { describe, expect, it } from "vitest";

import { buildRecipeHint } from "./recipeHint";
import type { Recipe } from "./types";

const recipe = {
  id: "abcdef123456",
  title: "Add Button",
  intentText: "",
  slots: [{ name: "componentName", kind: "identifier" }],
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
  });
  it("respects the size cap", async () => {
    const hint = await buildRecipeHint(recipe, async () => "x".repeat(5000), 2500);
    expect(hint.length).toBeLessThan(3200);
    expect(hint).toContain("more steps omitted");
  });
});
