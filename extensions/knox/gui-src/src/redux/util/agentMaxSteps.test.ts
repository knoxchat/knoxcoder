import { describe, expect, it } from "vitest";

import {
  ABSOLUTE_MAX_AGENT_STEPS,
  DEFAULT_AGENT_MAX_STEPS,
  buildAgentMaxStepsSummaryInstruction,
  resolveAgentMaxSteps,
  shouldDisableToolsForMaxSteps,
} from "./agentMaxSteps";

describe("resolveAgentMaxSteps", () => {
  it("defaults to unlimited when unset or invalid", () => {
    expect(resolveAgentMaxSteps(undefined)).toBeNull();
    expect(resolveAgentMaxSteps(null)).toBeNull();
    expect(resolveAgentMaxSteps("40")).toBeNull();
    expect(resolveAgentMaxSteps(NaN)).toBeNull();
    expect(resolveAgentMaxSteps(-1)).toBeNull();
    expect(DEFAULT_AGENT_MAX_STEPS).toBe(0);
  });

  it("treats 0 as unlimited", () => {
    expect(resolveAgentMaxSteps(0)).toBeNull();
  });

  it("accepts positive integers and floors floats", () => {
    expect(resolveAgentMaxSteps(25)).toBe(25);
    expect(resolveAgentMaxSteps(25.9)).toBe(25);
  });

  it("clamps absurd values", () => {
    expect(resolveAgentMaxSteps(ABSOLUTE_MAX_AGENT_STEPS + 50)).toBe(
      ABSOLUTE_MAX_AGENT_STEPS,
    );
  });

  it("does not cap systems or rust profiles unless maxSteps is set", () => {
    expect(resolveAgentMaxSteps(undefined, "systems")).toBeNull();
    expect(resolveAgentMaxSteps(80, "systems")).toBe(80);
    expect(resolveAgentMaxSteps(undefined, "rust")).toBeNull();
    expect(resolveAgentMaxSteps(45, "rust")).toBe(45);
  });
});

describe("shouldDisableToolsForMaxSteps", () => {
  it("never disables when unlimited", () => {
    expect(shouldDisableToolsForMaxSteps(999, null)).toBe(false);
  });

  it("disables at and above the cap", () => {
    expect(shouldDisableToolsForMaxSteps(39, 40)).toBe(false);
    expect(shouldDisableToolsForMaxSteps(40, 40)).toBe(true);
    expect(shouldDisableToolsForMaxSteps(41, 40)).toBe(true);
  });
});

describe("buildAgentMaxStepsSummaryInstruction", () => {
  it("includes the max and forbids further tools", () => {
    const text = buildAgentMaxStepsSummaryInstruction(40);
    expect(text).toContain("40");
    expect(text.toLowerCase()).toContain("do not call any tools");
  });
});
