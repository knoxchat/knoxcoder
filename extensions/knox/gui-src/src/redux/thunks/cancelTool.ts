import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import { selectCurrentToolCall } from "../selectors/selectCurrentToolCall";
import { cancelToolCall } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { findToolCallStateById } from "../util";
import { recordGuiSoulEvent } from "../util/recordSoulEvent";

import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";
import {
  hasGuiAskUserWaiter,
  hasGuiToolApproval,
  resolveGuiAskUser,
  resolveGuiToolApproval,
} from "../util/guiToolApproval";

export const cancelTool = createAsyncThunk<
  void,
  { toolCallId?: string } | undefined,
  ThunkApiType
>("chat/cancelTool", async (arg, { dispatch, extra, getState }) => {
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

  if (state.session.autonomousLoop.status === "running") {
    await extra.ideMessenger.request("brain/resolveAutonomousTool", {
      sessionId: state.session.id,
      callId: toolCallState.toolCallId,
      allow: false,
    });
    return;
  }

  if (hasGuiToolApproval(toolCallState.toolCallId)) {
    resolveGuiToolApproval(toolCallState.toolCallId, false);
    return;
  }

  if (hasGuiAskUserWaiter(toolCallState.toolCallId)) {
    resolveGuiAskUser(toolCallState.toolCallId, null);
    return;
  }

  dispatch(cancelToolCall(toolCallState.toolCallId));

  const toolName = toolCallState.toolCall.function.name;
  recordGuiSoulEvent(extra.ideMessenger, {
    sessionId: state.session.id,
    kind: "tool_denied",
    toolName,
    policy: "deny",
    summary: `User denied ${toolName}`,
  });

  const output = await dispatch(
    streamResponseAfterToolCall({
      toolCallId: toolCallState.toolCallId,
      toolOutput: [
        {
          name: "Tool call cancelled",
          description: "Tool call cancelled",
          content:
            "The tool call has been cancelled by the user. Please try another action or request further instructions.",
          hidden: true,
        },
      ],
    }),
  );
  unwrapResult(output);
});
