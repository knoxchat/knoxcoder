/**
 * REL-06 — Working memory isolation on topic shift.
 */
import { describe, expect, it } from "vitest";

import { injectedItemPassedGate } from "./RelevanceGate.js";
import { Brainstem } from "./regions/Brainstem.js";
import { Thalamus } from "./regions/Thalamus.js";
import {
  CURRENT_TURN_SLOT_ID,
  WM_EVICT_BELOW,
  WM_INJECT_MIN_RELEVANCE,
  WM_MISMATCH_DECAY,
  WorkingMemory,
} from "./WorkingMemory.js";

function freshWm(): WorkingMemory {
  return new WorkingMemory({
    maxSlots: 7,
    tokenBudget: 8000,
    ttlSeconds: 3600,
    decayRatePerSecond: 0,
  });
}

describe("REL-06 attendTo eviction", () => {
  it("decays mismatched items by 0.25 with floor 0 and evicts below 0.2", () => {
    const wm = freshWm();
    wm.add({
      id: "task-a",
      content: "oauth jwt refresh token design",
      source: "user",
      relevance: 0.35,
    });
    wm.add({
      id: "task-b-match",
      content: "readme badges shields layout",
      source: "semantic",
      relevance: 0.4,
    });

    wm.attendTo("update the README badges");

    expect(wm.get("task-a")).toBeUndefined();
    const kept = wm.get("task-b-match");
    expect(kept).toBeDefined();
    expect(kept!.relevance).toBeGreaterThan(0.4);
    expect(WM_MISMATCH_DECAY).toBe(0.25);
    expect(WM_EVICT_BELOW).toBe(0.2);
  });

  it("does not decay Task A on continuation filler with no content words", () => {
    const wm = freshWm();
    wm.add({
      id: "task-a",
      content: "oauth jwt refresh token design",
      source: "user",
      relevance: 0.9,
    });

    wm.attendTo("continue");
    wm.attendTo("ok");
    expect(wm.get("task-a")?.relevance).toBeCloseTo(0.9);
  });
});

describe("REL-06 buildContext filtering", () => {
  it("omits items below inject min relevance even without a query", () => {
    const wm = freshWm();
    wm.add({
      id: "weak",
      content: "oauth jwt leftover",
      source: "semantic",
      relevance: 0.3,
    });
    wm.add({
      id: "strong",
      content: "readme badges layout",
      source: "semantic",
      relevance: 0.8,
    });

    const ctx = wm.buildContext();
    expect(ctx).toContain("readme badges layout");
    expect(ctx).not.toContain("oauth jwt leftover");
    expect(WM_INJECT_MIN_RELEVANCE).toBe(0.35);
  });

  it("omits high-relevance Task A on a disjoint Task B query", () => {
    const wm = freshWm();
    wm.add({
      id: "task-a",
      content: "oauth jwt refresh token design",
      source: "user",
      relevance: 0.95,
    });

    const ctx = wm.buildContext("update the README badges");
    expect(ctx).toBeNull();
  });

  it("keeps Task A on a continuation retrieval query with topic overlap", () => {
    const wm = freshWm();
    wm.add({
      id: "task-a",
      content: "oauth jwt refresh token design",
      source: "user",
      relevance: 0.95,
    });

    const ctx = wm.buildContext("oauth jwt refresh");
    expect(ctx).toContain("oauth jwt refresh token design");
  });

  it("injects the current-turn user slot even without query overlap", () => {
    const wm = freshWm();
    wm.add({
      id: CURRENT_TURN_SLOT_ID,
      content: "now update the README badges",
      source: "user",
      relevance: 0.7,
    });
    wm.add({
      id: "task-a",
      content: "oauth jwt refresh token design",
      source: "semantic",
      relevance: 0.9,
    });

    const ctx = wm.buildContext("readme badges");
    expect(ctx).toContain("now update the README badges");
    expect(ctx).not.toContain("oauth jwt refresh token design");
  });
});

