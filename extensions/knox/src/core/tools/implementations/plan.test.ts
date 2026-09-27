import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolExtras } from "../..";

import { planImpl } from "./plan";
import {
  createPlan,
  formatPlanInject,
  formatPlanText,
  parsePlanText,
  resetPlansForTests,
} from "../planStore";

function extras(sessionId = "sess-plan"): ToolExtras {
  return {
    ide: {} as ToolExtras["ide"],
    llm: {} as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: "builtin_plan" } } as ToolExtras["tool"],
    soul: { sessionId },
  };
}

describe("builtin_plan", () => {
  afterEach(() => {
    resetPlansForTests();
  });

  it("creates and lists an 8-step kernel plan", async () => {
    const steps = [
      "Read MAINTAINERS for mm",
      "Reproduce panic in QEMU",
      "Parse oops RIP",
      "Patch copy_to_user",
      "Rebuild vmlinux",
      "Boot qemu-system-x86_64",
      "Run kselftest",
      "Commit the fix",
    ];
    const created = await planImpl(
      { action: "create", title: "Boot panic in mm", steps },
      extras(),
    );
    expect(created[0].content).toContain("Task Execution Plan");
    expect(created[0].hidden).toBe(true);
    expect(created[0].content).toContain("Boot panic in mm");
    for (const step of steps) {
      expect(created[0].content).toContain(step);
    }

    await planImpl({ action: "complete", step_id: "1" }, extras());
    const listed = await planImpl({ action: "list" }, extras());
    expect(listed[0].content).toMatch(/\[x\].*Read MAINTAINERS/);
    expect(formatPlanInject("sess-plan")).toContain("7 remaining / 8 total");
  });

  it("isolates plans by session", async () => {
    await planImpl(
      { action: "create", title: "A", steps: ["one"] },
      extras("sess-a"),
    );
    expect(formatPlanInject("sess-b")).toBe("");
    expect(formatPlanInject("sess-a")).toContain("one");
  });

  it("adds and skips steps", async () => {
    createPlan({ sessionId: "sess-plan", title: "T", steps: ["first"] });
    await planImpl({ action: "add", title: "second" }, extras());
    await planImpl({ action: "skip", step_id: "2" }, extras());
    const text = formatPlanInject("sess-plan");
    expect(text).toContain("second");
    expect(text).toMatch(/\[-\].*second/);
  });

  it("round-trips formatPlanText through parsePlanText", () => {
    const plan = createPlan({
      sessionId: "sess-parse",
      title: "Boot panic in mm",
      steps: ["Read MAINTAINERS for mm", "Patch copy_to_user (safe)"],
    });
    const parsed = parsePlanText(formatPlanText(plan));
    expect(parsed?.title).toBe(plan.title);
    expect(parsed?.steps.map((s) => s.title)).toEqual(
      plan.steps.map((s) => s.title),
    );
    expect(parsed?.steps.map((s) => s.id)).toEqual(plan.steps.map((s) => s.id));
    expect(parsePlanText("not a plan")).toBeUndefined();
  });
});
