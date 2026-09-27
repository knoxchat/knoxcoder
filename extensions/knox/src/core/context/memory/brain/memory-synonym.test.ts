/**
 * REL-16 — Synonym expansion precision.
 */
import { describe, expect, it } from "vitest";

import { expandQuerySynonyms, getSynonymAdditions } from "./EnhancedSemantic.js";

describe("REL-16 synonym expansion", () => {
  it("matches whole tokens only", () => {
    expect(getSynonymAdditions("config")).toEqual(
      expect.arrayContaining(["settings"]),
    );
    expect(getSynonymAdditions("memory")).toEqual(
      expect.arrayContaining(["context"]),
    );
    expect(getSynonymAdditions("remembering things")).not.toEqual(
      expect.arrayContaining(["context"]),
    );
    expect(getSynonymAdditions("contextual")).not.toContain("memory");
    expect(getSynonymAdditions("contextual")).not.toContain("recall");
  });

  it("expands at most one group and at most 3 synonyms", () => {
    const additions = getSynonymAdditions("fix authentication bug");
    expect(additions).toContain("login");
    expect(additions).not.toContain("error");
    expect(additions.length).toBeLessThanOrEqual(3);
  });

  it("does not expand continuation queries", () => {
    expect(getSynonymAdditions("continue with auth", { continuation: true })).toEqual([]);
    expect(expandQuerySynonyms("config", { continuation: true })).toBe("config");
  });
});
