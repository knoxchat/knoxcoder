import { describe, expect, it } from "vitest";

import {
  mergeUserPreconditions,
  RECIPE_PIN_BOOST,
  sanitizeRecipeNotes,
  sanitizeRecipeTitle,
  sanitizeUserPreconditions,
  sanitizeUserSlots,
} from "./inspector";

describe("recipe inspector sanitizers (P5)", () => {
  it("redacts and caps title/notes", () => {
    expect(sanitizeRecipeTitle("  Add Button  ")).toBe("Add Button");
    expect(() => sanitizeRecipeTitle("   ")).toThrow(/empty/);
    expect(sanitizeRecipeNotes("keep this")).toBe("keep this");
    expect(sanitizeRecipeNotes("key=sk-abcdefghijklmnopqrstuvwxyz0123456789")).not.toContain(
      "sk-abcdefghijklmnopqrstuvwxyz0123456789",
    );
  });

  it("accepts safe slots and refuses hostile names/values", () => {
    expect(sanitizeUserSlots([{ name: "componentName", kind: "identifier", examples: ["Button", "../etc"] }])).toEqual([
      { name: "componentName", kind: "identifier", examples: ["Button"] },
    ]);
    expect(() => sanitizeUserSlots([{ name: "bad name", kind: "identifier" }])).toThrow(/Invalid slot name/);
    expect(() => sanitizeUserSlots([{ name: "x", kind: "shell" as "text" }])).toThrow(/Invalid slot kind/);
    expect(() =>
      sanitizeUserSlots([
        { name: "a", kind: "identifier" },
        { name: "a", kind: "path" },
      ]),
    ).toThrow(/Duplicate/);
  });

  it("keeps derived preconditions when merging user checks", () => {
    const merged = mergeUserPreconditions(
      [
        { kind: "language", value: "typescript" },
        { kind: "file_exists", value: "old.ts" },
      ],
      [{ kind: "file_exists", value: "src/Button.tsx" }, { kind: "dependency", value: "react" }],
    );
    expect(merged).toEqual([
      { kind: "language", value: "typescript" },
      { kind: "file_exists", value: "src/Button.tsx" },
      { kind: "dependency", value: "react" },
    ]);
    expect(() => sanitizeUserPreconditions([{ kind: "language", value: "typescript" }])).toThrow(/edited/);
    expect(() => sanitizeUserPreconditions([{ kind: "file_exists", value: "../etc/passwd" }])).toThrow(/Unsafe/);
  });

  it("pin boost is modest", () => {
    expect(RECIPE_PIN_BOOST).toBeGreaterThan(1);
    expect(RECIPE_PIN_BOOST).toBeLessThan(1.2);
  });
});
