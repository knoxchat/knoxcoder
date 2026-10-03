import type { ContextItem, ILLM, Tool } from "core";
import { runChatTurn, type ChatTurnEvent } from "core/agent/chatTurn";
import type { DoomLoopCall } from "core/agent/doomLoop";
import type { HookRunner } from "core/hooks/hooks";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  type PermissionMode,
  type ToolSetting,
} from "core/agent/permissions";
import type {
  NativeAgentRequestInput,
  NativeAgentRequestOutput,
  NativeDoomLoopCall,
  SharedChatTurnInput,
  SharedChatTurnOutput,
} from "core/protocol/nativeAgent";
import { ToolCallError, ToolCallErrorCode } from "core/tools/errors";
import type { AgentToolPolicy } from "core/tools/toolPolicy";

export interface SharedChatTurnDeps {
  /** `knoxchat.deferTools` (K-021). */
  getDeferTools?: () => boolean;
  /** `.knox/hooks.json` runner for the workspace (K-023), or null. */
  getHooks?: () => Promise<HookRunner | null>;
  buildRequest: (
    input: NativeAgentRequestInput,
  ) => Promise<NativeAgentRequestOutput>;
  resolveLlm: (title: string) => Promise<ILLM | null | undefined>;
  /** `knoxchat.fallbackModel`: used after repeated transient stream failures. */
  resolveFallbackLlm?: () => Promise<ILLM | null | undefined>;
  /** Backoff between tool retries. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** The existing core `tools/call` path: model routing, soul hooks, abort, partial output. */
  callTool: (request: {
    toolCall: {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    };
    selectedModelTitle: string;
    viewReadModelTitle?: string | null;
    realTimeSearchModelTitle?: string | null;
    sessionId: string;
    turnId?: string;
  }) => Promise<{ contextItems: ContextItem[] }>;
  /** Core `tools/cancel` (kills terminals and background jobs). */
  cancelTools: () => void | Promise<void>;
  emit: (sessionId: string, event: ChatTurnEvent) => void;
  getPolicy: () => Promise<{
    policy?: AgentToolPolicy | null;
    policyFromRules?: AgentToolPolicy | null;
    workspaceDirs: string[];
    doomLoopThreshold: number | null;
  }>;
  /** Checkpoint-per-assistant for the final (tool-free) reply. Best effort. */
  ensureCheckpoint?: (sessionId: string, turnId: string) => Promise<void>;
}

const TOOL_MAX_RETRIES = 2;
const TOOL_BASE_DELAY_MS = 800;
const RETRYABLE_MARKERS = [
  "timeout",
  "ebusy",
  "eagain",
  "disposed",
  "network",
  "econnreset",
  "circuit",
  "rate limit",
  "execution_timeout",
  "ide_operation_failed",
];

/** Transient tool failures worth another attempt (same rules the GUI's own loop used). */
export function isRetryableToolMessage(message: string | undefined): boolean {
  const msg = (message ?? "").toLowerCase();
  return RETRYABLE_MARKERS.some((marker) => msg.includes(marker));
}

function isCancelledMessage(message: string): boolean {
  return /cancel+ed|aborted/i.test(message);
}

const PERMISSION_MODE_SET = new Set<string>(PERMISSION_MODES);
const active = new Map<string, AbortController>();
/** Sessions that already ran a turn in this process (for the SessionStart hook). */
const startedSessions = new Set<string>();

function toDoomCall(call: NativeDoomLoopCall): DoomLoopCall {
  return {
    name: call.name,
    args: call.args,
    output: call.output ?? "",
    ok: call.ok ?? true,
  };
}

/** `tools/call` rejects with `Tool "x" cancelled` on Stop; the loop needs the typed error. */
function asLoopError(error: unknown, toolName: string, aborted: boolean): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (aborted || /cancel+ed/i.test(message)) {
    return new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message,
      toolName,
      retryable: false,
    });
  }
  return error;
}

/**
 * The loop calls `llm.streamChat(messages, signal, { tools })`. Merge the
 * GUI's reasoning effort / web search into those options, as `llm/streamChat`
 * does for the old path. The loop's own options (tools) win.
 */
