import { createAsyncThunk } from "@reduxjs/toolkit";

import { setWorktreeBusy, setWorktreeState } from "../slices/uiSlice";
import { ThunkApiType } from "../store";

type WorktreeAction = "enter" | "apply" | "discard" | "status";

function idleWorktree(error?: string) {
  return {
    enabled: false,
    busy: false,
    files: [] as string[],
    error,
  };
}

export const runAgentWorktree = createAsyncThunk<
  void,
  WorktreeAction,
  ThunkApiType
>("ui/runAgentWorktree", async (action, { dispatch, extra, getState }) => {
  dispatch(setWorktreeBusy(true));
  try {
    const sessionId = getState().session.id;
    const result = await extra.ideMessenger.request("agent/worktree", {
      action,
      sessionId,
    });
    if (result.status === "error") {
      dispatch(
        setWorktreeState({
          ...getState().ui.worktree,
          busy: false,
          error: result.error,
        }),
      );
      return;
    }
    const payload = result.content;
    if (!payload.ok || !payload.state?.enabled) {
      dispatch(
        setWorktreeState(
          idleWorktree(payload.ok ? undefined : payload.error),
        ),
      );
      return;
    }
    dispatch(
      setWorktreeState({
        enabled: true,
        busy: false,
        branch: payload.state.branch,
        path: payload.state.path,
        files: payload.state.files ?? [],
        error: payload.error,
      }),
    );
  } catch (error) {
    dispatch(
      setWorktreeState({
        ...getState().ui.worktree,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});
