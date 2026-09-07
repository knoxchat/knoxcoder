import { createAsyncThunk } from "@reduxjs/toolkit";
import { MessageModes } from "core";

import { selectCurrentMode, setMode } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { exitEditMode } from "./exitEditMode";
import {
  loadLastSession,
  saveCurrentSession,
} from "./session";

/**
 * Single path for Chat / Agent / Edit tab changes.
 * Keeps VS Code AgentModeManager in sync with session.mode === "agent".
 */
export const setSessionMode = createAsyncThunk<
  void,
  MessageModes,
  ThunkApiType
>("session/setSessionMode", async (newMode, { dispatch, extra, getState }) => {
  const state = getState();
  const current = selectCurrentMode(state);
  if (newMode === current || state.session.isStreaming) {
    return;
  }

  if (current === "edit" && newMode !== "edit") {
    await dispatch(
      loadLastSession({
        saveCurrentSession: false,
      }),
    );
    await dispatch(exitEditMode({ nextMode: newMode }));
  } else {
    dispatch(setMode(newMode));
    if (newMode === "edit") {
      await dispatch(
        saveCurrentSession({
          generateTitle: false,
          openNewSession: true,
        }),
      );
    }
  }

  if (newMode === "agent") {
    extra.ideMessenger.post("setAgentMode", {
      active: true,
      sessionId: getState().session.id,
    });
  } else if (current === "agent") {
    extra.ideMessenger.post("setAgentMode", {
      active: false,
      sessionId: getState().session.id,
    });
  }
});
