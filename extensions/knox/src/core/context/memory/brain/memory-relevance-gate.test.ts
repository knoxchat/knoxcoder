/**
 * REL-03 — Post-fusion mismatch gate (pure).
 */
import { describe, expect, it } from "vitest";

import {
  applyMismatchPenalty,
  evaluateRelevanceGate,
  extractEntityLikeTokens,
  isMismatchActive,
  LEXICAL_SCORE_MIN,
  MISMATCH_SCORE_PENALTY,
} from "./RelevanceGate.js";

describe("REL-03 RelevanceGate (pure)", () => {
  it("drops Task A memories on a Task B query with disjoint keywords", () => {
    const gate = evaluateRelevanceGate({
      query: "update the README badges",
      title: "Use JWT refresh with OAuth",
      keywords: "auth, jwt, oauth",
      content: "oauth-jwt-refresh-token-alpha is the auth approach.",
      fts5: 0,
      trigram: 0.04,
    });
    expect(gate.passed).toBe(false);
    expect(gate.lexicalOverlap).toEqual([]);
    expect(gate.reason).toBe("no-evidence");
  });

  it("passes on content-word overlap and names the tokens", () => {
    const gate = evaluateRelevanceGate({
      query: "update the README badges",
      title: "README badge layout",
      keywords: "readme, badges, shields",
      content: "readme-badges-shields-beta belong in the docs header.",
      fts5: 0.1,
      trigram: 0.1,
    });
    expect(gate.passed).toBe(true);
    expect(gate.lexicalOverlap).toEqual(expect.arrayContaining(["readme", "badges"]));
    expect(gate.reason).toMatch(/^lexical: /);
    expect(gate.reason).toMatch(/readme/);
  });

  it("passes pinned items with a reason starting with pinned", () => {
    const gate = evaluateRelevanceGate({
      query: "explain git checkpoints",
      title: "Use JWT refresh with OAuth",
      keywords: "auth, jwt",
      content: "oauth tokens",
      pinned: true,
      fts5: 0,
      trigram: 0,
    });
    expect(gate.passed).toBe(true);
    expect(gate.reason.startsWith("pinned")).toBe(true);
  });

  it("passes when fts5 + trigram meets the lexical floor", () => {
    const gate = evaluateRelevanceGate({
      query: "handler wiring",
      title: "Unrelated title xyz",
      content: "no overlapping tokens here at all",
      fts5: 0.2,
      trigram: LEXICAL_SCORE_MIN - 0.2 + 0.01,
    });
    expect(gate.passed).toBe(true);
    expect(gate.reason).toMatch(/lexical-score:/);
  });

  it("names a shared entity when the query mentions it", () => {
    const gate = evaluateRelevanceGate({
      query: "AuthService handler",
      title: "AuthService config",
      content: "wire AuthService in the DI container",
      queryEntities: ["AuthService"],
      fts5: 0,
      trigram: 0,
    });
    expect(gate.passed).toBe(true);
    expect(gate.sharedEntities).toEqual(expect.arrayContaining(["AuthService"]));
    expect(gate.reason).toMatch(/entity: AuthService/);
  });

  it("ignores KG entities that are not in the query", () => {
    const gate = evaluateRelevanceGate({
      query: "login button",
      title: "file watcher",
      content: "watches the file tree",
      queryEntities: ["file"],
      fts5: 0,
      trigram: 0,
    });
    expect(gate.passed).toBe(false);
    expect(gate.sharedEntities).toEqual([]);
  });

  it("matches hyphenated identifier parts", () => {
    const gate = evaluateRelevanceGate({
      query: "galaxy-nebula-scoped-alpha",
      title: "Workspace A only fact",
      content: "galaxy-nebula-scoped-alpha-unique-token",
      fts5: 0,
      trigram: 0,
    });
    expect(gate.passed).toBe(true);
    expect(gate.lexicalOverlap).toEqual(
      expect.arrayContaining(["galaxy", "nebula", "scoped", "alpha"]),
    );
  });

  it("extracts CamelCase entity-like tokens", () => {
    expect(extractEntityLikeTokens("fix AuthService login")).toEqual(
      expect.arrayContaining(["AuthService"]),
    );
  });

  it("requireLexical false passes a disjoint candidate (REL-20)", () => {
    const gate = evaluateRelevanceGate({
      query: "update the README badges",
      title: "Use JWT refresh with OAuth",
      keywords: "auth, jwt, oauth",
      content: "oauth-jwt-refresh-token-alpha",
      fts5: 0,
      trigram: 0.04,
      requireLexical: false,
    });
    expect(gate.passed).toBe(true);
    expect(gate.reason).toBe("no-evidence");
  });

  it("demoted items fail unless pinned (REL-14)", () => {
    const dropped = evaluateRelevanceGate({
      query: "oauth jwt refresh",
      title: "Use JWT refresh with OAuth",
      keywords: "auth, jwt, oauth",
      content: "oauth-jwt-refresh-token-alpha",
      demoted: true,
    });
    expect(dropped.passed).toBe(false);
    expect(dropped.reason).toBe("demoted");

    const pinned = evaluateRelevanceGate({
      query: "update the README badges",
      title: "Use JWT refresh with OAuth",
      keywords: "auth, jwt",
      content: "oauth tokens",
      pinned: true,
      demoted: true,
    });
    expect(pinned.passed).toBe(true);
    expect(pinned.reason.startsWith("pinned")).toBe(true);
  });

  it("isMismatchActive is topic-scoped and time-bounded", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(
      isMismatchActive({ mismatch_until: future, mismatch_topic_id: 5 }, 5),
    ).toBe(true);
    expect(
      isMismatchActive({ mismatch_until: future, mismatch_topic_id: 5 }, 9),
    ).toBe(false);
    expect(
      isMismatchActive({ mismatch_until: past, mismatch_topic_id: 5 }, 5),
    ).toBe(false);
    expect(
      isMismatchActive({ mismatch_until: future, mismatch_topic_id: null }, 5),
    ).toBe(true);
  });

  it("applyMismatchPenalty subtracts 0.15 per count unless pinned", () => {
    expect(applyMismatchPenalty(0.8, 2, false)).toBeCloseTo(
      0.8 - 2 * MISMATCH_SCORE_PENALTY,
    );
    expect(applyMismatchPenalty(0.8, 2, true)).toBe(0.8);
    expect(applyMismatchPenalty(0.1, 3, false)).toBe(0);
  });
});
