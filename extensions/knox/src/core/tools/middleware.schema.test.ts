import { beforeEach, describe, expect, it } from "vitest";

import type { Tool, ToolExtras } from "..";
import { ToolCallError, ToolCallErrorCode } from "./errors";
import {
  executeToolWithMiddleware,
  resetAllCircuitBreakers,
} from "./middleware";

const tool: Tool = {
  type: "function",
  displayTitle: "t",
  readonly: true,
  group: "test",
  function: {
    name: "test_tool",
    description: "A tool used by tests",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
        deep: { type: "boolean" },
      },
    },
  },
};

const extras = {} as ToolExtras;
const quiet = { logging: false, retry: false as const, timeout: false as const, workspaceDirs: [] };

describe("middleware schema handling", () => {
  beforeEach(() => resetAllCircuitBreakers());

  it("hands the implementation coerced arguments", async () => {
    let seen: Record<string, unknown> = {};
    await executeToolWithMiddleware(
      async (_t, args) => {
        seen = args;
        return [];
      },
      tool,
      JSON.stringify({ query: "x", limit: "50", deep: "true", extra: null }),
      extras,
      quiet,
    );
    expect(seen).toMatchObject({ query: "x", limit: 50, deep: true });
  });

  it("rejects values that cannot be coerced with an actionable error", async () => {
    await expect(
      executeToolWithMiddleware(
        async () => [],
        tool,
        { query: "x", limit: "many" },
        extras,
        quiet,
      ),
    ).rejects.toMatchObject({
      code: ToolCallErrorCode.INVALID_ARGUMENTS,
      message: expect.stringMatching(/limit: expected integer, got string "many"/),
    });
  });

  it("never opens the circuit breaker for model input mistakes", async () => {
    const failing = async () => {
      throw new Error("old_string was not found in \"a.ts\".");
    };
    for (let i = 0; i < 8; i++) {
      const error = await executeToolWithMiddleware(
        failing,
        tool,
        { query: "x" },
        extras,
        { ...quiet, circuitBreaker: { failureThreshold: 2 } },
      ).catch((e) => e);
      expect(error).toBeInstanceOf(ToolCallError);
      expect((error as ToolCallError).code).not.toBe(ToolCallErrorCode.CIRCUIT_OPEN);
    }
  });

  it("still opens the breaker for repeated environment failures", async () => {
    const failing = async () => {
      throw new Error("ECONNRESET");
    };
    let last: unknown;
    for (let i = 0; i < 4; i++) {
      last = await executeToolWithMiddleware(
        failing,
        tool,
        { query: "x" },
        extras,
        { ...quiet, circuitBreaker: { failureThreshold: 2 } },
      ).catch((e) => e);
    }
    expect((last as ToolCallError).code).toBe(ToolCallErrorCode.CIRCUIT_OPEN);
  });
});

describe("truncated tool calls", () => {
  const writeTool: Tool = {
    ...tool,
    function: {
      ...tool.function,
      name: "builtin_write_file",
      parameters: {
        type: "object",
        required: ["filepath", "contents"],
        properties: { filepath: { type: "string" }, contents: { type: "string" } },
      },
    },
  };

  it("reports a cut-off call (contents arrived, filepath did not) as InvalidJson, not 'missing parameter'", async () => {
    const raw = '{"contents": "fn main() {}\\n"'; // truncated before filepath and closing brace
    await expect(
      executeToolWithMiddleware(async () => [], writeTool, raw, extras, quiet),
    ).rejects.toMatchObject({
      code: ToolCallErrorCode.ARGUMENT_PARSE_ERROR,
      message: expect.stringMatching(/cut off.*filepath.*Do NOT resend/s),
      context: expect.objectContaining({ truncated: true }),
    });
  });

  it("keeps the plain missing-parameter error for well-formed JSON", async () => {
    await expect(
      executeToolWithMiddleware(async () => [], writeTool, '{"contents":"x"}', extras, quiet),
    ).rejects.toMatchObject({ code: ToolCallErrorCode.MISSING_REQUIRED_PARAM });
  });
});
