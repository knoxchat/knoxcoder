import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, Tool, ToolExtras } from "..";

import { BuiltInToolNames } from "../tools/builtIn";
import { ToolCallError, ToolCallErrorCode } from "../tools/errors";
import { collectAssistantTurn, runAgentLoop } from "./loop";
import { setJevClientForTests } from "../jev/client";
import { applyJevConfig } from "../jev/config";

const here = path.dirname(fileURLToPath(import.meta.url));

function extras(chunks: ChatMessage[][]): Pick<ToolExtras, "llm" | "abortSignal"> {
  let turn = 0;
  return {
    llm: {
      streamChat: async function* () {
        const batch = chunks[Math.min(turn, chunks.length - 1)] ?? [];
        turn += 1;
        for (const chunk of batch) {
          yield chunk;
        }
      },
    } as unknown as ToolExtras["llm"],
  };
}

const readTool = {
  function: { name: BuiltInToolNames.ReadFile },
  readonly: true,
} as Tool;

describe("runAgentLoop", () => {
  it("returns a text-only first turn as completed with zero steps", async () => {
    const result = await runAgentLoop({
      extras: extras([
        [{ role: "assistant", content: "src/index.ts is the entry." }],
      ]),
      messages: [{ role: "user", content: "Where is main?" }],
      tools: [readTool],
      compact: false,
      executeTool: vi.fn(),
    });
    expect(result.stoppedReason).toBe("completed");
    expect(result.steps).toBe(0);
    expect(result.summary).toContain("src/index.ts");
  });

  it("executes a tool then summarizes", async () => {
    const executeTool = vi.fn(async () => [
      { name: "file", description: "ok", content: "export const x = 1;" },
    ]);
    const result = await runAgentLoop({
      extras: extras([
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "c1",
                type: "function",
                function: {
                  name: BuiltInToolNames.ReadFile,
                  arguments: '{"filepath":"x.ts"}',
                },
              },
            ],
          },
        ],
        [{ role: "assistant", content: "x.ts exports x." }],
      ]),
      messages: [{ role: "user", content: "Read x.ts" }],
      tools: [readTool],
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.stoppedReason).toBe("completed");
    expect(result.steps).toBe(1);
    expect(result.summary).toContain("exports x");
  });

  it("does not execute further tools at maxSteps", async () => {
    const executeTool = vi.fn(async () => [
      { name: "ok", description: "ok", content: "ok" },
    ]);
    const result = await runAgentLoop({
      extras: extras([
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "1",
                type: "function",
                function: {
                  name: BuiltInToolNames.ReadFile,
                  arguments: '{"filepath":"a.ts"}',
                },
              },
            ],
          },
        ],
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "2",
                type: "function",
                function: {
                  name: BuiltInToolNames.ReadFile,
                  arguments: '{"filepath":"b.ts"}',
                },
              },
            ],
          },
        ],
        [{ role: "assistant", content: "Would have kept going." }],
      ]),
      messages: [{ role: "user", content: "loop" }],
      tools: [readTool],
      maxSteps: 1,
      executeTool,
    });
    expect(result.stoppedReason).toBe("max_steps");
    expect(result.steps).toBe(1);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("aborts on cancelled tool errors", async () => {
    const result = await runAgentLoop({
      extras: extras([
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "1",
                type: "function",
                function: {
                  name: BuiltInToolNames.ReadFile,
                  arguments: "{}",
                },
              },
            ],
          },
        ],
      ]),
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      executeTool: async () => {
        throw new ToolCallError({
          code: ToolCallErrorCode.CANCELLED,
          message: "cancelled",
          toolName: BuiltInToolNames.ReadFile,
          retryable: false,
        });
      },
    });
    expect(result.stoppedReason).toBe("aborted");
  });

  it("aborts mid-stream instead of treating a partial reply as completed", async () => {
    const controller = new AbortController();
    const extrasWithAbort: Pick<ToolExtras, "llm" | "abortSignal"> = {
      abortSignal: controller.signal,
      llm: {
        streamChat: async function* () {
          yield { role: "assistant", content: "partial" };
          controller.abort();
          yield { role: "assistant", content: " should not keep going" };
        },
      } as unknown as ToolExtras["llm"],
    };
    const result = await runAgentLoop({
      extras: extrasWithAbort,
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      compact: false,
      executeTool: vi.fn(),
    });
    expect(result.stoppedReason).toBe("aborted");
    expect(result.summary).toContain("partial");
    expect(result.summary).not.toContain("should not keep going");
  });
});

