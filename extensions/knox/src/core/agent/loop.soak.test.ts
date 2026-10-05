/**
 * P1-5 soak: 1000 agent turns in one session with a scripted model.
 *
 * Each turn runs the real `runAgentLoop` (tool call, tool result, final text) with the default
 * compactor, so this exercises message growth, compaction and per-turn bookkeeping. It checks
 * two things that a leak would break:
 *   - the history stays bounded (compaction works over a long session);
 *   - retained heap after a forced GC does not keep growing once warmed up.
 *
 * Heap numbers are noisy, so the budget is loose (a real per-turn leak of even 30 KB shows up
 * as 30 MB over the measured window). Set KNOX_SOAK_TURNS to run a longer soak by hand.
 */
import v8 from "node:v8";
import vm from "node:vm";

import { describe, expect, it } from "vitest";
import type { ChatMessage, Tool, ToolExtras } from "..";

import { BuiltInToolNames } from "../tools/builtIn";
import { runAgentLoop } from "./loop";

const TURNS = Number(process.env.KNOX_SOAK_TURNS) || 1000;
const WARMUP_TURNS = Math.floor(TURNS / 5);
const SAMPLE_EVERY = Math.max(1, Math.floor(TURNS / 10));
const HEAP_GROWTH_BUDGET_MB = 25;

v8.setFlagsFromString("--expose-gc");
const forceGc: () => void = vm.runInNewContext("gc");

function heapMb(): number {
  forceGc();
  forceGc();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

const readTool = {
  function: { name: BuiltInToolNames.ReadFile },
  readonly: true,
} as Tool;

/** Model that alternates: tool call, then final text, for every user turn. */
function scriptedLlm(): ToolExtras["llm"] {
  let call = 0;
  return {
    model: "soak-mock",
    contextLength: 32_000,
    completionOptions: { maxTokens: 2_000 },
    streamChat: async function* (messages: ChatMessage[]) {
      const last = messages[messages.length - 1];
      call += 1;
      if (last?.role === "user") {
        yield {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: `c${call}`,
              type: "function",
              function: {
                name: BuiltInToolNames.ReadFile,
                arguments: JSON.stringify({ filepath: `src/file${call % 50}.ts` }),
              },
            },
          ],
        } as ChatMessage;
      } else {
        yield { role: "assistant", content: `Done with step ${call}.` } as ChatMessage;
      }
    },
  } as unknown as ToolExtras["llm"];
}

describe("agent loop soak (P1-5)", () => {
  it(
    `survives ${TURNS} turns with bounded history and flat heap`,
    async () => {
      const llm = scriptedLlm();
      const messages: ChatMessage[] = [];
      const samples: Array<{ turn: number; heap: number; messages: number }> = [];
      let maxMessages = 0;
      let baseline = 0;

      for (let turn = 1; turn <= TURNS; turn++) {
        messages.push({
          role: "user",
          content: `Turn ${turn}: please inspect the module and report. ${"context ".repeat(20)}`,
        });
        const result = await runAgentLoop({
          extras: { llm },
          messages,
          tools: [readTool],
          executeTool: async () => [
            {
              name: "file",
              description: "ok",
              // ~4 KB of fresh text per call, so compaction has real work to do.
              content: `// turn ${turn}\n${"export const value = 1;\n".repeat(170)}`,
            },
          ],
        });
        expect(result.stoppedReason).toBe("completed");

        // The loop mutates `messages` in place, but compaction may hand back a shorter array
        // through `result.messages`; carry that forward the way the chat host does.
        if (result.messages !== messages) {
          messages.length = 0;
          messages.push(...result.messages);
        }
        maxMessages = Math.max(maxMessages, messages.length);

        if (turn === WARMUP_TURNS) baseline = heapMb();
        if (turn % SAMPLE_EVERY === 0) {
          samples.push({ turn, heap: heapMb(), messages: messages.length });
        }
      }

      const growth = samples[samples.length - 1].heap - baseline;
      console.log(
        "[soak]",
        JSON.stringify({ turns: TURNS, baselineMb: +baseline.toFixed(1), growthMb: +growth.toFixed(1), maxMessages, samples }),
      );

      // 4 messages per turn if nothing were ever dropped.
      expect(maxMessages).toBeLessThan(TURNS * 4 * 0.25);
      expect(growth).toBeLessThan(HEAP_GROWTH_BUDGET_MB);
    },
    120_000,
  );
});
