import { describe, expect, it } from "vitest";

import {
  DECISIONS_CATALOG_JEV,
  DECISIONS_MODELS,
  decisionsCatalogId,
  decisionsFamily,
  decisionsImageAcceptsUrl,
  decisionsMaxImages,
  decisionsModelReadsNestedImages,
  decisionsModelRequiresOpenRouter,
  isGeminiDecisionModel,
  listDecisionsModels,
  OPENROUTER_GEMINI_DECISION_MODEL,
} from "./models";

describe("Decisions model catalog", () => {
  it("lists Jev and Gemini Decision 1", () => {
    expect(listDecisionsModels().map((entry) => entry.catalogId)).toEqual([
      DECISIONS_CATALOG_JEV,
      OPENROUTER_GEMINI_DECISION_MODEL,
    ]);
    expect(DECISIONS_MODELS).toHaveLength(2);
  });

  it("treats gemini-decision aliases as Gemini Decision 1", () => {
    expect(isGeminiDecisionModel("google/gemini-decision-1")).toBe(true);
    expect(isGeminiDecisionModel("gemini-decision-1")).toBe(true);
    expect(isGeminiDecisionModel("gemini-decision")).toBe(true);
    expect(isGeminiDecisionModel("jev")).toBe(false);
    expect(isGeminiDecisionModel("typesafe/jev-1.14")).toBe(false);
    expect(decisionsFamily("google/gemini-decision-1")).toBe("gemini");
    expect(decisionsCatalogId("gemini-decision-1")).toBe(
      OPENROUTER_GEMINI_DECISION_MODEL,
    );
    expect(decisionsCatalogId("typesafe/jev-1.14")).toBe(DECISIONS_CATALOG_JEV);
    expect(decisionsModelRequiresOpenRouter("google/gemini-decision-1")).toBe(
      true,
    );
    expect(decisionsModelRequiresOpenRouter("jev")).toBe(false);
  });

  it("accepts Gemini image types Jev rejects", () => {
    const png = "data:image/png;base64,aaa";
    const webp = "data:image/webp;base64,bbb";
    const remote = "https://example.com/shot.png";
    expect(decisionsImageAcceptsUrl(png, "typesafe/jev-1.14")).toBe(true);
    expect(decisionsImageAcceptsUrl(webp, "typesafe/jev-1.14")).toBe(false);
    expect(decisionsImageAcceptsUrl(remote, "typesafe/jev-1.14")).toBe(false);
    expect(decisionsImageAcceptsUrl(webp, OPENROUTER_GEMINI_DECISION_MODEL)).toBe(
      true,
    );
    expect(
      decisionsImageAcceptsUrl(remote, OPENROUTER_GEMINI_DECISION_MODEL),
    ).toBe(true);
    expect(decisionsModelReadsNestedImages("typesafe/jev-1.14")).toBe(true);
    expect(
      decisionsModelReadsNestedImages(OPENROUTER_GEMINI_DECISION_MODEL),
    ).toBe(false);
    expect(decisionsMaxImages("typesafe/jev-1.14")).toBe(4);
    expect(decisionsMaxImages(OPENROUTER_GEMINI_DECISION_MODEL)).toBe(16);
  });
});
