/**
 * Stop (cancelSharedChatTurn) while the model is streaming, stalled, retrying,
 * or while a tool runs. Runs without Electron; the mocha suite in
 * sharedChatTurn.test.ts only covers Stop at a permission card.
 */
import { describe, expect, it, vi } from "vitest";

import type { ChatMessage, ILLM, Tool } from "core";
import type { ChatTurnEvent } from "core/agent/chatTurn";
import type { SharedChatTurnInput } from "core/protocol/nativeAgent";

import {
  cancelSharedChatTurn,
  isChatTurnRunning,
  runSharedChatTurn,
  type SharedChatTurnDeps,
} from "./sharedChatTurn";

const READ = "builtin_read_file";
const readTool = { function: { name: READ }, readonly: true } as unknown as Tool;
const toolCallChunk: ChatMessage = {
  role: "assistant",
  content: "",
  toolCalls: [
    { id: "c1", type: "function", function: { name: READ, arguments: '{"filepath":"a.ts"}' } },
  ],
};

const abortError = () => Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await tick();
  expect(cond()).toBe(true);
}

function setup(
  streamChat: (messages: unknown, signal: AbortSignal) => AsyncGenerator<ChatMessage>,
  overrides: Partial<SharedChatTurnDeps> = {},
) {
  const events: ChatTurnEvent[] = [];
  const toolCalls: string[] = [];
  const cancelTools = vi.fn();
  const deps: SharedChatTurnDeps = {
    buildRequest: async () => ({
      messages: [{ role: "user", content: "go" }],
      tools: [readTool],
      maxSteps: null,
      atMaxSteps: false,
    }),
    resolveLlm: async () => ({ streamChat } as unknown as ILLM),
    callTool: async (r) => {
      toolCalls.push(r.toolCall.function.name);
      return { contextItems: [] };
    },
    cancelTools,
    emit: (_s, e) => void events.push(e),
    getPolicy: async () => ({ workspaceDirs: [], doomLoopThreshold: 3 }),
    sleep: async () => undefined,
    ...overrides,
  };
  return { deps, events, toolCalls, cancelTools };
}

const input = (sessionId: string): SharedChatTurnInput => ({
  history: [],
  sessionId,
  includeTools: true,
  modelTitle: "m",
  permissionMode: "fullAuto",
  turnId: "t",
});

/** Fail the test instead of hanging when Stop does not settle the turn. */
const settles = <T>(p: Promise<T>, ms = 1500) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("turn did not settle after Stop")), ms)),
  ]);

describe("Stop during streaming", () => {
  it("mid-stream: ends as aborted, keeps partial text, and runs no tool", async () => {
    const { deps, events, toolCalls } = setup(async function* (_m, signal) {
      yield { role: "assistant", content: "partial " };
      yield { role: "assistant", content: "answer" };
      await new Promise((_, rej) => signal.addEventListener("abort", () => rej(abortError())));
      yield toolCallChunk;
    });
    const turn = runSharedChatTurn(input("s-mid"), deps);
    await until(() => events.length > 0);
    expect(isChatTurnRunning("s-mid")).toBe(true);
    expect(await cancelSharedChatTurn("s-mid", deps)).toBe(true);
    const out = await settles(turn);
    expect(out.stoppedReason).toBe("aborted");
    expect(out.summary).toContain("partial");
    expect(toolCalls).toEqual([]);
    expect(isChatTurnRunning("s-mid")).toBe(false);
  });

  it("before the first chunk (provider honors the signal): aborted, not an error", async () => {
    const { deps } = setup(async function* (_m, signal) {
      await new Promise((_, rej) => signal.addEventListener("abort", () => rej(abortError())));
      yield { role: "assistant", content: "never" };
    });
    const turn = runSharedChatTurn(input("s-stall"), deps);
    await tick(20);
    await cancelSharedChatTurn("s-stall", deps);
    expect((await settles(turn)).stoppedReason).toBe("aborted");
  });

  it("before the first chunk (provider IGNORES the signal): Stop still ends the turn", async () => {
    const { deps } = setup(async function* () {
      await new Promise(() => undefined); // never settles, never looks at the signal
      yield { role: "assistant", content: "never" };
    });
    const turn = runSharedChatTurn(input("s-hang"), deps);
    await tick(20);
    await cancelSharedChatTurn("s-hang", deps);
    expect((await settles(turn)).stoppedReason).toBe("aborted");
    expect(isChatTurnRunning("s-hang")).toBe(false);
  });

  it("while a tool-call round is streaming: the call is not executed", async () => {
    const { deps, toolCalls } = setup(async function* (_m, signal) {
      yield toolCallChunk;
      await new Promise((_, rej) => signal.addEventListener("abort", () => rej(abortError())));
    });
    const turn = runSharedChatTurn(input("s-toolround"), deps);
    await tick(20);
    await cancelSharedChatTurn("s-toolround", deps);
    expect((await settles(turn)).stoppedReason).toBe("aborted");
    expect(toolCalls).toEqual([]);
  });

  it("during retry backoff after a transient stream error: aborted promptly", async () => {
    let calls = 0;
    const { deps, events } = setup(
      async function* () {
        calls += 1;
        throw Object.assign(new Error("fetch failed ECONNRESET"), { status: 503 });
        yield { role: "assistant", content: "" };
      },
      { sleep: undefined },
    );
    // Real backoff sleep (no injected sleep) so Stop must interrupt it.
    delete (deps as { sleep?: unknown }).sleep;
    const turn = runSharedChatTurn(input("s-retry"), deps);
    await until(() => events.some((e) => (e as { type: string }).type === "stream_retry") || calls >= 1);
    await tick(20);
    await cancelSharedChatTurn("s-retry", deps);
    const out = await settles(turn, 3000);
    expect(out.stoppedReason).toBe("aborted");
  });

  it("while a tool is running: cancelTools is called and the turn ends aborted", async () => {
    let release: (() => void) | undefined;
    let n = 0;
    const { deps, cancelTools, toolCalls } = setup(
      async function* () {
        n += 1;
        yield n === 1 ? toolCallChunk : { role: "assistant", content: "done" };
      },
      {
        callTool: async (r) => {
          toolCalls.push(r.toolCall.function.name);
          await new Promise<void>((resolve, reject) => {
            release = resolve;
            // The real tools/call rejects with "cancelled" once cancelTools fires.
            cancelTools.mockImplementation(() => reject(new Error('Tool "builtin_read_file" cancelled')));
          });
          return { contextItems: [] };
        },
      },
    );
    const turn = runSharedChatTurn(input("s-tool"), deps);
    await until(() => toolCalls.length === 1);
    await cancelSharedChatTurn("s-tool", deps);
    const out = await settles(turn);
    expect(out.stoppedReason).toBe("aborted");
    expect(cancelTools).toHaveBeenCalled();
    expect(n).toBe(1); // no further model round after Stop
    release?.();
  });

  it("Stop with nothing running is a no-op that still cancels tools", async () => {
    const { deps, cancelTools } = setup(async function* () {});
    expect(await cancelSharedChatTurn("s-none", deps)).toBe(false);
    expect(cancelTools).toHaveBeenCalledTimes(1);
  });
});