describe("HL-01 shared loop", () => {
  it("is the only collectAssistantTurn implementation", () => {
    const harness = readFileSync(
      path.resolve(here, "../eval/harness.ts"),
      "utf8",
    );
    const subagent = readFileSync(
      path.resolve(here, "../tools/subagent/runSubagent.ts"),
      "utf8",
    );
    // The native GUI chat loop lives in the workbench, not the extension.
    // It does not call runAgentLoop yet (knox-impl.md K-010), so only assert
    // that it never grows a second collectAssistantTurn.
    const guiLoop = readFileSync(
      path.resolve(
        here,
        "../../../../../src/vs/workbench/contrib/knox/browser/gui/controller/stream.ts",
      ),
      "utf8",
    );
    expect(harness).not.toMatch(/async function collectAssistantTurn/);
    expect(subagent).not.toMatch(/async function collectAssistantTurn/);
    expect(guiLoop).not.toMatch(/function collectAssistantTurn/);
    expect(collectAssistantTurn).toEqual(expect.any(Function));
  });
});

function readCall(id: string, filepath: string): ChatMessage {
  return {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id,
        type: "function",
        function: {
          name: BuiltInToolNames.ReadFile,
          arguments: JSON.stringify({ filepath }),
        },
      },
    ],
  };
}

describe("AgentLoop doom-loop (HL-11)", () => {
  it("stops before the third identical read and does not execute it", async () => {
    const executeTool = vi.fn(async () => [
      { name: "file", description: "ok", content: "ok" },
    ]);
    const result = await runAgentLoop({
      extras: extras([
        [readCall("1", "a.ts")],
        [readCall("2", "a.ts")],
        [readCall("3", "a.ts")],
        [{ role: "assistant", content: "I already read a.ts twice." }],
      ]),
      messages: [{ role: "user", content: "read it" }],
      tools: [readTool],
      compact: false,
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.stoppedReason).toBe("doom_loop");
    expect(result.summary).toMatch(/already read|doom loop|stuck/i);
  });

  it("can be disabled", async () => {
    const executeTool = vi.fn(async () => [
      { name: "file", description: "ok", content: "ok" },
    ]);
    const result = await runAgentLoop({
      extras: extras([
        [readCall("1", "a.ts")],
        [readCall("2", "a.ts")],
        [readCall("3", "a.ts")],
        [{ role: "assistant", content: "Read a.ts three times." }],
      ]),
      messages: [{ role: "user", content: "read it" }],
      tools: [readTool],
      compact: false,
      doomLoopThreshold: null,
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(result.stoppedReason).toBe("completed");
  });
});

const writeTool = {
  function: { name: BuiltInToolNames.EditFile },
  readonly: false,
} as Tool;

const awaitTool = {
  function: { name: BuiltInToolNames.AwaitShell },
  readonly: true,
} as Tool;

function assistantTools(
  calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
): ChatMessage {
  return {
    role: "assistant",
    content: "",
    toolCalls: calls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: JSON.stringify(call.args),
      },
    })),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AgentLoop parallel readonly (HL-01)", () => {
  it("runs consecutive reads concurrently and keeps tool-message order", async () => {
    let active = 0;
    let maxActive = 0;
    const executeTool = vi.fn(async (_tool, args: Record<string, unknown>) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(40);
      active -= 1;
      return [
        {
          name: "file",
          description: "ok",
          content: String(args.filepath),
        },
      ];
    });
    const result = await runAgentLoop({
      extras: extras([
        [
          assistantTools([
            {
              id: "r1",
              name: BuiltInToolNames.ReadFile,
              args: { filepath: "a.c" },
            },
            {
              id: "r2",
              name: BuiltInToolNames.ReadFile,
              args: { filepath: "b.c" },
            },
          ]),
        ],
        [{ role: "assistant", content: "Read both files." }],
      ]),
      messages: [{ role: "user", content: "read them" }],
      tools: [readTool],
      compact: false,
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(2);
    expect(result.stoppedReason).toBe("completed");
    const toolIds = result.messages
      .filter((message) => message.role === "tool")
      .map((message) => message.toolCallId);
    expect(toolIds).toEqual(["r1", "r2"]);
  });

  it("keeps writes sequential even when mixed with reads", async () => {
    let active = 0;
    let maxActive = 0;
    const executeTool = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;
      return [{ name: "ok", description: "ok", content: "ok" }];
    });
    await runAgentLoop({
      extras: extras([
        [
          assistantTools([
            {
              id: "e1",
              name: BuiltInToolNames.EditFile,
              args: { filepath: "a.c", old_string: "x", new_string: "y" },
            },
            {
              id: "r1",
              name: BuiltInToolNames.ReadFile,
              args: { filepath: "a.c" },
            },
          ]),
        ],
        [{ role: "assistant", content: "Edited then read." }],
      ]),
      messages: [{ role: "user", content: "edit" }],
      tools: [readTool, writeTool],
      compact: false,
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it("does not batch await_shell kill with a following read", async () => {
    let active = 0;
    let maxActive = 0;
    const executeTool = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;
      return [{ name: "ok", description: "ok", content: "ok" }];
    });
    await runAgentLoop({
      extras: extras([
        [
          assistantTools([
            {
              id: "k1",
              name: BuiltInToolNames.AwaitShell,
              args: { job_id: "sh_1", kill: true },
            },
            {
              id: "r1",
              name: BuiltInToolNames.ReadFile,
              args: { filepath: "a.c" },
            },
          ]),
        ],
        [{ role: "assistant", content: "Killed then read." }],
      ]),
      messages: [{ role: "user", content: "kill" }],
      tools: [readTool, awaitTool],
      compact: false,
      executeTool,
    });
    expect(maxActive).toBe(1);
  });
});

