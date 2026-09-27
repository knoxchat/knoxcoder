import { describe, expect, it, vi } from "vitest";

import type { Tool, ToolExtras } from "../..";
import { BuiltInToolNames } from "../builtIn";
import { allTools } from "../index";
import { selectAgentTools } from "../catalog";
import { MAX_PARALLEL_EXPLORES, resetSubagentJobs } from "./jobs";
import {
  resolveSubagentMaxSteps,
  SYSTEMS_SUBAGENT_ABSOLUTE_CAP,
  SYSTEMS_SUBAGENT_MAX_STEPS,
  toolsForSubagentProfile,
} from "./profiles";
import { runSubagent } from "./runSubagent";

const catalog: Tool[] = [
  {
    type: "function",
    function: { name: BuiltInToolNames.ReadFile },
    displayTitle: "read",
    readonly: true,
    group: "g",
  },
];

function extras(delayMs = 0): ToolExtras {
  return {
    ide: {
      getWorkspaceDirs: async () => [],
    } as ToolExtras["ide"],
    llm: {
      streamChat: async function* () {
        if (delayMs) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        yield { role: "assistant" as const, content: "done" };
      },
    } as ToolExtras["llm"],
    fetch: vi.fn(),
    tool: { function: { name: BuiltInToolNames.Task } } as ToolExtras["tool"],
  };
}

describe("subagent systems budgets (HL-37)", () => {
  it("keeps default explore at 12 / cap 40", () => {
    expect(resolveSubagentMaxSteps("explore", undefined)).toBe(12);
    expect(resolveSubagentMaxSteps("general", 99)).toBe(40);
  });

  it("raises systems explore/general and cap 200", () => {
    expect(resolveSubagentMaxSteps("explore", undefined, { systems: true })).toBe(
      SYSTEMS_SUBAGENT_MAX_STEPS.explore,
    );
    expect(resolveSubagentMaxSteps("general", undefined, { systems: true })).toBe(
      80,
    );
    expect(resolveSubagentMaxSteps("general", 500, { systems: true })).toBe(
      SYSTEMS_SUBAGENT_ABSOLUTE_CAP,
    );
  });

  it("general children keep builtin_debug; explore stays read-only", () => {
    const catalog = selectAgentTools(allTools, { systems: true });
    const general = toolsForSubagentProfile("general", catalog);
    const explore = toolsForSubagentProfile("explore", catalog);
    expect(
      catalog.some((tool) => tool.function.name === BuiltInToolNames.Debug),
    ).toBe(true);
    expect(
      general.some((tool) => tool.function.name === BuiltInToolNames.Debug),
    ).toBe(true);
    expect(
      explore.some((tool) => tool.function.name === BuiltInToolNames.Debug),
    ).toBe(false);
  });
});

describe("parallel explore (HL-36)", () => {
  it("runs two explores concurrently", async () => {
    resetSubagentJobs();
    let inFlight = 0;
    let maxInFlight = 0;
    const delayedExtras = (): ToolExtras => ({
      ...extras(0),
      llm: {
        streamChat: async function* () {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 40));
          inFlight -= 1;
          yield { role: "assistant" as const, content: "done" };
        },
      } as ToolExtras["llm"],
    });
    const run = (prompt: string) =>
      runSubagent({
        prompt,
        profile: "explore",
        extras: delayedExtras(),
        catalog,
        executeTool: async () => [{ name: "r", description: "", content: prompt }],
      });

    const [a, b] = await Promise.all([run("search mm/"), run("search fs/")]);
    expect(a.stoppedReason).toBe("completed");
    expect(b.stoppedReason).toBe("completed");
    expect(maxInFlight).toBe(2);
    expect(MAX_PARALLEL_EXPLORES).toBe(3);
  });
});
