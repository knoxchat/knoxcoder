import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import i18n from "../../i18n";
import { selectCurrentToolCall } from "../selectors/selectCurrentToolCall";
import { findToolCallStateById } from "../util";
import { selectDefaultModel } from "../slices/configSlice";
import {
  acceptToolCall,
  cancelToolCall,
  setCalling,
  setToolCallOutput,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import {
  resolveAgentMaxSteps,
  shouldDisableToolsForMaxSteps,
} from "../util/agentMaxSteps";
import {
  buildDoomLoopBlockedMessage,
  detectDoomLoop,
  resolveDoomLoopThreshold,
} from "../util/doomLoop";
import { ContextItem } from "core";
import { resolveBuiltInToolName } from "core/tools/builtIn";
import {
  evaluateToolPolicy,
  resolveConfigAgentPolicy,
} from "core/tools/toolPolicy";

import {
  isCancelledToolError,
  isUserStoppedToolCall,
  shouldAbortToolContinuation,
  shouldResumeAfterUnexpectedAbort,
} from "../util/toolCallCancel";

import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

// ─── Retry Configuration ─────────────────────────────────────────────────────

const TOOL_CALL_MAX_RETRIES = 2;
const TOOL_CALL_BASE_DELAY_MS = 800;
const TOOL_CALL_BACKOFF_MULTIPLIER = 2;

/**
 * Determine if an error from the tool call IPC is retryable.
 * Retryable errors: timeouts, transient IDE failures, network issues.
 * Non-retryable: validation errors, file not found, permission denied.
 */
function isRetryableError(errorMessage: string): boolean {
  if (!errorMessage) return false;
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("ebusy") ||
    msg.includes("eagain") ||
    msg.includes("disposed") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("circuit") ||
    msg.includes("rate limit") ||
    // ToolCallErrorCode markers
    msg.includes("execution_timeout") ||
    msg.includes("ide_operation_failed")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toolFailureOutput(
  toolName: string,
  errorDetail: string,
  opts: { unexpectedAbort?: boolean; retried?: boolean; attemptsUsed?: number },
): ContextItem[] {
  const unexpectedAbort = opts.unexpectedAbort === true;
  const retried = opts.retried === true;
  const description = unexpectedAbort
    ? i18n.t("toolCallInterrupted")
    : retried
      ? i18n.t("toolCallFailedAfterRetries", {
          count: opts.attemptsUsed ?? 0,
        })
      : i18n.t("toolCallFailed");
  const content = unexpectedAbort
    ? `Tool call "${toolName}" was interrupted before it finished (the user did not hit Stop):\n\n${errorDetail}\n\nRetry the same tool or try an alternative approach.`
    : `Tool call "${toolName}" failed${
        retried ? ` (after ${opts.attemptsUsed} attempts)` : ""
      }:\n\n${errorDetail}\n\nPlease try an alternative approach or ask for further instructions.`;
  return [
    {
      icon: "problems",
      name: i18n.t("toolCallErrorName"),
      description,
      content,
      hidden: false,
    },
  ];
}

function formatToolCallIpcError(result: {
  status?: string;
  error?: unknown;
}): string {
  if (typeof result?.error === "string" && result.error.trim()) {
    return result.error;
  }
  if (result?.error != null) {
    return String(result.error);
  }
  try {
    return `Tool call failed (${result?.status ?? "unknown"}): ${JSON.stringify(result)}`;
  } catch {
    return "Unknown tool call error";
  }
}

// ─── Main Thunk ──────────────────────────────────────────────────────────────

export type CallToolArg = {
  toolCallId?: string;
  skipContinue?: boolean;
};

export const callTool = createAsyncThunk<void, CallToolArg | undefined, ThunkApiType>(
  "chat/callTool",
  async (arg, { dispatch, extra, getState }) => {
    const state = getState();
    const toolCallState = arg?.toolCallId
      ? findToolCallStateById(state.session.history, arg.toolCallId)
      : selectCurrentToolCall(state);

    if (!toolCallState) {
      return;
    }

    if (toolCallState.status !== "generated") {
      return;
    }

    const loopOwnsGuards = arg?.skipContinue === true;
    const agentMaxSteps = resolveAgentMaxSteps(
      state.config.config.experimental?.agentMaxSteps,
      state.config.config.experimental?.agentProfile,
    );
    if (
      !loopOwnsGuards &&
      shouldDisableToolsForMaxSteps(
        state.session.toolLoopSteps,
        agentMaxSteps,
      )
    ) {
      console.warn(
        `[Agent] Blocking tool call — max steps (${agentMaxSteps}) already reached`,
      );
      dispatch(cancelToolCall(toolCallState.toolCallId));
      return;
    }

    const doomLoop = loopOwnsGuards
      ? undefined
      : detectDoomLoop(state.session.history, {
          pending: [toolCallState],
          threshold: resolveDoomLoopThreshold(
            state.config.config.experimental?.agentDoomLoopThreshold,
            state.config.config.experimental?.agentProfile,
          ),
        });
    if (doomLoop) {
      console.warn(
        `[Agent] Blocking tool call — doom loop (${doomLoop.kind})`,
      );
      void extra.ideMessenger
        .request("brain/recordSoulEvent", {
          sessionId: state.session.id,
          kind: "tool_error",
          toolName: doomLoop.toolName ?? toolCallState.toolCall.function.name,
          files: [],
          ok: false,
          summary: `Doom loop (${doomLoop.kind}) blocked further tool calls`,
        })
        .catch(() => {});
      const blocked = buildDoomLoopBlockedMessage(doomLoop);
      dispatch(setCalling(toolCallState.toolCallId));
      dispatch(
        setToolCallOutput({
          toolCallId: toolCallState.toolCallId,
          output: [
            {
              name: i18n.t("doomLoopName"),
              description: i18n.t("doomLoopDescription"),
              content: blocked,
            },
          ],
        }),
      );
      dispatch(acceptToolCall(toolCallState.toolCallId));
      const output = await dispatch(
        streamResponseAfterToolCall({
          toolCallId: toolCallState.toolCallId,
          toolOutput: [
            {
              name: i18n.t("doomLoopName"),
              description: i18n.t("doomLoopDescription"),
              content: blocked,
            },
          ],
          skipLlmContinue: arg?.skipContinue,
        }),
      );
      unwrapResult(output);
      return;
    }

    const toolCallId = toolCallState.toolCallId;
    const resolveLive = () =>
      findToolCallStateById(getState().session.history, toolCallId) ??
      selectCurrentToolCall(getState());

    const defaultModel = selectDefaultModel(state);
    if (!defaultModel) {
      throw new Error("No model selected");
    }

    const toolName =
      resolveBuiltInToolName(toolCallState.toolCall.function.name) ||
      toolCallState.toolCall.function.name;

    const policyDecision = evaluateToolPolicy({
      toolName,
      args:
        toolCallState.parsedArgs ??
        toolCallState.toolCall.function.arguments,
      policy: resolveConfigAgentPolicy(state.config.config.experimental),
      workspaceDirs: window.workspacePaths,
    });
    if (policyDecision.action === "deny") {
      void extra.ideMessenger
        .request("brain/recordSoulEvent", {
          sessionId: state.session.id,
          kind: "tool_denied",
          toolName,
          files: [],
          ok: false,
          policy: "deny",
          summary: policyDecision.reason,
        })
        .catch(() => {});
      dispatch(setCalling(toolCallState.toolCallId));
      dispatch(
        setToolCallOutput({
          toolCallId: toolCallState.toolCallId,
          output: [
            {
              name: i18n.t("policyBlockedName"),
              description: i18n.t("policyBlockedDescription"),
              content: policyDecision.reason,
            },
          ],
        }),
      );
      dispatch(acceptToolCall(toolCallState.toolCallId));
      const output = await dispatch(
        streamResponseAfterToolCall({
          toolCallId: toolCallState.toolCallId,
          toolOutput: [
            {
              name: i18n.t("policyBlockedName"),
              description: i18n.t("policyBlockedDescription"),
              content: `Blocked by policy: ${policyDecision.reason}`,
            },
          ],
          skipLlmContinue: arg?.skipContinue,
        }),
      );
      unwrapResult(output);
      return;
    }

    // Get view/read model if available
    const viewReadModel = state.config.config.selectedModelByRole.viewRead;
    
    // Get real-time search model if available
    const realTimeSearchModel = state.config.config.selectedModelByRole.realTimeSearch;

    dispatch(setCalling(toolCallState.toolCallId));

    // Determine preferred model based on tool type for dynamic switching with cost optimization
    const { isViewReadTool, isChatModelTool, isRealTimeSearchTool, shouldUseViewReadForToolResponse } = await import("core/tools/modelRouting");
    let preferredModel: 'chat' | 'viewRead' | 'realTimeSearch' | undefined = undefined;
    
    const toolResponseAnalysis = shouldUseViewReadForToolResponse(toolName, 0, 'auto');
    
    if (isRealTimeSearchTool(toolName) && realTimeSearchModel) {
      preferredModel = 'realTimeSearch';
    } else if (isChatModelTool(toolName)) {
      preferredModel = 'chat';
    } else if (isViewReadTool(toolName) && viewReadModel) {
      preferredModel = 'viewRead';
    } else if (toolResponseAnalysis.shouldUseViewRead && viewReadModel) {
      preferredModel = 'viewRead';
    }

    const resolvedToolCall = {
      ...toolCallState.toolCall,
      function: {
        ...toolCallState.toolCall.function,
        name: toolName,
      },
    };

    // ── Execute with retry ──────────────────────────────────────────────
    let lastError: string | undefined;
    let result: any;
    let attemptsUsed = 0;

    for (let attempt = 0; attempt <= TOOL_CALL_MAX_RETRIES; attempt++) {
      // User hit Stop: clearDanglingMessages marks the tool canceled.
      // Do not key off isStreaming — manual approve runs after the stream ends.
      if (isUserStoppedToolCall(resolveLive())) {
        return;
      }
      if (shouldAbortToolContinuation(resolveLive())) {
        return;
      }

      if (attempt > 0) {
        const delay = TOOL_CALL_BASE_DELAY_MS * Math.pow(TOOL_CALL_BACKOFF_MULTIPLIER, attempt - 1);
        console.warn(
          `[callTool] Retrying ${toolName} (attempt ${attempt + 1}/${TOOL_CALL_MAX_RETRIES + 1}) after ${delay}ms delay`,
        );
        await sleep(delay);
      }

      attemptsUsed = attempt + 1;
      const liveState = getState();
      const lastUser = [...liveState.session.history]
        .reverse()
        .find((item) => item.message.role === "user");
      result = await extra.ideMessenger.request("tools/call", {
        toolCall: resolvedToolCall,
        selectedModelTitle: defaultModel.title,
        viewReadModelTitle: viewReadModel?.title || null,
        realTimeSearchModelTitle: realTimeSearchModel?.title || null,
        preferredModel,
        sessionId: liveState.session.id,
        turnId: lastUser?.message.id ?? liveState.session.id,
      });

      // User Stop landed while Core was still executing — do not resume.
      if (isUserStoppedToolCall(resolveLive())) {
        return;
      }

      if (result.status === "success") {
        break; // Success — exit retry loop
      }

      lastError = formatToolCallIpcError(result);

      // Cancel/abort from Core: do not retry. If the GUI is still "calling"
      // this was not a user Stop — fall through and resume with an error.
      if (isCancelledToolError(lastError)) {
        break;
      }

      // Check if the error is retryable
      if (!isRetryableError(lastError ?? "") || attempt >= TOOL_CALL_MAX_RETRIES) {
        break; // Non-retryable or exhausted retries
      }
    }

    // User Stop after the last attempt: leave the turn ended.
    if (isUserStoppedToolCall(resolveLive())) {
      return;
    }

    // ── Handle final result ─────────────────────────────────────────────
    if (result?.status === "success") {
      const contextItems = result.content.contextItems;
      dispatch(
        setToolCallOutput({ toolCallId, output: contextItems }),
      );
      dispatch(acceptToolCall(toolCallId));

      const response = await dispatch(
        streamResponseAfterToolCall({
          toolCallId: toolCallState.toolCall.id,
          toolOutput: contextItems,
          skipLlmContinue: arg?.skipContinue,
        }),
      );
      unwrapResult(response);
    } else {
      const errorDetail = lastError ?? formatToolCallIpcError(result ?? {});
      const unexpectedAbort = shouldResumeAfterUnexpectedAbort(
        resolveLive(),
        errorDetail,
      );
      const errorItems = toolFailureOutput(toolName, errorDetail, {
        unexpectedAbort,
        retried: attemptsUsed > 1,
        attemptsUsed,
      });

      dispatch(setToolCallOutput({ toolCallId, output: errorItems }));
      // Always mark done on tool failure. `canceled` means the user hit Stop
      // (already returned above). Using cancel here made constructMessages
      // tell the model the user aborted, and runGuiAgentLoop treated it as
      // a hard abort — so a failed builtin_edit_file stopped the whole turn.
      dispatch(acceptToolCall(toolCallId));

      const output = await dispatch(
        streamResponseAfterToolCall({
          toolCallId: toolCallState.toolCallId,
          toolOutput: errorItems,
          skipLlmContinue: arg?.skipContinue,
        }),
      );
      unwrapResult(output);
    }
  },
);
