import { ChatHistoryItem, ToolCallState } from "core";

import { RootState } from "../store";
import { primaryToolCallState } from "./mergeToolCallDeltas";

export function getHistoryToolStates(
  item: RootState["session"]["history"][number] | ChatHistoryItem | undefined,
): ToolCallState[] {
  if (!item) {
    return [];
  }
  if (item.toolCallStates?.length) {
    return item.toolCallStates;
  }
  return item.toolCallState ? [item.toolCallState] : [];
}

export function findCurrentToolCall(
  state: RootState["session"]["history"],
): ToolCallState | undefined {
  for (let i = state.length - 1; i >= 0; i--) {
    const states = getHistoryToolStates(state[i]);
    if (states.length) {
      return primaryToolCallState(states);
    }
  }
  return undefined;
}

export function findToolCallStateById(
  history: RootState["session"]["history"],
  toolCallId: string,
): ToolCallState | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const match = getHistoryToolStates(history[i]).find(
      (state) => state.toolCallId === toolCallId,
    );
    if (match) {
      return match;
    }
  }
  return undefined;
}

export function findPendingGeneratedToolCalls(
  history: RootState["session"]["history"],
): ToolCallState[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const states = getHistoryToolStates(history[i]);
    if (states.length) {
      return states.filter((state) => state.status === "generated");
    }
  }
  return [];
}

export function hasUnsettledToolCalls(
  history: RootState["session"]["history"],
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const states = getHistoryToolStates(history[i]);
    if (states.length) {
      return states.some(
        (state) =>
          state.status === "generating" ||
          state.status === "generated" ||
          state.status === "calling",
      );
    }
  }
  return false;
}
