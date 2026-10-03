import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, Tool, ToolExtras } from "..";

import { BuiltInToolNames } from "../tools/builtIn";
import { resolveAutonomousToolApproval } from "./autonomousApproval";
import {
  HookRunner,
  parseHooksConfig,
  type HookExec,
  type HookExecResult,
} from "../hooks/hooks";
import { runChatTurn, type ChatTurnEvent } from "./chatTurn";

const readTool = {
  function: { name: BuiltInToolNames.ReadFile },
  readonly: true,
} as Tool;

const toolRound = (id: string, args = '{"filepath":"x.ts"}'): ChatMessage[] => [
  {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id,
        type: "function",
        function: { name: BuiltInToolNames.ReadFile, arguments: args },
      },
    ],
  },
];

function extras(
  rounds: ChatMessage[][],
  abortSignal?: AbortSignal,
): Pick<ToolExtras, "llm" | "abortSignal"> {
  let turn = 0;
  return {
    abortSignal,
    llm: {
      streamChat: async function* () {
        const batch = rounds[Math.min(turn, rounds.length - 1)] ?? [];
        turn += 1;
        for (const chunk of batch) {
          yield chunk;
        }
      },
    } as unknown as ToolExtras["llm"],
  };
}

const okOutput = [{ name: "file", description: "ok", content: "x" }];

function collect() {
  const events: ChatTurnEvent[] = [];
  return { events, emit: (e: ChatTurnEvent) => void events.push(e) };
}

const types = (events: ChatTurnEvent[]) => events.map((e) => e.type);

