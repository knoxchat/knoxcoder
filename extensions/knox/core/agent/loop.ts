/**
 * Shared Agent tool loop (HL-01).
 *
 * Eval, subagents, and `/autonomous` call this instead of each reimplementing
 * stream → parse tools → execute → append → repeat. GUI Agent chat stays the
 * product UI (permission prompts on Agent chat and `/autonomous`) and uses the
 * same readonly-batch, doom-loop, and auto-approve rules via `toolBatch.ts`,
 * `doomLoop.ts`, and `permissions.ts`. GUI Agent chat also calls this runtime
 * with stream/permission adapters (`onChunk`, `approveTool`).
 */

import type {
  AssistantChatMessage,
  ChatMessage,
  ContextItem,
  PromptLog,
  Tool,
  ToolCallDelta,
  ToolExtras,
} from "..";
import { compactMessages } from "../compaction/index";
import { DEFAULT_DOOM_LOOP_THRESHOLD } from "../config/agentProfile";
import { hydrateAssistantTextToolCalls } from "../llm/parseTextToolCalls";
import { parseBuildOutput } from "../tools/build/parseDiagnostics";
import { ToolCallError, ToolCallErrorCode } from "../tools/errors";
import { renderChatMessage, renderContextItems } from "../util/messageContent";

import {
  buildDoomLoopBlockedMessage,
  buildDoomLoopSummaryInstruction,
  detectDoomLoop,
  type DoomLoopCall,
  type DoomLoopHit,
} from "./doomLoop";
import { canRunToolInParallel } from "./toolBatch";

export type AgentLoopStoppedReason =
  | "completed"
  | "max_steps"
  | "aborted"
  | "error"
  | "doom_loop";

export interface AgentLoopToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  rawArguments?: string;
}

export interface AgentLoopToolResult {
  name: string;
  args: Record<string, unknown>;
  output: ContextItem[];
  ok: boolean;
  error?: string;
}

export interface AgentLoopStep {
  assistant: AssistantChatMessage;
  toolCalls: AgentLoopToolCall[];
  results: AgentLoopToolResult[];
}

export interface AgentLoopResult {
  stoppedReason: AgentLoopStoppedReason;
  steps: number;
  summary: string;
  messages: ChatMessage[];
}

export interface AgentLoopOptions {
  extras: Pick<ToolExtras, "llm" | "abortSignal">;
  /** Mutated in place (assistant + tool messages appended). */
  messages: ChatMessage[];
  tools: Tool[];
  /**
   * Cap tool→continue rounds. `null` / omit = unlimited.
   * At the cap, one text-only stream is requested and tools are not executed.
   */
  maxSteps?: number | null;
  executeTool: (
    tool: Tool,
    args: Record<string, unknown>,
    call: AgentLoopToolCall,
  ) => Promise<ContextItem[]>;
  onStep?: (step: AgentLoopStep) => void | Promise<void>;
  missingToolMessage?: (name: string) => string;
  /**
   * Compact history after each tool step (HL-16). Default on (heuristic).
   * Pass `false` to disable (tiny unit tests).
   */
  compact?:
    | false
    | ((messages: ChatMessage[]) => Promise<ChatMessage[]> | ChatMessage[]);
  /**
   * Identical-tool / fail-streak cap (HL-11). Default 3.
   * `null` / `0` disables. Rebuild tools fingerprint gcc/oops signatures.
   */
  doomLoopThreshold?: number | null;
  /**
   * Consecutive readonly tools in one turn run concurrently (GUI product path).
   * Default on. Writes, missing tools, and `await_shell`/`pty_read` kills stay
   * sequential. Pass `false` to force one-at-a-time (tiny unit tests).
   */
  parallelReadonly?: boolean;
  /**
   * Called before each tool executes. Default allow (eval / YOLO).
   * Return `deny` to skip the call; throw a cancelled ToolCallError to abort.
   */
  approveTool?: (
    tool: Tool,
    args: Record<string, unknown>,
    call: AgentLoopToolCall,
  ) => Promise<"allow" | "deny">;
  /** Default true: a cancelled tool stops the loop instead of continuing. */
  abortOnCancelled?: boolean;
  /** Streamed assistant/thinking chunks (GUI token streaming). */
  onChunk?: (chunk: ChatMessage) => void | Promise<void>;
  /** After a hydrated assistant turn is appended, before tools run. */
  onAssistant?: (
    assistant: AssistantChatMessage,
    toolCalls: AgentLoopToolCall[],
  ) => void | Promise<void>;
  /** Prompt log from each `streamChat` (GUI cost/devdata). */
  onPromptLog?: (log: PromptLog) => void | Promise<void>;
  /**
   * Seed doom-loop history (GUI resume after a permission wait that left
   * the thunk). Omit for a fresh loop.
   */
  initialDoomCalls?: DoomLoopCall[];
  /**
   * When the last cargo/compile oracle in this turn is red, a no-tool
   * assistant message is not `completed` (RL-20). Honor max-steps / abort.
   */
  holdCompletionWhileOracleRed?: boolean;
}

