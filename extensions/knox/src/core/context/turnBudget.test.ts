import { afterEach, describe, expect, it } from "vitest";

import type { ChatMessage } from "..";
import { parseMemoryCites } from "./memory/brain/attribution";
import { isMemoryUserMessage } from "./memory/brain/injectFormat";
import { createPlan, resetPlansForTests } from "../tools/planStore";
import { constructMessages } from "../llm/constructMessages";
import {
  resetCodebaseCardForTests,
  setCodebaseCardInject,
} from "./codebaseCard";
import {
  resetTurnContextForTests,
  setTurnContextInject,
} from "./turnContext";
import {
  applyTurnBudget,
  applyTurnInjectToMessages,
  classifyInjectedContext,
  classifyTurnInjectText,
  DEFAULT_TURN_INJECT_CAP,
  estimateTurnInjectTokens,
  getTurnInjectCap,
  MIN_TURN_INJECT_CAP,
} from "./turnBudget";

describe("turn inject budget (K-072)", () => {
  const prevCap = process.env.KNOX_TURN_INJECT_CAP;

  afterEach(() => {
    if (prevCap === undefined) {
      delete process.env.KNOX_TURN_INJECT_CAP;
    } else {
      process.env.KNOX_TURN_INJECT_CAP = prevCap;
    }
    resetPlansForTests();
    resetCodebaseCardForTests();
    resetTurnContextForTests();
  });

  it("defaults to 12k and honors KNOX_TURN_INJECT_CAP", () => {
    delete process.env.KNOX_TURN_INJECT_CAP;
    expect(getTurnInjectCap()).toBe(DEFAULT_TURN_INJECT_CAP);
    process.env.KNOX_TURN_INJECT_CAP = "10";
    expect(getTurnInjectCap()).toBe(DEFAULT_TURN_INJECT_CAP);
    process.env.KNOX_TURN_INJECT_CAP = String(MIN_TURN_INJECT_CAP);
    expect(getTurnInjectCap()).toBe(MIN_TURN_INJECT_CAP);
    process.env.KNOX_TURN_INJECT_CAP = "4000";
    expect(getTurnInjectCap()).toBe(4000);
  });

  it("keeps the union ≤ cap when Brain returns 8k and turn context is large", () => {
    const memory = "m".repeat(8_000 * 4);
    const turn = `## Turn Context\n${"t".repeat(6_000 * 4)}`;
    const cards = `## Codebase Card\n${"c".repeat(4_000 * 4)}`;
    const kept = applyTurnBudget(
      [
        { kind: "retrieved_memory", text: memory },
        { kind: "turn_context", text: turn },
        { kind: "cards", text: cards },
      ],
      12_000,
    );
    const tokens = kept.reduce(
      (sum, block) => sum + estimateTurnInjectTokens(block.text),
      0,
    );
    expect(tokens).toBeLessThanOrEqual(12_000);
    expect(kept.some((block) => block.kind === "turn_context")).toBe(true);
    expect(kept.some((block) => block.kind === "retrieved_memory")).toBe(false);
  });

  it("keeps a recipe stub when the full hint cannot fit", () => {
    const stub = `<verified_recipe_stub title="Add lint">\nFiles: package.json\n</verified_recipe_stub>`;
    const full = `<verified_recipe title="Add lint">\n${"x".repeat(20_000)}\n</verified_recipe>`;
    const kept = applyTurnBudget(
      [
        { kind: "retrieved_memory", text: `=== Relevant Knowledge from Memory ===\n${"m".repeat(8_000)}` },
        { kind: "recipe_stub", text: stub },
        { kind: "recipe", text: full },
      ],
      2_000,
    );
    expect(kept.some((block) => block.kind === "recipe_stub")).toBe(true);
    expect(kept.some((block) => block.kind === "recipe")).toBe(false);
    expect(kept.find((block) => block.kind === "recipe_stub")?.text).toContain("package.json");
  });

  it("classifies verified_recipe markers", () => {
    expect(classifyTurnInjectText("<verified_recipe_stub title=\"x\">\nFiles: a.ts\n</verified_recipe_stub>")).toBe(
      "recipe_stub",
    );
    expect(classifyTurnInjectText("<verified_recipe title=\"x\">\nFile: a.ts\n</verified_recipe>")).toBe("recipe");
  });

  it("never drops pinned memory or the plan before unpinned memories", () => {
    const pinned = `[pinned] [decision] Auth: use JWT\n${"P".repeat(800)}`;
    const plan = `## Task Execution Plan\n- 1. Fix auth`;
    const retrieved = `=== Relevant Knowledge from Memory ===\n${"r".repeat(20_000)}`;
    const kept = applyTurnBudget(
      [
        { kind: "retrieved_memory", text: retrieved },
        { kind: "plan", text: plan },
        { kind: "pinned_memory", text: pinned },
      ],
      2_000,
    );
    const kinds = kept.map((block) => block.kind);
    expect(kinds).toContain("pinned_memory");
    expect(kinds).toContain("plan");
    expect(kinds).not.toContain("retrieved_memory");
    const tokens = kept.reduce(
      (sum, block) => sum + estimateTurnInjectTokens(block.text),
      0,
    );
    expect(tokens).toBeLessThanOrEqual(2_000);
  });

  it("splits a GUI memory blob into pinned vs retrieved", () => {
    const blocks = classifyInjectedContext(
      [
        "Restored to cp-1",
        "## Relevant Memory Context",
        "(Background notes from past sessions — for reference only.)",
        "[pinned] [decision] Auth: JWT",
        "[fact] Unrelated note: the cafeteria menu",
      ].join("\n\n"),
    );
    expect(blocks.some((block) => block.kind === "oracle")).toBe(true);
    expect(blocks.some((block) => block.kind === "pinned_memory")).toBe(true);
    expect(blocks.some((block) => block.kind === "retrieved_memory")).toBe(true);
    expect(
      blocks.find((block) => block.kind === "pinned_memory")?.text,
    ).toMatch(/JWT/);
  });

  it("re-packs constructMessages injects so the system injects stay ≤ cap", () => {
    process.env.KNOX_TURN_INJECT_CAP = "1500";
    setCodebaseCardInject(`## Codebase Card\n${"C".repeat(4_000)}`);
    setTurnContextInject(`## Turn Context\n${"T".repeat(4_000)}`);
    createPlan({
      sessionId: "k072",
      title: "Keep this plan",
      steps: ["one"],
    });
    const injects = constructMessages([], "k072")
      .filter((message) => message.role === "system")
      .slice(1)
      .map((message) => String(message.content));
    const tokens = injects.reduce(
      (sum, text) => sum + estimateTurnInjectTokens(text),
      0,
    );
    expect(tokens).toBeLessThanOrEqual(1500);
    expect(injects.some((text) => text.includes("Keep this plan"))).toBe(true);
  });

  it("drops retrieved memory before the plan when merging injectedContext", () => {
    process.env.KNOX_TURN_INJECT_CAP = "800";
    createPlan({
      sessionId: "k072-merge",
      title: "Plan stays",
      steps: ["one"],
    });
    const base = constructMessages([], "k072-merge");
    const packed = applyTurnInjectToMessages(base, [
      {
        kind: "retrieved_memory",
        text: `## Relevant Memory Context\n${"x".repeat(8_000)}`,
      },
      { kind: "pinned_memory", text: "[pinned] [decision] Keep me" },
    ]);
    // MEM-63: memory is a quoted user-role block; the plan stays a system inject.
    const injects = packed
      .filter((message) => message.role === "system" || message.role === "user")
      .slice(1)
      .map((message) => String(message.content))
      .join("\n");
    expect(injects).toMatch(/Plan stays/);
    expect(injects).toMatch(/Keep me/);
    expect(estimateTurnInjectTokens(injects)).toBeLessThanOrEqual(800);
  });

  it("MEM-63: retrieved memory is a quoted user-role block, never system text", () => {
    const base: ChatMessage[] = [
      { role: "system", content: "You are Knox." },
      { role: "user", content: "earlier" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "now do it" },
    ];
    const packed = applyTurnInjectToMessages(base, [
      {
        kind: "retrieved_memory",
        text: "## Relevant Memory Context\n[mem:semantic:7] [fact] Use tabs\n\n[mem:semantic:8] [fact] Port 5173",
      },
      { kind: "pinned_memory", text: "[pinned] [decision] Auth: JWT" },
    ]);
    const system = packed.filter((m) => m.role === "system").map((m) => String(m.content)).join("\n");
    expect(system).not.toMatch(/Use tabs|JWT|Port 5173|\[mem:/);
    const memory = packed.filter((m) => m.role === "user" && isMemoryUserMessage(String(m.content)));
    expect(memory).toHaveLength(1);
    const text = String(memory[0].content);
    expect(text).toContain("> [mem:semantic:7] [fact] Use tabs");
    expect(text).toContain("> [pinned] [decision] Auth: JWT");
    // placed right before the final user message
    expect(packed[packed.length - 1]).toEqual({ role: "user", content: "now do it" });
    expect(packed[packed.length - 2]).toBe(memory[0]);
    // cite round-trip: the attribution parser still sees every cite inside the quote
    expect(parseMemoryCites(text).map((c) => c.mem_id)).toEqual(["7", "8"]);
  });

  it("MEM-63: repacking does not duplicate the memory block", () => {
    const base: ChatMessage[] = [
      { role: "system", content: "You are Knox." },
      { role: "user", content: "now do it" },
    ];
    const once = applyTurnInjectToMessages(base, [
      { kind: "retrieved_memory", text: "## Relevant Memory Context\n[mem:semantic:1] [fact] A" },
    ]);
    const twice = applyTurnInjectToMessages(once, []);
    const blocks = twice.filter((m) => m.role === "user" && isMemoryUserMessage(String(m.content)));
    expect(blocks).toHaveLength(1);
    expect(String(blocks[0].content)).toContain("> [mem:semantic:1] [fact] A");
  });

  it("MEM-63: unrecognised system injects are not moved to the user role", () => {
    const packed = applyTurnInjectToMessages(
      [{ role: "system", content: "You are Knox." }, { role: "user", content: "hi" }],
      [{ kind: "oracle", text: "Restored to cp-1" }],
    );
    expect(packed.filter((m) => m.role === "system").map((m) => String(m.content))).toContain("Restored to cp-1");
    expect(packed.some((m) => m.role === "user" && isMemoryUserMessage(String(m.content)))).toBe(false);
  });
});
