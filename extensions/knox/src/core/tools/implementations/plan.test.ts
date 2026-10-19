import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolExtras } from "../..";

import { planImpl } from "./plan";
import {
  createPlan,
  formatPlanInject,
  formatPlanInjectFromHistory,
  formatPlanText,
  parsePlanText,
  PLAN_CLEARED_TEXT,
  resetPlansForTests,
  resolveOpenPlan,
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
    expect(listed[0].content).toMatch(/\[\*].*Reproduce panic/);
    expect(formatPlanInject("sess-plan")).toContain("7 remaining / 8 total");
    expect(formatPlanInject("sess-plan")).toMatch(/Remaining 7:/);
  });

  it("create starts the first step and complete advances the next", async () => {
    const created = await planImpl(
      { action: "create", title: "Snake", steps: ["Cargo.toml", "main.rs", "tests"] },
      extras(),
    );
    expect(created[0].content).toMatch(/\[\*].*Cargo\.toml/);
    await planImpl({ action: "complete", step_id: "1" }, extras());
    const listed = await planImpl({ action: "list" }, extras());
    expect(listed[0].content).toMatch(/\[x\].*Cargo\.toml/);
    expect(listed[0].content).toMatch(/\[\*].*main\.rs/);
    expect(listed[0].content).toContain("2 remaining / 3 total");
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

  it("skip of the current step starts the next pending one", async () => {
    await planImpl(
      { action: "create", title: "Snake", steps: ["Cargo.toml", "main.rs"] },
      extras(),
    );
    await planImpl({ action: "skip", step_id: "1" }, extras());
    const listed = await planImpl({ action: "list" }, extras());
    expect(listed[0].content).toMatch(/\[-\].*Cargo\.toml/);
    expect(listed[0].content).toMatch(/\[\*].*main\.rs/);
  });

  it("restores the live store from history so complete still works after reload", async () => {
    const created = createPlan({
      sessionId: "sess-restore",
      title: "Snake",
      steps: ["Cargo.toml", "main.rs"],
    });
    const history = [
      {
        message: { content: formatPlanText(created) },
        contextItems: [
          {
            name: "Plan",
            description: "created",
            content: formatPlanText(created),
          },
        ],
      },
    ];
    resetPlansForTests();
    expect(formatPlanInject("sess-restore")).toBe("");
    expect(formatPlanInjectFromHistory(history, "sess-restore")).toContain(
      "Cargo.toml",
    );
    expect(formatPlanInject("sess-restore")).toContain("[*] ");
    await planImpl({ action: "complete", step_id: "1" }, extras("sess-restore"));
    expect(formatPlanInject("sess-restore")).toMatch(/\[x\].*Cargo\.toml/);
    expect(formatPlanInject("sess-restore")).toMatch(/\[\*].*main\.rs/);
  });

  it("resolveOpenPlan ignores a plan that was cleared in the transcript", () => {
    const plan = createPlan({
      sessionId: "sess-clear",
      title: "Snake",
      steps: ["Cargo.toml"],
    });
    const messages = [
      { role: "tool", content: formatPlanText(plan) },
      { role: "tool", content: PLAN_CLEARED_TEXT },
    ];
    resetPlansForTests();
    expect(
      resolveOpenPlan({ sessionId: "sess-clear", messages }),
    ).toBeUndefined();
    expect(resolveOpenPlan({ messages })).toBeUndefined();
  });

  it("K-060 persists the plan next to an existing session file", () => {
    const prev = process.env.KNOX_GLOBAL_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knox-plan-"));
    process.env.KNOX_GLOBAL_DIR = dir;
    try {
      const sessions = path.join(dir, "sessions");
      fs.mkdirSync(sessions, { recursive: true });
      fs.writeFileSync(
        path.join(sessions, "sess-persist.json"),
        JSON.stringify({
          sessionId: "sess-persist",
          title: "t",
          workspaceDirectory: "",
          history: [],
        }),
      );
      createPlan({
        sessionId: "sess-persist",
        title: "Snake",
        steps: ["Cargo.toml", "main.rs"],
      });
      resetPlansForTests();
      expect(formatPlanInject("sess-persist")).toContain("Cargo.toml");
      expect(formatPlanInject("sess-persist")).toContain("2 remaining / 2 total");
    } finally {
      resetPlansForTests();
      if (prev === undefined) {
        delete process.env.KNOX_GLOBAL_DIR;
      } else {
        process.env.KNOX_GLOBAL_DIR = prev;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not persist when no session file exists", () => {
    createPlan({
      sessionId: "sess-memory-only",
      title: "T",
      steps: ["one"],
    });
    resetPlansForTests();
    expect(formatPlanInject("sess-memory-only")).toBe("");
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
