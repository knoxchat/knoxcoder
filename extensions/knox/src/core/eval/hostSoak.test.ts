/**
 * K-101: 1000-turn **host** soak on the product path.
 *
 * Unlike `agent/loop.soak.test.ts` (engine only), this drives `runChatTurn` →
 * `callTool` (tools/call implementation) → turn checkpoints, folds
 * `ChatTurnEvent`s the way the GUI renderer does, and caps session JSON (K-043).
 * Fail on leak / unbounded session JSON. Set KNOX_HOST_SOAK_TURNS to run longer.
 */
import v8 from "node:v8";
import vm from "node:vm";

import { describe, expect, it } from "vitest";
import type { ChatHistoryItem, ChatMessage, Session, Tool, ToolExtras } from "..";

import { runChatTurn, type ChatTurnEvent } from "../agent/chatTurn";
import { BuiltInToolNames } from "../tools/builtIn";
import { callTool } from "../tools/callTool";
import { withIdePorts } from "../tools/toolPorts";
import { executeToolWithSoulHooks } from "../tools/mutatingToolHooks";
import { readFileTool, writeFileTool } from "../tools";
import { capSessionForStorage, STORED_SESSION_MAX_BYTES } from "../util/sessionSizeCap";
import { createEvalIde } from "./harness";

const TURNS = Number(process.env.KNOX_HOST_SOAK_TURNS) || 1000;
const WARMUP_TURNS = Math.floor(TURNS / 5);
const SAMPLE_EVERY = Math.max(1, Math.floor(TURNS / 10));
const HEAP_GROWTH_BUDGET_MB = 30;

v8.setFlagsFromString("--expose-gc");
const forceGc: () => void = vm.runInNewContext("gc");

function heapMb(): number {
  forceGc();
  forceGc();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

type HeadlessGui = {
  text: string;
  tools: number;
  done: number;
  assistants: number;
  steps: number;
};

/** Fold the same ChatTurnEvent kinds the GUI renderer consumes in sharedTurn.ts. */
function foldChatTurnEvent(gui: HeadlessGui, event: ChatTurnEvent): void {
  switch (event.type) {
    case "chunk": {
      const content = event.chunk.content;
      if (typeof content === "string") {
        gui.text += content;
      }
      return;
    }
    case "assistant":
      gui.assistants += 1;
      return;
    case "tool_start":
      gui.tools += 1;
      return;
    case "step":
      gui.steps += 1;
      return;
    case "done":
      gui.done += 1;
      return;
    default:
      return;
  }
}

function scriptedLlm(): ToolExtras["llm"] {
  let users = 0;
  let call = 0;
  return {
    model: "host-soak-mock",
    contextLength: 32_000,
    completionOptions: { maxTokens: 2_000 },
    streamChat: async function* (messages: ChatMessage[]) {
      const last = messages[messages.length - 1];
      call += 1;
      if (last?.role === "user") {
        users += 1;
        const write = users % 2 === 0;
        yield {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: `c${call}`,
              type: "function",
              function: {
                name: write ? BuiltInToolNames.WriteFile : BuiltInToolNames.ReadFile,
                arguments: JSON.stringify(
                  write
                    ? {
                        filepath: `src/file${users % 40}.ts`,
                        contents: `export const n = ${users};\n`,
                      }
                    : { filepath: `src/file${users % 40}.ts` },
                ),
              },
            },
          ],
        } as ChatMessage;
      } else {
        yield { role: "assistant", content: `Done with step ${users}.` } as ChatMessage;
      }
    },
  } as unknown as ToolExtras["llm"];
}

describe("host soak (K-101)", () => {
  it(
    `survives ${TURNS} chat turns through tools/call, checkpoints, and event render`,
    async () => {
      const { ide, checkpoints } = createEvalIde({
        "src/file0.ts": "export const n = 0;\n",
      });
      const llm = scriptedLlm();
      const extras: ToolExtras = {
        ...withIdePorts(ide),
        llm,
        fetch: (async () => new Response()) as ToolExtras["fetch"],
        tool: readFileTool,
        soul: { sessionId: "host-soak" },
      };
      const tools: Tool[] = [readFileTool, writeFileTool];
      const messages: ChatMessage[] = [];
      const session: Session = {
        sessionId: "host-soak",
        title: "host soak",
        workspaceDirectory: "/tmp/knox-eval-ws",
        history: [],
      };
      const samples: Array<{ turn: number; heap: number; bytes: number }> = [];
      let baseline = 0;
      let maxBytes = 0;
      let toolsSeen = 0;
      let doneSeen = 0;

      for (let turn = 1; turn <= TURNS; turn++) {
        messages.push({
          role: "user",
          content: `Turn ${turn}: inspect or edit a module. ${"context ".repeat(12)}`,
        });
        const gui: HeadlessGui = { text: "", tools: 0, done: 0, assistants: 0, steps: 0 };
        const result = await runChatTurn({
          sessionId: "host-soak",
          extras,
          messages,
          tools,
          emit: (event) => foldChatTurnEvent(gui, event),
          executeTool: async (tool, args) =>
            executeToolWithSoulHooks({
              tool,
              toolName: tool.function.name,
              rawArgs: args,
              ide,
              sessionId: "host-soak",
              turnId: `t${turn}`,
              execute: () =>
                callTool(
                  tool,
                  args,
                  { ...extras, tool },
                  {
                    retry: false,
                    timeout: false,
                    circuitBreaker: false,
                    logging: false,
                  },
                ),
            }),
        });
        expect(result.stoppedReason).toBe("completed");
        toolsSeen += gui.tools;
        doneSeen += gui.done;
        session.history.push(
          {
            message: messages[messages.length - 1],
            contextItems: [],
          } as ChatHistoryItem,
          {
            message: { role: "assistant", content: gui.text || result.summary },
            contextItems: [],
          } as ChatHistoryItem,
        );
        const capped = capSessionForStorage(session);
        if (capped.session !== session) {
          session.history = capped.session.history;
        }
        maxBytes = Math.max(maxBytes, capped.bytes);
        expect(capped.bytes).toBeLessThanOrEqual(STORED_SESSION_MAX_BYTES);

        if (turn === WARMUP_TURNS) baseline = heapMb();
        if (turn % SAMPLE_EVERY === 0) {
          samples.push({ turn, heap: heapMb(), bytes: capped.bytes });
        }
      }

      const growth = samples[samples.length - 1].heap - baseline;
      console.log(
        "[host-soak]",
        JSON.stringify({
          turns: TURNS,
          baselineMb: +baseline.toFixed(1),
          growthMb: +growth.toFixed(1),
          maxBytes,
          checkpoints: checkpoints.length,
          toolsSeen,
          doneSeen,
          samples,
        }),
      );

      expect(doneSeen).toBe(TURNS);
      expect(toolsSeen).toBeGreaterThan(0);
      expect(checkpoints.length).toBeGreaterThan(0);
      expect(maxBytes).toBeLessThanOrEqual(STORED_SESSION_MAX_BYTES);
      expect(growth).toBeLessThan(HEAP_GROWTH_BUDGET_MB);
    },
    180_000,
  );
});