export function withCompletionOptions(
  llm: ILLM,
  extra: SharedChatTurnInput["completionOptions"],
): ILLM {
  const options = Object.fromEntries(
    Object.entries(extra ?? {}).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(options).length === 0) {
    return llm;
  }
  return new Proxy(llm, {
    get(target, prop) {
      if (prop === "streamChat") {
        return (messages: unknown, signal: unknown, own?: object) =>
          (target.streamChat as (...args: unknown[]) => unknown).call(
            target,
            messages,
            signal,
            { ...options, ...own },
          );
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function isChatTurnRunning(sessionId: string): boolean {
  return active.has(sessionId);
}

/**
 * Run one chat turn on `runAgentLoop`. Progress goes out through `deps.emit`;
 * tool permission cards are answered with the existing
 * `brain/resolveAutonomousTool` message (same wait registry).
 */
export async function runSharedChatTurn(
  input: SharedChatTurnInput,
  deps: SharedChatTurnDeps,
): Promise<SharedChatTurnOutput> {
  const { sessionId } = input;
  // One turn per session: a new one replaces a stale one.
  active.get(sessionId)?.abort();
  const controller = new AbortController();
  active.set(sessionId, controller);

  try {
    const llm = await deps.resolveLlm(input.modelTitle);
    if (!llm) {
      throw new Error(`Model "${input.modelTitle}" is not available.`);
    }
    const request = await deps.buildRequest({
      history: input.history,
      sessionId,
      injectedContext: input.injectedContext,
      includeTools: input.includeTools,
      toolSettings: input.toolSettings,
      excludedGroups: input.excludedGroups,
      dropSearchWeb: input.dropSearchWeb,
      deferTools: deps.getDeferTools?.() === true,
    });
    const policy = await deps.getPolicy();
    const mode: PermissionMode = PERMISSION_MODE_SET.has(
      input.permissionMode ?? "",
    )
      ? (input.permissionMode as PermissionMode)
      : DEFAULT_PERMISSION_MODE;
    const turnId = input.turnId ?? sessionId;
    const fallback = await deps.resolveFallbackLlm?.().catch(() => null);
    const maxSteps =
      typeof request.maxSteps === "number"
        ? Math.max(1, request.maxSteps - Math.max(0, input.priorSteps ?? 0))
        : request.maxSteps;
    const sleep =
      deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    const hooks = await deps.getHooks?.().catch(() => null);
    const sessionStart = !startedSessions.has(sessionId);
    startedSessions.add(sessionId);

    const result = await runChatTurn({
      sessionId,
      hooks,
      sessionStart,
      extras: {
        llm: withCompletionOptions(llm, input.completionOptions),
        abortSignal: controller.signal,
      },
      messages: request.messages,
      tools: request.tools as Tool[],
      deferredTools: request.deferredTools as Tool[] | undefined,
      maxSteps,
      retry: deps.sleep ? { sleep: deps.sleep } : undefined,
      fallbackLlm: fallback
        ? withCompletionOptions(fallback, input.completionOptions)
        : undefined,
      doomLoopThreshold: policy.doomLoopThreshold,
      initialDoomCalls: (input.turnToolCalls ?? []).map(toDoomCall),
      permission: {
        mode,
        toolSettings: (input.toolSettings ?? {}) as Record<string, ToolSetting>,
        sessionAllowlist: [...(input.sessionAllowlist ?? [])],
        policy: policy.policy,
        policyFromRules: policy.policyFromRules,
        workspaceDirs: policy.workspaceDirs,
      },
      emit: (event) => deps.emit(sessionId, event),
      beforeTools: async (_assistant, toolCalls) => {
        if (toolCalls.length === 0) {
          await deps.ensureCheckpoint?.(sessionId, turnId);
        }
      },
      executeTool: async (tool, args, call) => {
        const name = tool.function.name;
        let lastError: unknown;
        for (let attempt = 0; attempt <= TOOL_MAX_RETRIES; attempt++) {
          if (controller.signal.aborted) {
            throw asLoopError(lastError ?? "cancelled", name, true);
          }
          if (attempt > 0) {
            await sleep(TOOL_BASE_DELAY_MS * 2 ** (attempt - 1));
            if (controller.signal.aborted) {
              throw asLoopError(lastError ?? "cancelled", name, true);
            }
          }
          try {
            const response = await deps.callTool({
              toolCall: {
                id: call.id ?? `${name}-${Date.now()}`,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
              selectedModelTitle: input.modelTitle,
              viewReadModelTitle: input.viewReadModelTitle,
              realTimeSearchModelTitle: input.realTimeSearchModelTitle,
              sessionId,
              turnId,
            });
            return response.contextItems;
          } catch (error) {
            lastError = error;
            const message =
              error instanceof Error ? error.message : String(error);
            if (
              controller.signal.aborted ||
              isCancelledMessage(message) ||
              !isRetryableToolMessage(message)
            ) {
              throw asLoopError(error, name, controller.signal.aborted);
            }
          }
        }
        throw lastError;
      },
    });
    return {
      stoppedReason: result.stoppedReason,
      steps: result.steps,
      summary: result.summary,
    };
  } finally {
    if (active.get(sessionId) === controller) {
      active.delete(sessionId);
    }
  }
}

/** Stop a running turn: abort the stream and permission waits, then kill tools. */
export async function cancelSharedChatTurn(
  sessionId: string,
  deps: Pick<SharedChatTurnDeps, "cancelTools">,
): Promise<boolean> {
  const controller = active.get(sessionId);
  controller?.abort();
  await deps.cancelTools();
  return Boolean(controller);
}