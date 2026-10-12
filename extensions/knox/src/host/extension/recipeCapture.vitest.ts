import { describe, expect, it } from "vitest";

import { captureRecipeAfterTurn, diffCheckpointStates, markRecipeTurnStart, recipesEnabled } from "./recipeCapture";

const st = (hash: string | undefined, content = "x", encoding = "utf8") => ({ hash, content, encoding });
const never = () => false;

describe("diffCheckpointStates", () => {
  it("reports added, modified, and deleted files; skips unchanged", () => {
    const before = new Map([
      ["same.ts", st("h1")],
      ["mod.ts", st("h2")],
      ["gone.ts", st("h3")],
    ]);
    const after = new Map([
      ["same.ts", st("h1")],
      ["mod.ts", st("h2b")],
      ["new.ts", st("h4")],
    ]);
    expect(diffCheckpointStates(before, after, never)).toEqual([
      { path: "gone.ts", deleted: true, baseHash: "h3" },
      { path: "mod.ts", hash: "h2b", baseHash: "h2", hasSecret: false },
      { path: "new.ts", hash: "h4", baseHash: undefined, hasSecret: false },
    ]);
  });

  it("flags secret content but never scans base64 blobs", () => {
    const after = new Map([
      ["a.ts", st("h1", "TOKEN=abc")],
      ["img.png", st("h2", "TOKEN=abc", "base64")],
    ]);
    const out = diffCheckpointStates(new Map(), after, (t) => t.includes("TOKEN"))!;
    expect(out.map((c) => [c.path, c.hasSecret])).toEqual([
      ["a.ts", true],
      ["img.png", false],
    ]);
  });

  it("gives up when a changed file has no blob hash", () => {
    expect(diffCheckpointStates(new Map(), new Map([["a.ts", st(undefined)]]), never)).toBeUndefined();
  });
});

describe("flag off (default)", () => {
  it("does nothing", async () => {
    expect(recipesEnabled()).toBe(false);
    await expect(markRecipeTurnStart("s1")).resolves.toBeUndefined();
    await expect(captureRecipeAfterTurn({ sessionId: "s1", userMessage: "x" }, "/w")).resolves.toBeUndefined();
  });
});
