import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { BuiltInToolNames } from "core/tools/builtIn";

import { ThunkApiType } from "../store";
import { findPendingGeneratedToolCalls } from "../util";
import {
  DEFAULT_PERMISSION_MODE,
  isToolAutoApproved,
  resolvePermissionToolName,
} from "../util/permissionMode";
import { DEFAULT_TOOL_SETTING } from "../util/toolPermissionDefaults";

import { callTool } from "./callTool";
import { cancelTool } from "./cancelTool";
import {
  hasGuiToolApproval,
  resolveGuiToolApproval,
} from "../util/guiToolApproval";

/**
 * After the permissions list, session Always, or permission mode changes,
 * apply the new policy to any tool call waiting on Deny / Always / Approve.
 */
export const syncPendingToolPermissions = createAsyncThunk<
  void,
  void,
  ThunkApiType
>("chat/syncPendingToolPermissions", async (_, { dispatch, getState }) => {
  const pending = findPendingGeneratedToolCalls(getState().session.history);
  if (!pending.length) {
    return;
  }

  for (const pendingState of pending) {
    const toolName = resolvePermissionToolName(
      pendingState.toolCall.function.name,
    );
    if (!toolName || toolName === BuiltInToolNames.AskUser) {
      continue;
    }

    const latest = getState();
    const setting =
      latest.ui.toolSettings[toolName] ?? DEFAULT_TOOL_SETTING;
    if (setting === "disabled") {
      if (hasGuiToolApproval(pendingState.toolCallId)) {
        resolveGuiToolApproval(pendingState.toolCallId, false);
        continue;
      }
      unwrapResult(
        await dispatch(cancelTool({ toolCallId: pendingState.toolCallId })),
      );
      continue;
    }

    if (
      isToolAutoApproved({
        toolName,
        toolSettings: latest.ui.toolSettings,
        permissionMode: latest.ui.permissionMode ?? DEFAULT_PERMISSION_MODE,
        sessionAllowlist: latest.session.sessionToolAllowlist,
        args:
          pendingState.parsedArgs ?? pendingState.toolCall.function.arguments,
        policy: latest.config.config.experimental?.agentPolicy,
        policyFromRules:
          latest.config.config.experimental?.agentPolicyFromRules,
        workspaceDirs: window.workspacePaths,
      })
    ) {
      if (hasGuiToolApproval(pendingState.toolCallId)) {
        resolveGuiToolApproval(pendingState.toolCallId, true);
        continue;
      }
      unwrapResult(
        await dispatch(callTool({ toolCallId: pendingState.toolCallId })),
      );
    }
  }
});