describe("AgentLoop approveTool", () => {
  it("skips execution when approval is denied", async () => {
    const executeTool = vi.fn(async () => [
      { name: "file", description: "ok", content: "should not run" },
    ]);
    const result = await runAgentLoop({
      extras: extras([
        [
          assistantTools([
            {
              id: "e1",
              name: BuiltInToolNames.EditFile,
              args: { filepath: "a.c", old_string: "x", new_string: "y" },
            },
          ]),
        ],
        [{ role: "assistant", content: "Edit was denied." }],
      ]),
      messages: [{ role: "user", content: "edit" }],
      tools: [writeTool],
      compact: false,
      approveTool: async () => "deny",
      executeTool,
    });
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.stoppedReason).toBe("completed");
    expect(result.messages.some((message) => message.role === "tool")).toBe(
      true,
    );
    const tool = result.messages.find((message) => message.role === "tool");
    expect(String(tool?.content ?? "")).toMatch(/not approved/i);
  });

  it("executes after allow", async () => {
    const executeTool = vi.fn(async () => [
      { name: "file", description: "ok", content: "patched" },
    ]);
    await runAgentLoop({
      extras: extras([
        [
          assistantTools([
            {
              id: "e1",
              name: BuiltInToolNames.EditFile,
              args: { filepath: "a.c", old_string: "x", new_string: "y" },
            },
          ]),
        ],
        [{ role: "assistant", content: "Edited." }],
      ]),
      messages: [{ role: "user", content: "edit" }],
      tools: [writeTool],
      compact: false,
      approveTool: async () => "allow",
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });
});

describe("AgentLoop stream hooks + seeded doom", () => {
  it("forwards chunks and the hydrated assistant", async () => {
    const chunks: string[] = [];
    const onAssistant = vi.fn();
    await runAgentLoop({
      extras: extras([
        [
          { role: "thinking", content: "hmm" } as ChatMessage,
          { role: "assistant", content: "done." },
        ],
      ]),
      messages: [{ role: "user", content: "hi" }],
      tools: [readTool],
      compact: false,
      executeTool: vi.fn(),
      onChunk: (chunk) => {
        chunks.push(`${chunk.role}:${String(chunk.content ?? "")}`);
      },
      onAssistant,
    });
    expect(chunks).toEqual(["thinking:hmm", "assistant:done."]);
    expect(onAssistant).toHaveBeenCalledTimes(1);
    expect(onAssistant.mock.calls[0][0].content).toBe("done.");
  });

  it("summarizes immediately when initial doom calls already hit the cap", async () => {
    const executeTool = vi.fn();
    const result = await runAgentLoop({
      extras: extras([
        [{ role: "assistant", content: "I already grepped that twice." }],
      ]),
      messages: [{ role: "user", content: "search" }],
      tools: [readTool],
      compact: false,
      executeTool,
      initialDoomCalls: [
        { name: BuiltInToolNames.ReadFile, args: { filepath: "a.ts" }, ok: true },
        { name: BuiltInToolNames.ReadFile, args: { filepath: "a.ts" }, ok: true },
        { name: BuiltInToolNames.ReadFile, args: { filepath: "a.ts" }, ok: true },
      ],
    });
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.stoppedReason).toBe("doom_loop");
    expect(result.summary).toMatch(/already grepped|doom loop|stuck/i);
  });

  it("stops paraphrased retries when Jev reports the same failed strategy", async () => {
    setJevClientForTests({
      async systemOne() {
        return {
          model: "jev-1.13.0",
          answers: {
            repeating_failed_strategy: { type: "noul", noul: 0.9 },
            progress_made: { type: "noul", noul: 0.1 },
          },
        };
      },
    });
    applyJevConfig({ enabled: true });
    try {
      const executeTool = vi.fn(async () => [
        { name: "file", description: "ok", content: "hits" },
      ]);
      const result = await runAgentLoop({
        extras: extras([
          [readCall("1", "copy_to_user")],
          [readCall("2", "copy to user")],
          [readCall("3", "copy_from_user")],
          [{ role: "assistant", content: "I already searched those variants." }],
        ]),
        messages: [{ role: "user", content: "find copy_to_user" }],
        tools: [readTool],
        compact: false,
        executeTool,
      });
      expect(executeTool).toHaveBeenCalledTimes(3);
      expect(result.stoppedReason).toBe("doom_loop");
      expect(result.summary).toMatch(/already searched|doom loop|stuck|same failed/i);
    } finally {
      setJevClientForTests(undefined);
      applyJevConfig(undefined);
    }
  });

  it("runs a mutating tool without asking Jev", async () => {
    const systemOne = vi.fn(async () => {
      throw new Error("Jev must not score tool calls");
    });
    setJevClientForTests({ systemOne });
    applyJevConfig({ enabled: true });
    try {
      const executeTool = vi.fn(async () => [
        { name: "file", description: "ok", content: "wrote" },
      ]);
      const result = await runAgentLoop({
        extras: extras([
          [
            assistantTools([
              {
                id: "e1",
                name: BuiltInToolNames.EditFile,
                args: { filepath: "a.c", old_string: "x", new_string: "y" },
              },
            ]),
          ],
          [{ role: "assistant", content: "Edited a.c." }],
        ]),
        messages: [{ role: "user", content: "explain copy_to_user" }],
        tools: [writeTool],
        compact: false,
        permissionMode: "acceptEdits",
        executeTool,
      });
      expect(systemOne).not.toHaveBeenCalled();
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(result.stoppedReason).toBe("completed");
    } finally {
      setJevClientForTests(undefined);
      applyJevConfig(undefined);
    }
  });
});

