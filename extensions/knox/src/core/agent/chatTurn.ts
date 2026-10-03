/**
 * Shared chat-turn runner (K-010).
 *
 * One entry point that drives a whole GUI chat turn on `runAgentLoop` and
 * reports progress as plain events. The native GUI becomes a renderer of
 * these events instead of re-implementing stream -> tools -> continue itself.
 *
 * It adapts the loop's hooks:
 *   onChunk / onRetry / onPromptLog -> events (streaming text, "retrying (2/4)")
 *   approveTool                     -> hard-policy deny, auto-approve, or an
 *                                      ask event plus a wait for the GUI card
 *   executeTool                     -> tool_start / tool_end events
 *   onAssistant                     -> `assistant` event + `beforeTools` hook
 *                                      (checkpoint-per-assistant)
 *   initialDoomCalls                -> doom-loop resume
 *   abortSignal                     -> cancel
 *
 * The host builds `messages` and `tools` (constructMessages, tool catalog)
 * and supplies `executeTool`; this module stays platform neutral.
 */

import type {
  AssistantChatMessage,
  ChatMessage,
  ContextItem,
  PromptLog,
  Tool,
  ToolExtras,
} from "..";
import { BuiltInToolNames } from "../tools/builtIn";
import { ToolCallError, ToolCallErrorCode } from "../tools/errors";
import { runToolSearch } from "../tools/deferred";
import type { AgentToolPolicy } from "../tools/toolPolicy";
import type { HookRunner } from "../hooks/hooks";
import type { DoomLoopCall } from "./doomLoop";
import {
  runAgentLoop,
  type AgentLoopCompactor,
  type AgentLoopStep,
  type AgentLoopStoppedReason,
  type AgentLoopToolCall,
} from "./loop";
import { resolveToolPermission } from "./permissionGate";
import type { PermissionMode, ToolSetting } from "./permissions";
import type { StreamRetryEvent, StreamRetryOptions } from "./streamRetry";

export interface ChatTurnPermission {
  mode: PermissionMode;
  toolSettings: Record<string, ToolSetting>;
  /** Mutated when the user picks "always allow" on a card. */
  sessionAllowlist: string[];
  policy?: AgentToolPolicy | null;
  policyFromRules?: AgentToolPolicy | null;
  workspaceDirs?: string[];
}

export type ChatTurnEvent =
  /** Streamed assistant / thinking chunk of the current round. */
  | { type: "chunk"; chunk: ChatMessage }
  /** Transient failure: discard this round's partial output and expect a restart. */
  | { type: "retry"; retry: StreamRetryEvent }
  /** A round finished streaming. Tool calls (if any) follow. */
  | {
      type: "assistant";
      assistant: AssistantChatMessage;
      toolCalls: AgentLoopToolCall[];
    }
  /** The call needs the user: render the permission card, then resolve it. */
  | {
      type: "tool_ask";
      callId: string;
      name: string;
      args: Record<string, unknown>;
      /** ask_user: the turn ends here; the answer starts the next turn. */
      awaitsUser?: boolean;
    }
  | {
      type: "tool_start";
      callId: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      callId: string;
      name: string;
      ok: boolean;
      output: ContextItem[];
      error?: string;
    }
  /** All tool results of a round are in; safe point to save the session. */
  | { type: "step"; step: AgentLoopStep }
  | { type: "prompt_log"; log: PromptLog }
  | {
      type: "done";
      stoppedReason: AgentLoopStoppedReason;
      steps: number;
      summary: string;
    };

export interface ChatTurnOptions {
  sessionId: string;
  extras: Pick<ToolExtras, "llm" | "abortSignal">;
  /** Mutated in place by the loop. */
  messages: ChatMessage[];
  tools: Tool[];
  /**
   * K-021: tools not in `tools` yet. `builtin_tool_search` moves matches into
   * `tools` (the loop reads that array every round).
   */
  deferredTools?: Tool[];
  emit: (event: ChatTurnEvent) => void | Promise<void>;
  executeTool: (
    tool: Tool,
    args: Record<string, unknown>,
    call: AgentLoopToolCall,
  ) => Promise<ContextItem[]>;
  /** Omit for YOLO (no approval, e.g. tests). */
  permission?: ChatTurnPermission;
  maxSteps?: number | null;
  doomLoopThreshold?: number | null;
  /** Seed for resuming a turn that already ran tools. */
  initialDoomCalls?: DoomLoopCall[];
  holdCompletionWhileOracleRed?: boolean;
  retry?: StreamRetryOptions | false;
  fallbackLlm?: Pick<ToolExtras, "llm">["llm"];
  compact?: false | AgentLoopCompactor;
  /**
   * Runs after each assistant message is final and before its tools run.
   * The host uses it for checkpoint-per-assistant. Errors are swallowed.
   */
  beforeTools?: (
    assistant: AssistantChatMessage,
    toolCalls: AgentLoopToolCall[],
  ) => void | Promise<void>;
  /**
   * K-023 lifecycle hooks. `UserPromptSubmit` can deny the turn or add
   * context, `SessionStart` runs when `sessionStart` is true, `Stop` runs
   * after the loop ends.
   */
  hooks?: HookRunner | null;
  sessionStart?: boolean;
}

function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return i;
    }
  }
  return -1;
}

function messageText(message: ChatMessage | undefined): string {
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
  }
  return "";
}

