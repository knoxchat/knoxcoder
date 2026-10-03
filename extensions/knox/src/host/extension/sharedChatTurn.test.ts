import * as assert from "node:assert";

import type { ChatMessage, ILLM, Tool } from "core";
import type { ChatTurnEvent } from "core/agent/chatTurn";
import { resolveAutonomousToolApproval } from "core/agent/autonomousApproval";
import type { SharedChatTurnInput } from "core/protocol/nativeAgent";

import {
  cancelSharedChatTurn,
  isChatTurnRunning,
  runSharedChatTurn,
  withCompletionOptions,
  type SharedChatTurnDeps,
} from "./sharedChatTurn";

const READ = "builtin_read_file";
const readTool = { function: { name: READ }, readonly: true } as unknown as Tool;

const toolRound = (id: string): ChatMessage[] => [
  {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id,
        type: "function",
        function: { name: READ, arguments: '{"filepath":"a.ts"}' },
      },
    ],
  },
];

function llmOf(rounds: ChatMessage[][]): ILLM {
  let turn = 0;
  return {
    streamChat: async function* () {
      const batch = rounds[Math.min(turn, rounds.length - 1)] ?? [];
      turn += 1;
      for (const chunk of batch) {
        yield chunk;
      }
    },
  } as unknown as ILLM;
}

function makeDeps(rounds: ChatMessage[][], overrides: Partial<SharedChatTurnDeps> = {}) {
  const events: ChatTurnEvent[] = [];
  const toolRequests: Array<Parameters<SharedChatTurnDeps["callTool"]>[0]> = [];
  const checkpoints: string[] = [];
  const deps: SharedChatTurnDeps = {
    buildRequest: async () => ({
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      maxSteps: null,
      atMaxSteps: false,
    }),
    resolveLlm: async () => llmOf(rounds),
    callTool: async (request) => {
      toolRequests.push(request);
      return { contextItems: [{ name: "f", description: "ok", content: "x" }] };
    },
    cancelTools: () => undefined,
    emit: (_sessionId, event) => void events.push(event),
    getPolicy: async () => ({ workspaceDirs: [], doomLoopThreshold: 3 }),
    ensureCheckpoint: async (_s, turnId) => void checkpoints.push(turnId),
    ...overrides,
  };
  return { deps, events, toolRequests, checkpoints };
}

const baseInput = (over: Partial<SharedChatTurnInput> = {}): SharedChatTurnInput => ({
  history: [],
  sessionId: "host-s1",
  includeTools: true,
  modelTitle: "m",
  permissionMode: "fullAuto",
  turnId: "turn-1",
  ...over,
});

