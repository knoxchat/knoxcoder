import { describe, expect, it } from "vitest";

import {
  aliasPlanAction,
  coercePlanSteps,
  fallbackPlanFromGoal,
  inferPlanAction,
  parsePlanDraft,
} from "./planDraft";

describe("planDraft", () => {
  it("aliases sloppy action names", () => {
    expect(aliasPlanAction("Start")).toBe("create");
    expect(aliasPlanAction("done")).toBe("complete");
    expect(aliasPlanAction("append")).toBe("add");
    expect(aliasPlanAction("show")).toBe("list");
  });

  it("infers create vs add vs list from session state", () => {
    expect(
      inferPlanAction({
        action: "",
        existing: false,
        hasSteps: true,
        hasTitle: false,
        hasStepRef: false,
      }),
    ).toBe("create");
    expect(
      inferPlanAction({
        action: "",
        existing: true,
        hasSteps: true,
        hasTitle: false,
        hasStepRef: false,
      }),
    ).toBe("add");
    expect(
      inferPlanAction({
        action: "create",
        existing: true,
        hasSteps: false,
        hasTitle: false,
        hasStepRef: false,
      }),
    ).toBe("create");
    expect(
      inferPlanAction({
        action: "",
        existing: true,
        hasSteps: false,
        hasTitle: false,
        hasStepRef: false,
      }),
    ).toBe("list");
    expect(
      inferPlanAction({
        action: "",
        existing: true,
        hasSteps: false,
        hasTitle: false,
        hasStepRef: true,
      }),
    ).toBe("complete");
  });

  it("splits numbered and newline checklists", () => {
    expect(coercePlanSteps("1. Scaffold\n2. UI\n3. Tests")).toEqual([
      "Scaffold",
      "UI",
      "Tests",
    ]);
    expect(coercePlanSteps(["Cargo.toml", "main.rs"])).toEqual([
      "Cargo.toml",
      "main.rs",
    ]);
  });

  it("parses fenced JSON and drops wait-for-user steps", () => {
    const parsed = parsePlanDraft(`\`\`\`json
{"title":"Snake","steps":["Scaffold","Ask the user which Rust version","Verify"]}
\`\`\``);
    expect(parsed?.title).toBe("Snake");
    expect(parsed?.steps).toEqual(["Scaffold", "Verify"]);
  });

  it("falls back to a single step from the request", () => {
    const fallback = fallbackPlanFromGoal("Build a Dioxus snake game");
    expect(fallback.title).toContain("Dioxus");
    expect(fallback.steps).toEqual(["Build a Dioxus snake game"]);
  });
});