export function createAgentLoopCompactor(
  llm: Pick<ToolExtras, "llm">["llm"],
): (messages: ChatMessage[]) => ChatMessage[] {
  return (messages) => {
    const record = llm as {
      model?: string;
      contextLength?: number;
      completionOptions?: { maxTokens?: number };
    };
    const model = typeof record.model === "string" ? record.model : "gpt-4o";
    const contextLength = Number(record.contextLength) || 32_000;
    const maxTokens = Number(record.completionOptions?.maxTokens) || 2048;
    return compactMessages(messages, model, contextLength, maxTokens).messages;
  };
}

function resolveDoomLoopThresholdOption(
  raw: number | null | undefined,
): number | null {
  if (raw === 0 || raw === null) {
    return null;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 2) {
    return Math.min(Math.floor(raw), 20);
  }
  return DEFAULT_DOOM_LOOP_THRESHOLD;
}

function resultToDoomCall(result: AgentLoopToolResult): DoomLoopCall {
  return {
    name: result.name,
    args: result.args,
    output: renderContextItems(result.output),
    items: result.output,
    ok: result.ok,
  };
}

function pendingDoomCall(call: AgentLoopToolCall): DoomLoopCall {
  return {
    name: call.name,
    args: call.args,
    output: "",
    ok: true,
  };
}

function injectSystemInstruction(messages: ChatMessage[], text: string): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  const marker = trimmed.slice(0, 48);
  const first = messages[0];
  if (first?.role === "system" && typeof first.content === "string") {
    if (first.content.includes(marker)) {
      return;
    }
    first.content = `${first.content}\n\n${trimmed}`;
    return;
  }
  messages.unshift({ role: "system", content: trimmed });
}

function doomBlockedResult(
  call: AgentLoopToolCall,
  hit: DoomLoopHit,
): AgentLoopToolResult {
  const content = buildDoomLoopBlockedMessage(hit);
  return {
    name: call.name,
    args: call.args,
    output: [
      {
        name: "Agent",
        description: "doom-loop",
        content,
      },
    ],
    ok: false,
    error: "doom_loop",
  };
}

function approvalDeniedResult(call: AgentLoopToolCall): AgentLoopToolResult {
  return {
    name: call.name,
    args: call.args,
    output: [
      {
        name: "Agent",
        description: "permission-denied",
        content:
          "Blocked: this tool was not approved. The call was not executed. Continue with a different approach or wait for the user.",
      },
    ],
    ok: false,
    error: "permission_denied",
  };
}

export function mergeToolCallDeltas(
  existing: ToolCallDelta[],
  incoming: ToolCallDelta[],
): ToolCallDelta[] {
  const next: ToolCallDelta[] = existing.map((toolCall) => ({
    ...toolCall,
    function: {
      name: toolCall.function?.name ?? "",
      arguments: toolCall.function?.arguments ?? "",
    },
  }));

  for (const delta of incoming) {
    let target = -1;
    if (typeof delta.index === "number" && delta.index >= 0) {
      target = delta.index;
    } else if (delta.id) {
      target = next.findIndex((toolCall) => toolCall.id === delta.id);
    }
    if (target < 0) {
      target = next.length;
    }
    while (next.length <= target) {
      next.push({
        type: "function",
        function: { name: "", arguments: "" },
      });
    }
    const current = next[target];
    if (delta.id) {
      current.id = delta.id;
    }
    if (delta.type) {
      current.type = delta.type;
    }
    if (typeof delta.index === "number") {
      current.index = delta.index;
    }
    current.function = {
      name: delta.function?.name || current.function?.name || "",
      arguments:
        (current.function?.arguments ?? "") +
        (delta.function?.arguments ?? ""),
    };
  }

  return next;
}