describe("REL-06 topic shift + current-turn slot", () => {
  it("flushOnTopicShift clears Task A scratch", () => {
    const wm = freshWm();
    wm.add({
      id: "task-a",
      content: "oauth jwt refresh token design",
      source: "user",
      relevance: 0.95,
    });
    wm.flushOnTopicShift();
    expect(wm.getAll()).toHaveLength(0);
    expect(wm.buildContext("oauth jwt")).toBeNull();
  });

  it("Thalamus.gateTurn flushes on new-task so WM context omits Task A", () => {
    const wm = freshWm();
    wm.add({
      id: "task-a-salient",
      content: "oauth jwt refresh Task A scratchpad",
      source: "user",
      relevance: 0.95,
    });

    Thalamus.gateTurn(wm, {
      message: "now update the README badges",
      framed: "now update the README badges",
      role: "user",
      intent: "new_task",
    });

    expect(wm.get("task-a-salient")).toBeUndefined();
    const ctx = wm.buildContext("update the README badges");
    expect(ctx ?? "").not.toContain("oauth jwt refresh Task A scratchpad");
  });

  it("Thalamus.gateTurn keeps Task A on continuation", () => {
    const wm = freshWm();
    wm.add({
      id: "task-a-salient",
      content: "oauth jwt refresh Task A scratchpad",
      source: "user",
      relevance: 0.95,
    });

    Thalamus.gateTurn(wm, {
      message: "continue",
      framed: "continue",
      role: "user",
      intent: "continuation",
      retrievalQuery: "oauth jwt refresh",
    });

    expect(wm.get("task-a-salient")).toBeDefined();
    const ctx = wm.buildContext("oauth jwt refresh");
    expect(ctx).toContain("oauth jwt refresh Task A scratchpad");
  });

  it("replaces a single current-turn slot instead of accumulating salient ids", () => {
    const wm = freshWm();
    Thalamus.attend(wm, "URGENT CRITICAL: oauth jwt now!!!", "user");
    Thalamus.attend(wm, "URGENT CRITICAL: readme badges now!!!", "user");

    const slots = wm.getAll().filter(
      (i) => i.id === CURRENT_TURN_SLOT_ID || i.id.startsWith("salient:"),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].id).toBe(CURRENT_TURN_SLOT_ID);
    expect(slots[0].content).toMatch(/readme badges/i);
  });

  it("does not add a current-turn slot for low-salience filler", () => {
    const wm = freshWm();
    Thalamus.attend(wm, "hello");
    expect(wm.getAll()).toHaveLength(0);
  });
});

describe("REL-06 Brainstem→Thalamus feedback", () => {
  it("does not re-attend titles that failed the relevance gate", () => {
    const wm = freshWm();
    wm.add({
      id: "task-a",
      content: "oauth jwt refresh token design",
      source: "semantic",
      relevance: 0.9,
    });

    Brainstem.feedbackToThalamus(wm, {
      context: "",
      items: [
        {
          id: 1,
          kind: "semantic",
          title: "unrelated xyzzzz nomatch",
          reason: "no-evidence",
        },
        {
          id: null,
          kind: "working",
          title: "Working memory",
          reason: "Active scratchpad for this session",
        },
      ],
    });

    expect(wm.get("task-a")?.relevance).toBeCloseTo(0.9);
  });

  it("re-attends titles that passed REL-03", () => {
    const wm = freshWm();
    wm.add({
      id: "task-a",
      content: "oauth jwt refresh token design",
      source: "semantic",
      relevance: 0.5,
    });

    expect(injectedItemPassedGate({
      kind: "semantic",
      reason: "lexical: oauth, jwt",
    })).toBe(true);

    Brainstem.feedbackToThalamus(wm, {
      context: "",
      items: [
        {
          id: 1,
          kind: "semantic",
          title: "oauth jwt refresh",
          reason: "lexical: oauth, jwt",
        },
      ],
    });

    expect(wm.get("task-a")!.relevance).toBeGreaterThan(0.5);
  });
});