/** Append hook context to the latest user message (providers reject mid-chat system messages). */
function appendUserContext(messages: ChatMessage[], blocks: string[]): void {
  const text = blocks.map((b) => b.trim()).filter(Boolean).join("\n\n");
  const index = lastUserIndex(messages);
  if (!text || index < 0) {
    return;
  }
  const message = messages[index];
  const extra = `\n\n<hook_context>\n${text}\n</hook_context>`;
  if (typeof message.content === "string") {
    message.content += extra;
  } else if (Array.isArray(message.content)) {
    message.content = [...message.content, { type: "text", text: extra }];
  }
}

export interface ChatTurnResult {
  stoppedReason: AgentLoopStoppedReason;
  steps: number;
  summary: string;
  messages: ChatMessage[];
}

function cancelledError(toolName: string): ToolCallError {
  return new ToolCallError({
    code: ToolCallErrorCode.CANCELLED,
    message: "cancelled",
    toolName,
    retryable: false,
  });
}

/** Drive one chat turn on `runAgentLoop`, reporting through `emit`. */
export async function runChatTurn(
  options: ChatTurnOptions,
): Promise<ChatTurnResult> {
  const { emit, permission, sessionId } = options;
  const abortSignal = options.extras.abortSignal;
  let anonymousCalls = 0;
  const callIdOf = (call: AgentLoopToolCall, name: string): string =>
    call.id ?? `${name}-${++anonymousCalls}`;

  const hooks = options.hooks;
  if (hooks) {
    const context: string[] = [];
    if (options.sessionStart && hooks.has("SessionStart")) {
      const started = await hooks.run("SessionStart", {}).catch(() => null);
      context.push(...(started?.additionalContext ?? []));
    }
    if (hooks.has("UserPromptSubmit")) {
      const prompt = messageText(options.messages[lastUserIndex(options.messages)]);
      const submitted = await hooks
        .run("UserPromptSubmit", { prompt })
        .catch(() => null);
      if (submitted?.denied) {
        const summary = `Blocked by hook: ${submitted.denied.reason}`;
        await emit({
          type: "done",
          stoppedReason: "aborted",
          steps: 0,
          summary,
        });
        return {
          stoppedReason: "aborted",
          steps: 0,
          summary,
          messages: options.messages,
        };
      }
      context.push(...(submitted?.additionalContext ?? []));
    }
    appendUserContext(options.messages, context);
  }

  const result = await runAgentLoop({
    extras: options.extras,
    messages: options.messages,
    tools: options.tools,
    missingToolMessage: options.deferredTools?.length
      ? (name) =>
          options.deferredTools!.some((tool) => tool.function.name === name)
            ? `Tool "${name}" is not loaded yet. Call ${BuiltInToolNames.ToolSearch} with {"names":["${name}"]} first.`
            : `Tool "${name}" is not available.`
      : undefined,
    maxSteps: options.maxSteps,
    doomLoopThreshold: options.doomLoopThreshold,
    initialDoomCalls: options.initialDoomCalls,
    holdCompletionWhileOracleRed: options.holdCompletionWhileOracleRed,
    retry: options.retry,
    fallbackLlm: options.fallbackLlm,
    compact: options.compact,
    permissionMode: permission?.mode,
    onChunk: (chunk) => emit({ type: "chunk", chunk }),
    onRetry: (retry) => emit({ type: "retry", retry }),
    onPromptLog: (log) => emit({ type: "prompt_log", log }),
    onAssistant: async (assistant, toolCalls) => {
      // Give every call a stable id before anyone sees it, so the GUI card,
      // approval waits and the tool message all agree. The assistant's own
      // tool-call list is filtered the same way as `toolCalls` in the loop.
      const named = (assistant.toolCalls ?? []).filter(
        (call) => call.function?.name,
      );
      toolCalls.forEach((call, i) => {
        call.id ??= named[i]?.id ?? `call_${++anonymousCalls}`;
        if (named[i]) {
          named[i].id = call.id;
        }
      });
      await emit({ type: "assistant", assistant, toolCalls });
      try {
        await options.beforeTools?.(assistant, toolCalls);
      } catch {
        // checkpointing must never break the turn
      }
    },
    onStep: (step) => emit({ type: "step", step }),
    approveTool: async (tool, args, call) => {
      if (!permission) {
        return "allow";
      }
      const name = tool.function.name;
      if (name === BuiltInToolNames.AskUser) {
        // The question is answered in the GUI, which then starts the next
        // turn with the answer in the history. End this turn here.
        const callId = callIdOf(call, name);
        call.id = callId;
        await emit({ type: "tool_ask", callId, name, args, awaitsUser: true });
        throw cancelledError(name);
      }
      return resolveToolPermission({
        permission,
        toolName: name,
        args,
        sessionId,
        abortSignal,
        callId: () => {
          const callId = callIdOf(call, name);
          call.id = callId;
          return callId;
        },
        onAsk: (callId) => emit({ type: "tool_ask", callId, name, args }),
      });
    },
    executeTool: async (tool, args, call) => {
      const name = tool.function.name;
      const callId = callIdOf(call, name);
      call.id = callId;
      await emit({ type: "tool_start", callId, name, args });
      try {
        const output =
          name === BuiltInToolNames.ToolSearch && options.deferredTools
            ? runToolSearch(args, options.deferredTools, options.tools)
            : await options.executeTool(tool, args, call);
        await emit({ type: "tool_end", callId, name, ok: true, output });
        return output;
      } catch (error) {
        await emit({
          type: "tool_end",
          callId,
          name,
          ok: false,
          output: [],
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  if (hooks?.has("Stop")) {
    await hooks
      .run("Stop", { result: result.summary })
      .catch(() => undefined);
  }

  await emit({
    type: "done",
    stoppedReason: result.stoppedReason,
    steps: result.steps,
    summary: result.summary,
  });
  return result;
}