export function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function toolErrorContextItems(
  name: string,
  error: unknown,
): ContextItem[] {
  const err =
    error instanceof ToolCallError
      ? error
      : error instanceof Error
        ? error
        : new Error(String(error));
  const code = error instanceof ToolCallError ? error.code : "ERROR";
  return [
    {
      name: "Tool Call Error",
      description: "failed",
      content: `Tool call "${name}" failed:\n\n${code}: ${err.message}`,
    },
  ];
}

export function isCancelledToolError(error: unknown): boolean {
  return (
    error instanceof ToolCallError &&
    error.code === ToolCallErrorCode.CANCELLED
  );
}

export async function collectAssistantTurn(
  extras: Pick<ToolExtras, "llm" | "abortSignal">,
  messages: ChatMessage[],
  tools: Tool[] | undefined,
  hooks?: {
    onChunk?: (chunk: ChatMessage) => void | Promise<void>;
    onPromptLog?: (log: PromptLog) => void | Promise<void>;
  },
): Promise<AssistantChatMessage> {
  const signal = extras.abortSignal ?? new AbortController().signal;
  let content = "";
  let toolCalls: ToolCallDelta[] = [];

  if (!signal.aborted) {
    const gen = extras.llm.streamChat(messages, signal, {
      tools,
    });
    let next = await gen.next();
    while (!next.done) {
      if (signal.aborted) {
        break;
      }
      const chunk = next.value;
      await hooks?.onChunk?.(chunk);
      if (chunk.role === "assistant") {
        if (typeof chunk.content === "string") {
          content += chunk.content;
        }
        if (chunk.toolCalls?.length) {
          toolCalls = mergeToolCallDeltas(toolCalls, chunk.toolCalls);
        }
      }
      next = await gen.next();
    }
    if (next.done && next.value) {
      await hooks?.onPromptLog?.(next.value);
    }
  }

  const hydrated = hydrateAssistantTextToolCalls(content, toolCalls);
  const assistant: AssistantChatMessage = {
    role: "assistant",
    content: hydrated.content,
  };
  if (hydrated.toolCalls.length) {
    assistant.toolCalls = hydrated.toolCalls;
  }
  return assistant;
}

function describeMissingTool(name: string): string {
  return `Tool "${name}" is not available.`;
}

function formatError(error: unknown): string {
  if (error instanceof ToolCallError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Last cargo/compiler oracle in the transcript (RL-20). */
export function lastOracleErrorCount(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i]?.role;
    if (role !== "tool" && role !== "assistant" && role !== "system") {
      continue;
    }
    const text = renderChatMessage(messages[i]);
    if (
      !/Build diagnostics|error\[E\d+\]|clippy::|could not compile|test .+FAILED/i.test(
        text,
      )
    ) {
      continue;
    }
    return parseBuildOutput(text).errors.length;
  }
  return 0;
}

