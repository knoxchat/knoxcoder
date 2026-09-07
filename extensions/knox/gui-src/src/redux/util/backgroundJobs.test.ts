import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";
import type { AgentBackgroundJob } from "core/protocol/agentJobs";

import {
  collectRunningTaskJobs,
  countRunningJobs,
  isTaskJobId,
  jobToastLevel,
  jobsToNotify,
  mergeBackgroundJobs,
  sortBackgroundJobs,
  truncateJobTitle,
} from "./backgroundJobs";

function job(
  partial: Partial<AgentBackgroundJob> & Pick<AgentBackgroundJob, "id">,
): AgentBackgroundJob {
  return {
    kind: "shell",
    title: partial.id,
    status: "running",
    ...partial,
  };
}

describe("truncateJobTitle", () => {
  it("collapses whitespace and ellipsizes", () => {
    expect(truncateJobTitle("  pnpm   test  ")).toBe("pnpm test");
    expect(truncateJobTitle("x".repeat(80), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("sortBackgroundJobs / merge / count", () => {
  it("puts running jobs first, then newest startedAt", () => {
    const sorted = sortBackgroundJobs([
      job({ id: "old-done", status: "exited", startedAt: 30 }),
      job({ id: "new-run", status: "running", startedAt: 10 }),
      job({ id: "old-run", status: "running", startedAt: 5 }),
    ]);
    expect(sorted.map((j) => j.id)).toEqual(["new-run", "old-run", "old-done"]);
  });

  it("merges shell + task without clobbering shell ids", () => {
    const merged = mergeBackgroundJobs(
      [job({ id: "sh_1", title: "echo" })],
      [job({ id: "task:a", kind: "task", title: "review" })],
    );
    expect(merged.map((j) => j.id).sort()).toEqual(["sh_1", "task:a"]);
    expect(countRunningJobs(merged)).toBe(2);
  });
});

describe("jobsToNotify", () => {
  it("toasts only jobs that were running and are now finished", () => {
    const prev = [
      job({ id: "a", status: "running" }),
      job({ id: "b", status: "running" }),
    ];
    const next = [
      job({ id: "a", status: "exited", exitCode: 0 }),
      job({ id: "b", status: "running" }),
      job({ id: "c", status: "exited", exitCode: 1 }),
    ];
    expect(jobsToNotify(prev, next).map((j) => j.id)).toEqual(["a"]);
    expect(jobsToNotify([], next)).toEqual([]);
    expect(jobsToNotify(next, next)).toEqual([]);
  });
});

describe("jobToastLevel", () => {
  it("maps killed / non-zero / success", () => {
    expect(jobToastLevel(job({ id: "k", status: "killed" }))).toBe("warning");
    expect(jobToastLevel(job({ id: "e", status: "exited", exitCode: 2 }))).toBe(
      "error",
    );
    expect(jobToastLevel(job({ id: "ok", status: "exited", exitCode: 0 }))).toBe(
      "info",
    );
  });
});

describe("collectRunningTaskJobs", () => {
  it("includes in-flight builtin_task only", () => {
    const history = [
      {
        message: { role: "user" as const, content: "go", id: "u" },
        contextItems: [],
      },
      {
        message: {
          role: "assistant" as const,
          content: "",
          id: "a",
          toolCalls: [
            {
              id: "t1",
              type: "function" as const,
              function: { name: BuiltInToolNames.Task, arguments: "{}" },
            },
          ],
        },
        contextItems: [],
        toolCallStates: [
          {
            toolCallId: "t1",
            status: "calling" as const,
            parsedArgs: { prompt: "find auth", profile: "explore" },
            toolCall: {
              id: "t1",
              type: "function" as const,
              function: { name: BuiltInToolNames.Task, arguments: "{}" },
            },
          },
          {
            toolCallId: "t2",
            status: "done" as const,
            parsedArgs: { prompt: "old" },
            toolCall: {
              id: "t2",
              type: "function" as const,
              function: { name: BuiltInToolNames.Task, arguments: "{}" },
            },
          },
        ],
      },
    ];
    const jobs = collectRunningTaskJobs(history as any);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("task:t1");
    expect(jobs[0].title).toBe("find auth");
    expect(jobs[0].detail).toBe("explore");
    expect(isTaskJobId(jobs[0].id)).toBe(true);
  });
});