describe("stream resilience (K-011)", () => {
  const noSleep = { sleep: async () => {}, baseDelayMs: 0 };
  const toolCallChunk = (args: string): ChatMessage => ({
    role: "assistant",
    content: "",
    toolCalls: [
      { index: 0, id: "c1", type: "function", function: { name: BuiltInToolNames.ReadFile, arguments: args } },
    ],
  });

  function flaky(plan: Array<Error | ChatMessage[] | { drop: ChatMessage[]; error: Error }>) {
    let i = 0;
    const calls = { n: 0 };
    return {
      calls,
      extras: {
        llm: {
          streamChat: async function* () {
            const step = plan[Math.min(i, plan.length - 1)];
            i += 1;
            calls.n += 1;
            if (step instanceof Error) {
              throw step;
            }
            if (Array.isArray(step)) {
              yield* step;
              return;
            }
            yield* step.drop;
            throw step.error;
          },
        } as unknown as ToolExtras["llm"],
      },
    };
  }

  it("retries a 429 then succeeds, reporting the retry state", async () => {
    const f = flaky([
      new Error("HTTP 429 Too Many Requests from x\n\nslow down"),
      [{ role: "assistant", content: "ok" }],
    ]);
    const events: number[] = [];
    const a = await collectAssistantTurn(f.extras, [], undefined, {
      retry: noSleep,
      onRetry: (e) => void events.push(e.attempt),
    });
    expect(a.content).toBe("ok");
    expect(f.calls.n).toBe(2);
    expect(events).toEqual([2]);
  });

  it("drops a mid-stream partial tool call and retries the round", async () => {
    const f = flaky([
      { drop: [toolCallChunk('{"filepath":"a.')], error: new Error("socket hang up") },
      [toolCallChunk('{"filepath":"a.ts"}')],
    ]);
    const a = await collectAssistantTurn(f.extras, [], undefined, {
      retry: noSleep,
    });
    expect(a.toolCalls).toHaveLength(1);
    expect(a.toolCalls?.[0].function?.arguments).toBe('{"filepath":"a.ts"}');
  });

  it("does not retry permanent errors", async () => {
    const f = flaky([new Error("HTTP 401 Unauthorized from x")]);
    await expect(
      collectAssistantTurn(f.extras, [], undefined, { retry: noSleep }),
    ).rejects.toThrow(/401/);
    expect(f.calls.n).toBe(1);
  });

  it("gives up after maxAttempts", async () => {
    const f = flaky([new Error("HTTP 503 Service Unavailable")]);
    await expect(
      collectAssistantTurn(f.extras, [], undefined, {
        retry: { ...noSleep, maxAttempts: 3 },
      }),
    ).rejects.toThrow(/503/);
    expect(f.calls.n).toBe(3);
  });

  it("honors Retry-After", async () => {
    const waits: number[] = [];
    const err = Object.assign(new Error("HTTP 429"), {
      response: { status: 429, headers: new Headers({ "retry-after": "7" }) },
    });
    const f = flaky([err, [{ role: "assistant", content: "ok" }]]);
    await collectAssistantTurn(f.extras, [], undefined, {
      retry: { sleep: async (ms) => void waits.push(ms), baseDelayMs: 100 },
    });
    expect(waits).toEqual([7000]);
  });

  it("switches to the fallback model after N failures", async () => {
    const primary = flaky([new Error("HTTP 529 overloaded")]);
    const fallback = flaky([[{ role: "assistant", content: "from fallback" }]]);
    const a = await collectAssistantTurn(primary.extras, [], undefined, {
      retry: { ...noSleep, fallbackAfter: 2 },
      fallbackLlm: fallback.extras.llm,
    });
    expect(a.content).toBe("from fallback");
    expect(primary.calls.n).toBe(2);
  });

  it("runAgentLoop survives a flaky stream", async () => {
    const f = flaky([
      { drop: [{ role: "assistant", content: "par" }], error: new Error("ECONNRESET") },
      [{ role: "assistant", content: "done" }],
    ]);
    const result = await runAgentLoop({
      extras: f.extras,
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      compact: false,
      retry: noSleep,
      executeTool: vi.fn(),
    });
    expect(result.stoppedReason).toBe("completed");
    expect(result.summary).toBe("done");
  });
});
