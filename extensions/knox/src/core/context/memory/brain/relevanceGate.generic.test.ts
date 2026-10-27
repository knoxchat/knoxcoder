import { describe, expect, it } from "vitest";

import { recipeMemoryIsVerified } from "../recipes/memoryLink";
import { evaluateRelevanceGate } from "./RelevanceGate";

describe("RelevanceGate generic words (MC-50)", () => {
  const mem = { title: "Write unit tests with vitest", keywords: "test, vitest", content: "Prefer vitest over jest." };
  it("does not pass on a shared generic verb alone", () => {
    expect(evaluateRelevanceGate({ query: "write a haiku about autumn", ...mem }).passed).toBe(false);
  });
  it("passes on a shared topical word", () => {
    expect(evaluateRelevanceGate({ query: "write vitest cases for the parser", ...mem }).passed).toBe(true);
  });
  it("still passes pinned items", () => {
    expect(evaluateRelevanceGate({ query: "write a haiku", ...mem, pinned: true }).passed).toBe(true);
  });
});

describe("RelevanceGate verified-ness and mismatch (MC-50)", () => {
  const base = { query: "zzz", title: "Unrelated note", content: "nothing shared here" };
  it("a weak lexical score alone passes only above the bar", () => {
    expect(evaluateRelevanceGate({ ...base, fts5: 0.15 }).passed).toBe(false);
    expect(evaluateRelevanceGate({ ...base, fts5: 0.3 }).passed).toBe(true);
  });
  it("verified memories get half the bar, but no score still fails", () => {
    expect(evaluateRelevanceGate({ ...base, fts5: 0.15, verified: true }).passed).toBe(true);
    expect(evaluateRelevanceGate({ ...base, verified: true }).passed).toBe(false);
  });
  it("a previously rejected memory needs real overlap, not a score", () => {
    expect(evaluateRelevanceGate({ ...base, fts5: 0.3, mismatchCount: 1 }).passed).toBe(false);
    expect(
      evaluateRelevanceGate({ query: "vitest parser", title: "Vitest", fts5: 0.3, mismatchCount: 1 }).passed,
    ).toBe(true);
  });
  it("lexicalScoreMin overrides the default bar", () => {
    expect(evaluateRelevanceGate({ ...base, fts5: 0.15, lexicalScoreMin: 0.1 }).passed).toBe(true);
  });

  it("a linked recipe memory gets the verified bar, a reverted one does not", () => {
    const content = `Verified recipe: create Button\nrecipe_id: ${"a".repeat(64)}`;
    expect(recipeMemoryIsVerified(content)).toBe(true);
    expect(evaluateRelevanceGate({ ...base, content, fts5: 0.15, verified: recipeMemoryIsVerified(content) }).passed).toBe(true);
    expect(
      evaluateRelevanceGate({
        ...base,
        content,
        fts5: 0.15,
        verified: recipeMemoryIsVerified(content, { verified: 1, reverted: 1 }),
      }).passed,
    ).toBe(false);
  });
});