describe("runChatTurn", () => {
  it("emits chunks, assistant, tool start/end, step and done in order", async () => {
    const { events, emit } = collect();
    const result = await runChatTurn({
      sessionId: "s1",
      extras: extras([
        toolRound("c1"),
        [{ role: "assistant", content: "done" }],
      ]),
      messages: [{ role: "user", content: "read" }],
      tools: [readTool],
      compact: false,
      emit,
      executeTool: async () => okOutput,
    });

    expect(result.stoppedReason).toBe("completed");
    expect(types(events)).toEqual([
      "chunk",
      "assistant",
      "tool_start",
      "tool_end",
      "step",
      "chunk",
      "assistant",
      "done",
    ]);
    const end = events.find((e) => e.type === "tool_end");
    expect(end).toMatchObject({ callId: "c1", ok: true });
  });

  it("calls beforeTools between assistant and tool execution, and survives its errors", async () => {
    const order: string[] = [];
    const { emit } = collect();
    await runChatTurn({
      sessionId: "s1",
      extras: extras([toolRound("c1"), [{ role: "assistant", content: "ok" }]]),
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      compact: false,
      emit,
      beforeTools: () => {
        order.push("checkpoint");
        throw new Error("disk full");
      },
      executeTool: async () => {
        order.push("tool");
        return okOutput;
      },
    });
    // Fires per assistant message: the tool round, then the final text round.
    expect(order).toEqual(["checkpoint", "tool", "checkpoint"]);
  });

  it("auto-approves without asking when the mode allows it", async () => {
    const { events, emit } = collect();
    const executeTool = vi.fn(async () => okOutput);
    await runChatTurn({
      sessionId: "s1",
      extras: extras([toolRound("c1"), [{ role: "assistant", content: "ok" }]]),
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      compact: false,
      emit,
      executeTool,
      permission: {
        mode: "fullAuto",
        toolSettings: {},
        sessionAllowlist: [],
      },
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(types(events)).not.toContain("tool_ask");
  });

  it("waits for the GUI card, then runs on allow and remembers 'always'", async () => {
    const sessionAllowlist: string[] = [];
    const executeTool = vi.fn(async () => okOutput);
    const events: ChatTurnEvent[] = [];
    const turn = runChatTurn({
      sessionId: "s-ask",
      extras: extras([toolRound("c1"), [{ role: "assistant", content: "ok" }]]),
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      compact: false,
      executeTool,
      emit: (e) => {
        events.push(e);
        if (e.type === "tool_ask") {
          // The GUI resolves the card on a later tick.
          setTimeout(
            () =>
              resolveAutonomousToolApproval({
                sessionId: "s-ask",
                callId: e.callId,
                allow: true,
                always: true,
              }),
            0,
          );
        }
      },
      permission: {
        mode: "default",
        toolSettings: { [BuiltInToolNames.ReadFile]: "allowedWithPermission" },
        sessionAllowlist,
      },
    });
    const result = await turn;
    expect(result.stoppedReason).toBe("completed");
    expect(events.find((e) => e.type === "tool_ask")).toMatchObject({
      callId: "c1",
      name: BuiltInToolNames.ReadFile,
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(sessionAllowlist).toContain(BuiltInToolNames.ReadFile);
  });

  it("does not run a denied tool and reports a permission-denied result to the model", async () => {
    const executeTool = vi.fn(async () => okOutput);
    const messages: ChatMessage[] = [{ role: "user", content: "go" }];
    await runChatTurn({
      sessionId: "s-deny",
      extras: extras([toolRound("c1"), [{ role: "assistant", content: "ok" }]]),
      messages,
      tools: [readTool],
      compact: false,
      executeTool,
      emit: (e) => {
        if (e.type === "tool_ask") {
          setTimeout(
            () =>
              resolveAutonomousToolApproval({
                sessionId: "s-deny",
                callId: e.callId,
                allow: false,
              }),
            0,
          );
        }
      },
      permission: {
        mode: "default",
        toolSettings: { [BuiltInToolNames.ReadFile]: "allowedWithPermission" },
        sessionAllowlist: [],
      },
    });
    expect(executeTool).not.toHaveBeenCalled();
    expect(
      messages.some(
        (m) => m.role === "tool" && String(m.content).includes("not approved"),
      ),
    ).toBe(true);
  });

  it("cancel while waiting on a permission card stops the turn as aborted", async () => {
    const controller = new AbortController();
    const executeTool = vi.fn(async () => okOutput);
    const result = await runChatTurn({
      sessionId: "s-cancel",
      extras: extras([toolRound("c1")], controller.signal),
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      compact: false,
      executeTool,
      emit: (e) => {
        if (e.type === "tool_ask") {
          setTimeout(() => controller.abort(), 0);
        }
      },
      permission: {
        mode: "default",
        toolSettings: { [BuiltInToolNames.ReadFile]: "allowedWithPermission" },
        sessionAllowlist: [],
      },
    });
    expect(result.stoppedReason).toBe("aborted");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("reports a failing tool as tool_end ok:false and keeps going", async () => {
    const { events, emit } = collect();
    const result = await runChatTurn({
      sessionId: "s1",
      extras: extras([toolRound("c1"), [{ role: "assistant", content: "ok" }]]),
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      compact: false,
      emit,
      executeTool: async () => {
        throw new Error("boom");
      },
    });
    expect(result.stoppedReason).toBe("completed");
    expect(events.find((e) => e.type === "tool_end")).toMatchObject({
      ok: false,
      error: "boom",
    });
  });

  it("seeds doom-loop history so a resumed turn stops on repeats", async () => {
    const same = {
      name: BuiltInToolNames.ReadFile,
      args: { filepath: "x.ts" },
      output: "same",
      ok: true,
    };
    const result = await runChatTurn({
      sessionId: "s1",
      extras: extras([
        toolRound("c1"),
        [{ role: "assistant", content: "I am stuck, summary." }],
      ]),
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      compact: false,
      doomLoopThreshold: 3,
      initialDoomCalls: [same, same, same],
      emit: () => undefined,
      executeTool: async () => okOutput,
    });
    expect(result.stoppedReason).toBe("doom_loop");
  });

  it("assigns stable ids to calls the model sent without one, before any event", async () => {
    const { events, emit } = collect();
    const messages: ChatMessage[] = [{ role: "user", content: "go" }];
    await runChatTurn({
      sessionId: "s1",
      extras: extras([
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                type: "function",
                function: {
                  name: BuiltInToolNames.ReadFile,
                  arguments: '{"filepath":"x.ts"}',
                },
              },
            ],
          },
        ],
        [{ role: "assistant", content: "ok" }],
      ]),
      messages,
      tools: [readTool],
      compact: false,
      emit,
      executeTool: async () => okOutput,
    });
    const assistant = events.find((e) => e.type === "assistant");
    const id = assistant?.type === "assistant" ? assistant.toolCalls[0].id : "";
    expect(id).toBeTruthy();
    expect(events.find((e) => e.type === "tool_start")).toMatchObject({ callId: id });
    const toolMessage = messages.find((m) => m.role === "tool");
    expect(toolMessage).toMatchObject({ toolCallId: id });
    const assistantMessage = messages.find((m) => m.role === "assistant");
    expect(
      assistantMessage && "toolCalls" in assistantMessage
        ? assistantMessage.toolCalls?.[0].id
        : undefined,
    ).toBe(id);
  });

  it("ends the turn at ask_user with an awaitsUser ask", async () => {
    const { events, emit } = collect();
    const askTool = {
      function: { name: BuiltInToolNames.AskUser },
    } as Tool;
    const executeTool = vi.fn(async () => okOutput);
    const result = await runChatTurn({
      sessionId: "s1",
      extras: extras([
        [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "q1",
                type: "function",
                function: { name: BuiltInToolNames.AskUser, arguments: "{}" },
              },
            ],
          },
        ],
      ]),
      messages: [{ role: "user", content: "go" }],
      tools: [askTool],
      compact: false,
      emit,
      executeTool,
      permission: { mode: "fullAuto", toolSettings: {}, sessionAllowlist: [] },
    });
    expect(result.stoppedReason).toBe("aborted");
    expect(executeTool).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "tool_ask")).toMatchObject({
      callId: "q1",
      awaitsUser: true,
    });
  });

  it("surfaces retry events from a flaky stream", async () => {
    let attempt = 0;
    const { events, emit } = collect();
    const llm = {
      streamChat: async function* () {
        attempt += 1;
        if (attempt === 1) {
          yield { role: "assistant", content: "partial" } as ChatMessage;
          throw Object.assign(new Error("overloaded"), {
            response: { status: 529, headers: new Headers() },
          });
        }
        yield { role: "assistant", content: "full answer" } as ChatMessage;
      },
    } as unknown as ToolExtras["llm"];
    const result = await runChatTurn({
      sessionId: "s1",
      extras: { llm },
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      compact: false,
      retry: { sleep: async () => undefined, baseDelayMs: 1 },
      emit,
      executeTool: async () => okOutput,
    });
    expect(result.stoppedReason).toBe("completed");
    const retry = events.find((e) => e.type === "retry");
    expect(retry).toMatchObject({ retry: { attempt: 2, discardedPartial: true } });
  });

  it("loads a deferred tool through builtin_tool_search, then runs it", async () => {
    const { events, emit } = collect();
    const gitLog = {
      type: "function",
      readonly: true,
      function: { name: BuiltInToolNames.GitLog, description: "Show git log." },
    } as unknown as Tool;
    const search = {
      type: "function",
      readonly: true,
      function: { name: BuiltInToolNames.ToolSearch, description: "search" },
    } as unknown as Tool;
    const tools = [readTool, search];
    const executed: string[] = [];
    const round = (id: string, name: string, args: string): ChatMessage[] => [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id, type: "function", function: { name, arguments: args } }],
      },
    ];
    const result = await runChatTurn({
      sessionId: "s",
      extras: extras([
        round("1", BuiltInToolNames.GitLog, "{}"),
        round("2", BuiltInToolNames.ToolSearch, '{"names":["git_log"]}'),
        round("3", BuiltInToolNames.GitLog, "{}"),
        [{ role: "assistant", content: "done" }],
      ]),
      messages: [{ role: "user", content: "history?" }],
      tools,
      deferredTools: [gitLog],
      compact: false,
      emit,
      executeTool: async (tool) => {
        executed.push(tool.function.name);
        return okOutput;
      },
    });
    expect(result.stoppedReason).toBe("completed");
    // Round 1 hit a not-yet-loaded tool and got the hint; search is handled in-loop.
    expect(executed).toEqual([BuiltInToolNames.GitLog]);
    expect(tools.map((x) => x.function.name)).toContain(BuiltInToolNames.GitLog);
    const hint = result.messages.find(
      (m) => m.role === "tool" && String(m.content).includes("not loaded yet"),
    );
    expect(hint).toBeTruthy();
  });
});