/**
 * One Agent cycle: stream → tools → append → repeat until text-only, cap, abort, or doom-loop.
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxSteps = options.maxSteps === undefined ? null : options.maxSteps;
  const abortOnCancelled = options.abortOnCancelled !== false;
  const parallelReadonly = options.parallelReadonly !== false;
  const doomThreshold = resolveDoomLoopThresholdOption(options.doomLoopThreshold);
  const compactFn =
    options.compact === false
      ? undefined
      : options.compact ?? createAgentLoopCompactor(options.extras.llm);
  const messages = options.messages;
  const doomCalls: DoomLoopCall[] = [...(options.initialDoomCalls ?? [])];
  let lastText = "";
  let steps = 0;
  const streamHooks = {
    onChunk: options.onChunk,
    onPromptLog: options.onPromptLog,
  };

  const finish = (
    stoppedReason: AgentLoopStoppedReason,
    summary = lastText,
  ): AgentLoopResult => ({
    stoppedReason,
    steps,
    summary: summary.trim() || lastText || "(no summary)",
    messages,
  });

  const maybeCompact = async () => {
    if (!compactFn) {
      return;
    }
    const compacted = await compactFn(messages);
    if (compacted !== messages) {
      messages.length = 0;
      messages.push(...compacted);
    }
  };

  const finishDoomLoop = async (
    hit: DoomLoopHit,
  ): Promise<AgentLoopResult> => {
    injectSystemInstruction(messages, buildDoomLoopSummaryInstruction(hit));
    const assistant = await collectAssistantTurn(
      options.extras,
      messages,
      undefined,
      streamHooks,
    );
    lastText = renderChatMessage(assistant).trim() || lastText;
    return finish(
      "doom_loop",
      lastText ||
        `Doom loop (${hit.kind}, ${hit.toolName ?? "tools"} ×${hit.count}).`,
    );
  };

  try {
    const existingHit = detectDoomLoop(doomCalls, { threshold: doomThreshold });
    if (existingHit) {
      return await finishDoomLoop(existingHit);
    }

    while (true) {
      if (options.extras.abortSignal?.aborted) {
        return finish("aborted", lastText || "Aborted.");
      }

      const atCap = maxSteps !== null && steps >= maxSteps;
      if (atCap && maxSteps !== null) {
        injectSystemInstruction(
          messages,
          [
            `[Agent max steps] You have reached the maximum of ${maxSteps} tool rounds for this turn.`,
            "Do not call any tools.",
            "Summarize what you accomplished, what is still unfinished, and the recommended next steps for the user.",
          ].join(" "),
        );
      }
      const assistant = await collectAssistantTurn(
        options.extras,
        messages,
        atCap ? undefined : options.tools,
        streamHooks,
      );
      lastText = renderChatMessage(assistant).trim() || lastText;
      if (options.extras.abortSignal?.aborted) {
        return finish("aborted", lastText || "Aborted.");
      }
      const toolCalls = (assistant.toolCalls ?? []).filter(
        (call) => call.function?.name,
      );
      const parsedCalls: AgentLoopToolCall[] = toolCalls.map((call) => ({
        id: call.id,
        name: call.function?.name ?? "",
        args: parseToolArgs(call.function?.arguments),
        rawArguments: call.function?.arguments,
      }));
      await options.onAssistant?.(assistant, parsedCalls);

      if (atCap) {
        return finish(
          "max_steps",
          lastText ||
            `Reached max steps (${maxSteps}) without a final summary.`,
        );
      }

      if (toolCalls.length === 0) {
        const oracleErrors = lastOracleErrorCount(messages);
        if (options.holdCompletionWhileOracleRed && oracleErrors > 0) {
          messages.push(assistant);
          messages.push({
            role: "system",
            content: `Oracle still red: ${oracleErrors} rustc/clippy/test error(s). Continue or ask the user. Do not treat this as done.`,
          });
          steps += 1;
          continue;
        }
        return finish("completed");
      }

      messages.push(assistant);
      steps += 1;

      const results: AgentLoopToolResult[] = [];
      let doomHit: DoomLoopHit | null = null;

      const findTool = (name: string): Tool | undefined =>
        options.tools.find((item) => item.function.name === name);

      const callCanParallel = (call: AgentLoopToolCall): boolean =>
        parallelReadonly && canRunToolInParallel(findTool(call.name), call.args);

      const pendingHitFor = (extra: DoomLoopCall[]): DoomLoopHit | null =>
        detectDoomLoop([...doomCalls, ...extra], { threshold: doomThreshold });

      const pushResult = (result: AgentLoopToolResult, call: AgentLoopToolCall) => {
        results.push(result);
        doomCalls.push(resultToDoomCall(result));
        messages.push({
          role: "tool",
          content: renderContextItems(result.output),
          toolCallId: call.id ?? call.name,
        });
      };

      const blockRemaining = (fromIndex: number, hit: DoomLoopHit) => {
        for (let i = fromIndex; i < parsedCalls.length; i++) {
          pushResult(doomBlockedResult(parsedCalls[i], hit), parsedCalls[i]);
        }
      };

      const finishAborted = async (summary: string) => {
        await options.onStep?.({
          assistant,
          toolCalls: parsedCalls,
          results,
        });
        return finish("aborted", lastText || summary);
      };

      const missingResult = (call: AgentLoopToolCall): AgentLoopToolResult => {
        const error =
          options.missingToolMessage?.(call.name) ??
          describeMissingTool(call.name);
        return {
          name: call.name,
          args: call.args,
          output: [
            {
              name: "Agent",
              description: "Tool not available",
              content: error,
            },
          ],
          ok: false,
          error,
        };
      };

      const runExecute = async (
        tool: Tool,
        call: AgentLoopToolCall,
      ): Promise<{ result: AgentLoopToolResult; cancelled: boolean }> => {
        try {
          const output = await options.executeTool(tool, call.args, call);
          return {
            cancelled: false,
            result: {
              name: call.name,
              args: call.args,
              output,
              ok: true,
            },
          };
        } catch (err) {
          return {
            cancelled: isCancelledToolError(err),
            result: {
              name: call.name,
              args: call.args,
              output: toolErrorContextItems(call.name, err),
              ok: false,
              error: formatError(err),
            },
          };
        }
      };

      const approveCall = async (
        tool: Tool,
        call: AgentLoopToolCall,
      ): Promise<{ result: AgentLoopToolResult; cancelled: boolean } | null> => {
        if (!options.approveTool) {
          return null;
        }
        try {
          const decision = await options.approveTool(tool, call.args, call);
          if (decision === "deny") {
            return {
              cancelled: false,
              result: approvalDeniedResult(call),
            };
          }
          return null;
        } catch (err) {
          return {
            cancelled: isCancelledToolError(err),
            result: {
              name: call.name,
              args: call.args,
              output: toolErrorContextItems(call.name, err),
              ok: false,
              error: formatError(err),
            },
          };
        }
      };

      const settleWave = async (
        wave: AgentLoopToolCall[],
      ): Promise<Array<{ result: AgentLoopToolResult; cancelled: boolean }>> => {
        if (wave.length === 1 && !options.approveTool) {
          const tool = findTool(wave[0].name);
          if (!tool) {
            return [{ cancelled: false, result: missingResult(wave[0]) }];
          }
          return [await runExecute(tool, wave[0])];
        }

        const out: Array<{
          result: AgentLoopToolResult;
          cancelled: boolean;
        } | null> = wave.map(() => null);
        const runnable: Array<{ index: number; tool: Tool; call: AgentLoopToolCall }> =
          [];

        for (let i = 0; i < wave.length; i++) {
          const call = wave[i];
          const tool = findTool(call.name);
          if (!tool) {
            out[i] = { cancelled: false, result: missingResult(call) };
            continue;
          }
          const denied = await approveCall(tool, call);
          if (denied) {
            out[i] = denied;
            continue;
          }
          runnable.push({ index: i, tool, call });
        }

        const ran = await Promise.all(
          runnable.map((item) => runExecute(item.tool, item.call)),
        );
        ran.forEach((settled, j) => {
          out[runnable[j].index] = settled;
        });
        return out.map((item, i) => {
          if (item) {
            return item;
          }
          return {
            cancelled: false,
            result: missingResult(wave[i]),
          };
        });
      };

      const expandWave = (
        from: number,
      ): { end: number } => {
        const first = parsedCalls[from];
        if (!callCanParallel(first)) {
          return { end: from + 1 };
        }
        const pending: DoomLoopCall[] = [pendingDoomCall(first)];
        let end = from + 1;
        while (end < parsedCalls.length) {
          const next = parsedCalls[end];
          if (!callCanParallel(next)) {
            break;
          }
          if (pendingHitFor([...pending, pendingDoomCall(next)])) {
            break;
          }
          pending.push(pendingDoomCall(next));
          end += 1;
        }
        return { end };
      };

      let index = 0;
      while (index < parsedCalls.length) {
        if (options.extras.abortSignal?.aborted) {
          return finishAborted("Aborted.");
        }

        const pendingHit = pendingHitFor([pendingDoomCall(parsedCalls[index])]);
        if (pendingHit) {
          doomHit = pendingHit;
          blockRemaining(index, pendingHit);
          break;
        }

        const { end } = expandWave(index);
        const wave = parsedCalls.slice(index, end);
        const settled = await settleWave(wave);

        let cancelledInWave = false;
        for (let offset = 0; offset < wave.length; offset++) {
          const { result, cancelled } = settled[offset];
          pushResult(result, wave[offset]);
          if (cancelled) {
            cancelledInWave = true;
          }
        }
        if (abortOnCancelled && cancelledInWave) {
          return finishAborted("Aborted mid-tool.");
        }

        doomHit = detectDoomLoop(doomCalls, { threshold: doomThreshold });
        if (doomHit) {
          blockRemaining(end, doomHit);
          break;
        }
        index = end;
      }

      await options.onStep?.({
        assistant,
        toolCalls: parsedCalls,
        results,
      });

      await maybeCompact();

      if (doomHit) {
        return finishDoomLoop(doomHit);
      }
    }
  } catch (error) {
    return finish(
      "error",
      `Agent loop error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