suite("K-010 shared chat turn (host runner)", () => {
  test("runs tools through tools/call with the turn context and checkpoints the final reply", async () => {
    const { deps, events, toolRequests, checkpoints } = makeDeps([
      toolRound("c1"),
      [{ role: "assistant", content: "done" }],
    ]);
    const out = await runSharedChatTurn(
      baseInput({ viewReadModelTitle: "vr", realTimeSearchModelTitle: "rt" }),
      deps,
    );
    assert.strictEqual(out.stoppedReason, "completed");
    assert.strictEqual(toolRequests.length, 1);
    assert.strictEqual(toolRequests[0].toolCall.id, "c1");
    assert.strictEqual(toolRequests[0].toolCall.function.name, READ);
    assert.deepStrictEqual(JSON.parse(toolRequests[0].toolCall.function.arguments), {
      filepath: "a.ts",
    });
    assert.strictEqual(toolRequests[0].selectedModelTitle, "m");
    assert.strictEqual(toolRequests[0].viewReadModelTitle, "vr");
    assert.strictEqual(toolRequests[0].realTimeSearchModelTitle, "rt");
    assert.strictEqual(toolRequests[0].sessionId, "host-s1");
    assert.strictEqual(toolRequests[0].turnId, "turn-1");
    // Only the tool-free reply is checkpointed here; mutating tools checkpoint in tools/call.
    assert.deepStrictEqual(checkpoints, ["turn-1"]);
    assert.strictEqual(events[events.length - 1].type, "done");
    assert.strictEqual(isChatTurnRunning("host-s1"), false);
  });

  test("fails clearly when the model cannot be resolved", async () => {
    const { deps } = makeDeps([], { resolveLlm: async () => null });
    await assert.rejects(runSharedChatTurn(baseInput(), deps), /not available/);
    assert.strictEqual(isChatTurnRunning("host-s1"), false);
  });

  test("an unknown permission mode falls back to the default (shell/edit still ask)", async () => {
    const { deps, events } = makeDeps([
      toolRound("c1"),
      [{ role: "assistant", content: "ok" }],
    ]);
    const turn = runSharedChatTurn(
      baseInput({
        permissionMode: "bogus",
        toolSettings: { [READ]: "allowedWithPermission" },
      }),
      deps,
    );
    // Wait for the ask, then allow it.
    for (let i = 0; i < 50 && !events.some((e) => e.type === "tool_ask"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(events.some((e) => e.type === "tool_ask"));
    resolveAutonomousToolApproval({ sessionId: "host-s1", callId: "c1", allow: true });
    assert.strictEqual((await turn).stoppedReason, "completed");
  });

  test("cancel aborts a pending permission card and kills tools", async () => {
    let cancelled = 0;
    const { deps, events, toolRequests } = makeDeps([toolRound("c1")], {
      cancelTools: () => void (cancelled += 1),
    });
    const turn = runSharedChatTurn(
      baseInput({
        permissionMode: "default",
        toolSettings: { [READ]: "allowedWithPermission" },
      }),
      deps,
    );
    for (let i = 0; i < 50 && !events.some((e) => e.type === "tool_ask"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.strictEqual(isChatTurnRunning("host-s1"), true);
    assert.strictEqual(await cancelSharedChatTurn("host-s1", deps), true);
    const out = await turn;
    assert.strictEqual(out.stoppedReason, "aborted");
    assert.strictEqual(toolRequests.length, 0);
    assert.strictEqual(cancelled, 1);
    assert.strictEqual(await cancelSharedChatTurn("host-s1", deps), false);
  });

  test("a tools/call 'cancelled' rejection stops the turn instead of continuing", async () => {
    const { deps } = makeDeps([toolRound("c1"), [{ role: "assistant", content: "x" }]], {
      callTool: async () => {
        throw new Error('Tool "builtin_read_file" cancelled');
      },
    });
    const out = await runSharedChatTurn(baseInput(), deps);
    assert.strictEqual(out.stoppedReason, "aborted");
  });

  test("settled calls from earlier in the turn seed doom-loop detection", async () => {
    const same = {
      name: READ,
      args: { filepath: "a.ts" },
      output: "same",
      ok: true,
    };
    const { deps } = makeDeps([
      toolRound("c1"),
      [{ role: "assistant", content: "stuck, summary" }],
    ]);
    const out = await runSharedChatTurn(
      baseInput({ turnToolCalls: [same, same, same] }),
      deps,
    );
    assert.strictEqual(out.stoppedReason, "doom_loop");
  });

  test("a second turn for the same session replaces the first", async () => {
    const first = makeDeps([toolRound("c1")], {
      resolveLlm: async () => llmOf([toolRound("c1")]),
    });
    const firstTurn = runSharedChatTurn(
      baseInput({
        permissionMode: "default",
        toolSettings: { [READ]: "allowedWithPermission" },
      }),
      first.deps,
    );
    for (let i = 0; i < 50 && !first.events.some((e) => e.type === "tool_ask"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const second = makeDeps([[{ role: "assistant", content: "fresh" }]]);
    const secondOut = await runSharedChatTurn(baseInput(), second.deps);
    assert.strictEqual(secondOut.stoppedReason, "completed");
    assert.strictEqual((await firstTurn).stoppedReason, "aborted");
  });

  test("completion options merge into the loop's streamChat options; the loop's own win", async () => {
    const seen: unknown[] = [];
    const base = {
      model: "m",
      streamChat: async function* (_m: unknown, _s: unknown, options: unknown) {
        seen.push(options);
      },
    } as unknown as ILLM;
    const wrapped = withCompletionOptions(base, { reasoningEffort: "high", webSearch: undefined });
    assert.strictEqual(wrapped.model, "m");
    for await (const _ of wrapped.streamChat([], new AbortController().signal, { tools: [], reasoningEffort: "low" })) {
      void _;
    }
    assert.deepStrictEqual(seen[0], { reasoningEffort: "low", tools: [] });
    for await (const _ of wrapped.streamChat([], new AbortController().signal, { tools: [] })) {
      void _;
    }
    assert.deepStrictEqual(seen[1], { reasoningEffort: "high", tools: [] });
    assert.strictEqual(withCompletionOptions(base, undefined), base);
  });

  test("retryable tool failures back off and retry; other failures do not", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const flaky = makeDeps([toolRound("c1"), [{ role: "assistant", content: "done" }]], {
      sleep: async (ms) => void sleeps.push(ms),
      callTool: async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("execution_timeout");
        }
        return { contextItems: [{ name: "f", description: "ok", content: "x" }] };
      },
    });
    const out = await runSharedChatTurn(baseInput(), flaky.deps);
    assert.strictEqual(out.stoppedReason, "completed");
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(sleeps, [800, 1600]);

    let hard = 0;
    const fatal = makeDeps([toolRound("c1"), [{ role: "assistant", content: "done" }]], {
      sleep: async () => undefined,
      callTool: async () => {
        hard += 1;
        throw new Error("file not found");
      },
    });
    await runSharedChatTurn(baseInput(), fatal.deps);
    assert.strictEqual(hard, 1);
    assert.ok(
      fatal.events.some((e) => e.type === "tool_end" && !e.ok),
    );
  });

  test("steps used before an ask_user answer count against maxSteps", async () => {
    const { deps } = makeDeps([toolRound("c1"), toolRound("c2"), toolRound("c3")], {
      buildRequest: async () => ({
        messages: [{ role: "user", content: "go" }],
        tools: [readTool],
        maxSteps: 3,
        atMaxSteps: false,
      }),
    });
    const out = await runSharedChatTurn(baseInput({ priorSteps: 2 }), deps);
    assert.strictEqual(out.stoppedReason, "max_steps");
    assert.strictEqual(out.steps, 1);
  });

  test("the fallback model takes over after repeated transient stream failures", async () => {
    const retries: number[] = [];
    const failing = {
      streamChat: async function* () {
        throw Object.assign(new Error("overloaded"), { status: 503 });
      },
    } as unknown as ILLM;
    const { deps, events } = makeDeps([], {
      resolveLlm: async () => failing,
      resolveFallbackLlm: async () => llmOf([[{ role: "assistant", content: "from fallback" }]]),
      sleep: async (ms) => void retries.push(ms),
    });
    const out = await runSharedChatTurn(baseInput(), deps);
    assert.strictEqual(out.stoppedReason, "completed");
    assert.ok(retries.length >= 2);
    assert.ok(events.some((e) => e.type === "retry" && e.retry.usingFallback));
  });
});