describe("runChatTurn hooks (K-023)", () => {
  const runner = (config: Parameters<typeof parseHooksConfig>[0], exec: HookExec) =>
    new HookRunner(parseHooksConfig(config), { exec });
  const ok = (stdout = ""): HookExecResult => ({
    code: 0,
    stdout,
    stderr: "",
    timedOut: false,
  });

  it("UserPromptSubmit deny ends the turn without calling the model", async () => {
    const { events, emit } = collect();
    const messages: ChatMessage[] = [{ role: "user", content: "rm all" }];
    const llm = extras([[{ role: "assistant", content: "hi" }]]);
    const spy = vi.spyOn(llm.llm, "streamChat");
    const result = await runChatTurn({
      sessionId: "s1",
      extras: llm,
      messages,
      tools: [readTool],
      compact: false,
      emit,
      hooks: runner(
        { UserPromptSubmit: [{ command: "guard" }] },
        async () => ({ code: 2, stdout: "", stderr: "no way", timedOut: false }),
      ),
      executeTool: async () => okOutput,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.stoppedReason).toBe("aborted");
    expect(result.summary).toContain("no way");
    expect(types(events)).toEqual(["done"]);
  });

  it("adds SessionStart and UserPromptSubmit context to the last user message", async () => {
    const { emit } = collect();
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
    await runChatTurn({
      sessionId: "s1",
      extras: extras([[{ role: "assistant", content: "hi" }]]),
      messages,
      tools: [readTool],
      compact: false,
      emit,
      sessionStart: true,
      hooks: runner(
        {
          SessionStart: [{ command: "a" }],
          UserPromptSubmit: [{ command: "b" }],
        },
        async (command) => ok(command === "a" ? "branch: main" : "ticket: K-1"),
      ),
      executeTool: async () => okOutput,
    });
    const content = String(messages[0].content);
    expect(content.startsWith("hello")).toBe(true);
    expect(content).toContain("branch: main");
    expect(content.indexOf("branch: main")).toBeLessThan(content.indexOf("ticket: K-1"));
  });

  it("skips SessionStart on later turns and runs Stop after the loop", async () => {
    const { emit } = collect();
    const seen: string[] = [];
    await runChatTurn({
      sessionId: "s1",
      extras: extras([[{ role: "assistant", content: "bye" }]]),
      messages: [{ role: "user", content: "x" }],
      tools: [readTool],
      compact: false,
      emit,
      hooks: runner(
        { SessionStart: [{ command: "s" }], Stop: [{ command: "t" }] },
        async (_c, stdin) => {
          seen.push(JSON.parse(stdin).event);
          return ok();
        },
      ),
      executeTool: async () => okOutput,
    });
    expect(seen).toEqual(["Stop"]);
  });
});
