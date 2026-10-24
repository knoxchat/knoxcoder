import { afterEach, describe, expect, it, vi } from "vitest";

import { executeToolWithMiddleware } from "./middleware";

const tool: any = {
  type: "function",
  displayTitle: "t",
  function: {
    name: "builtin_read_file",
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: { filepath: { type: "string" } },
    },
  },
};
const extras: any = { ide: { getWorkspaceDirs: async () => [] } };
const quiet = {
  retry: false as const,
  timeout: false as const,
  circuitBreaker: false as const,
  workspaceDirs: [] as string[],
};

describe("middleware tool-call logging", () => {
  const prevLevel = process.env.KNOX_LOG_LEVEL;

  afterEach(() => {
    if (prevLevel === undefined) delete process.env.KNOX_LOG_LEVEL;
    else process.env.KNOX_LOG_LEVEL = prevLevel;
    vi.restoreAllMocks();
  });

  it("does not console.log routine success (DevTools noise)", async () => {
    process.env.KNOX_LOG_LEVEL = "info";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await executeToolWithMiddleware(
      async () => [{ name: "glob", description: "ok", content: "a.ts" }],
      tool,
      { filepath: "a.ts" },
      extras,
      { ...quiet, logging: true },
    );
    expect(log.mock.calls.some((call) => String(call[0]).includes("succeeded"))).toBe(
      false,
    );
  });

  it("writes success at debug when KNOX_LOG_LEVEL=debug", async () => {
    process.env.KNOX_LOG_LEVEL = "debug";
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    await executeToolWithMiddleware(
      async () => [{ name: "glob", description: "ok", content: "a.ts" }],
      tool,
      { filepath: "a.ts" },
      extras,
      { ...quiet, logging: true },
    );
    expect(
      debug.mock.calls.some((call) => String(call[0]).includes("succeeded")),
    ).toBe(true);
  });
});
