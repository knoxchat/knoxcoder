import { ToolCallState } from "core";

/**
 * True when an in-flight tool should not continue the agent loop.
 * After cancelStream / clearDanglingMessages the status becomes "canceled".
 */
export function shouldAbortToolContinuation(
  toolCallState: ToolCallState | undefined,
): boolean {
  return !toolCallState || toolCallState.status !== "calling";
}

/**
 * User hit Stop (cancelStream → clearDanglingMessages).
 * A missing state is a lookup miss, not a Stop — treating it as Stop
 * aborted the agent after edit/write tools. Unexpected Core/IPC abort
 * leaves status as "calling".
 */
export function isUserStoppedToolCall(
  toolCallState: ToolCallState | undefined,
): boolean {
  return toolCallState?.status === "canceled";
}

/**
 * Core returned a cancel/abort error, but the GUI still thinks the tool is
 * in-flight — so this was not a user Stop. Resume with an error tool result.
 */
export function shouldResumeAfterUnexpectedAbort(
  toolCallState: ToolCallState | undefined,
  errorMessage: string | undefined,
): boolean {
  return (
    isCancelledToolError(errorMessage) && toolCallState?.status === "calling"
  );
}

export function isCancelledToolError(errorMessage: string | undefined): boolean {
  if (!errorMessage) {
    return false;
  }
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("aborted")
  );
}
