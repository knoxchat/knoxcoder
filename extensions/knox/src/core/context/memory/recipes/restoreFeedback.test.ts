import { describe, expect, it } from "vitest";

import { recipesRevertedByRestore } from "./feedback";
import type { Recipe } from "./types";

const r = (id: string, paths: string[], lastReplayedAt?: string): Recipe =>
  ({ id, steps: paths.map((path) => ({ kind: "write_file", path })), lastReplayedAt }) as Recipe;
const now = new Date("2026-01-01T12:00:00Z");

describe("recipesRevertedByRestore (MC-34)", () => {
  it("matches recipes replayed in the window that wrote a restored file", () => {
    const recipes = [
      r("hit", ["src/a.ts"], "2026-01-01T11:55:00Z"),
      r("old", ["src/a.ts"], "2026-01-01T10:00:00Z"),
      r("other-file", ["src/b.ts"], "2026-01-01T11:55:00Z"),
      r("never", ["src/a.ts"]),
    ];
    expect(recipesRevertedByRestore(recipes, ["src/a.ts"], now).map((x) => x.id)).toEqual(["hit"]);
  });
  it("normalizes separators and ignores empty restores", () => {
    const recipes = [r("hit", ["src/a.ts"], "2026-01-01T11:59:00Z")];
    expect(recipesRevertedByRestore(recipes, ["src\\a.ts"], now)).toHaveLength(1);
    expect(recipesRevertedByRestore(recipes, [], now)).toEqual([]);
  });
});
