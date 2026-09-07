import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import {
  abortStream,
  clearDanglingMessages,
  setInactive,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";

import { saveCurrentSession } from "./session";
import { runAgentJobAction } from "./agentJobs";
import { rejectGuiLoopWaiters } from "../util/guiToolApproval";

/**
 * User-initiated stop: abort LLM stream, cancel dangling tool UI, kill
 * in-flight tools (terminal, builtin_task children, background shells),
 * and reject half-applied streaming diffs.
 */
export const cancelStream = createAsyncThunk<void, undefined, ThunkApiType>(
  "chat/cancelStream",
  async (_arg, { dispatch, extra, getState }) => {
    dispatch(setInactive());
    dispatch(abortStream());
    rejectGuiLoopWaiters();

    const sessionId = getState().session.id;
    void extra.ideMessenger
      .request("brain/cancelAutonomousLoop", { sessionId })
      .catch(() => {});

    // Drop incomplete assistant/thinking turns and cancel dangling tool calls
    // (including mid-flight "calling") without breaking prior tool-result pairs.
    dispatch(clearDanglingMessages());

    // Stop Core-side tool execution (terminal SIGTERM, middleware abort, etc.).
    try {
      extra.ideMessenger.post("tools/cancel", undefined);
    } catch (e) {
      console.error("Failed to post tools/cancel:", e);
    }

    // tools/cancel also kills jobs, but refresh the panel even if the post
    // raced or a detached shell/task was not in activeToolAborts.
    try {
      unwrapResult(await dispatch(runAgentJobAction({ action: "killAll" })));
    } catch (e) {
      console.error("Failed to kill background jobs on cancel:", e);
    }

    // Reject half-applied streaming edits so files are not left mid-diff.
    const streamingApplies = getState().session.codeBlockApplyStates.states.filter(
      (state) => state.status === "streaming" && !!state.filepath,
    );
    for (const apply of streamingApplies) {
      try {
        extra.ideMessenger.post("rejectDiff", {
          filepath: apply.filepath!,
          streamId: apply.streamId,
        });
      } catch (e) {
        console.error("Failed to reject streaming apply on cancel:", e);
      }
    }

    // Auto-save session after canceling stream to ensure partial responses are persisted
    try {
      const result = await dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: false, // Don't generate title on cancel
        }),
      );
      unwrapResult(result);
    } catch (e) {
      console.error("Failed to auto-save session after cancel:", e);
    }
  },
);
