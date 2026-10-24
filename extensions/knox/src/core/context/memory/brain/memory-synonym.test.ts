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

  it("expands invoice/tax, a11y, and design-system paraphrases (T6)", () => {
    expect(getSynonymAdditions("calculate the invoice total with tax")).toEqual(
      expect.arrayContaining(["money", "cents"]),
    );
    expect(getSynonymAdditions("accessible name for the dialog")).toEqual(
      expect.arrayContaining(["a11y"]),
    );
    expect(getSynonymAdditions("use the design-system tokens")).toEqual(
      expect.arrayContaining(["components"]),
    );
  });

  it("prefers the longer phrase so icon-only and settings-card hit a11y / design-system (T12)", () => {
    expect(getSynonymAdditions("build an icon-only close button for the dialog")).toEqual(
      expect.arrayContaining(["a11y"]),
    );
    expect(getSynonymAdditions("create a settings card with a toggle")).toEqual(
      expect.arrayContaining(["design-system", "tokens"]),
    );
    // Bare "settings" still means config/preferences, not the UI kit.
    expect(getSynonymAdditions("open settings")).toEqual(
      expect.arrayContaining(["configuration", "preferences"]),
    );
    expect(getSynonymAdditions("open settings")).not.toEqual(
      expect.arrayContaining(["design-system"]),
    );
  });
});
