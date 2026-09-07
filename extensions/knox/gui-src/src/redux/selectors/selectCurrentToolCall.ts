import { createSelector } from "@reduxjs/toolkit";
import { BuiltInToolNames } from "core/tools/builtIn";

import { RootState } from "../store";
import { findCurrentToolCall } from "../util";
import {
  DEFAULT_PERMISSION_MODE,
  isToolAutoApproved,
  resolvePermissionToolName,
} from "../util/permissionMode";

export const selectCurrentToolCall = createSelector(
  (store: RootState) => store.session.history,
  (history) => {
    return findCurrentToolCall(history);
  },
);

/** True when the pending generated tool should run with no Deny/Always/Approve UI. */
export function selectIsCurrentToolAutoApproved(state: RootState): boolean {
  const toolCallState = findCurrentToolCall(state.session.history);
  if (!toolCallState || toolCallState.status !== "generated") {
    return false;
  }
  const toolName = resolvePermissionToolName(
    toolCallState.toolCall.function.name,
  );
  if (!toolName || toolName === BuiltInToolNames.AskUser) {
    return false;
  }
  return isToolAutoApproved({
    toolName,
    toolSettings: state.ui.toolSettings,
    permissionMode: state.ui.permissionMode ?? DEFAULT_PERMISSION_MODE,
    sessionAllowlist: state.session.sessionToolAllowlist,
    args:
      toolCallState.parsedArgs ?? toolCallState.toolCall.function.arguments,
    policy: state.config.config.experimental?.agentPolicy,
    policyFromRules: state.config.config.experimental?.agentPolicyFromRules,
    workspaceDirs:
      typeof window !== "undefined" ? window.workspacePaths : undefined,
  });
}
