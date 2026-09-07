/**
 * startAutonomousLoop — GUI entry point for local autonomous execution (IMP-24).
 *
 * Runs the core loop via brain/runAutonomousLoop.
 */

import { createAsyncThunk } from "@reduxjs/toolkit";
import i18next from "i18next";

import { selectDefaultModel } from "../slices/configSlice";
import { ThunkApiType } from "../store";
import { DEFAULT_PERMISSION_MODE } from "../util/permissionMode";

export const startAutonomousLoop = createAsyncThunk<
  {
    success: boolean;
    iterations: number;
    final_result: string;
    cancelled: boolean;
    checkpoints_created: number;
  },
  { goal: string; sessionId: string; maxIterations?: number },
  ThunkApiType
>(
  "autonomous/startLoop",
  async ({ goal, sessionId, maxIterations }, { extra, getState }) => {
    const state = getState();
    const defaultModel = selectDefaultModel(state);

    const response = await extra.ideMessenger.request("brain/runAutonomousLoop", {
      sessionId,
      goal,
      maxIterations,
      modelTitle: defaultModel?.title,
      permissionMode: state.ui.permissionMode ?? DEFAULT_PERMISSION_MODE,
      toolSettings: state.ui.toolSettings,
      sessionAllowlist: state.session.sessionToolAllowlist,
    });

    if (response.status !== "success") {
      throw new Error(response.error ?? i18next.t("autonomousLoopFailed"));
    }

    return response.content;
  },
);

export const cancelAutonomousLoop = createAsyncThunk<
  boolean,
  { sessionId: string },
  ThunkApiType
>("autonomous/cancelLoop", async ({ sessionId }, { extra }) => {
  const response = await extra.ideMessenger.request(
    "brain/cancelAutonomousLoop",
    { sessionId },
  );
  if (response.status !== "success") {
    return false;
  }
  return response.content.cancelled;
});

/** Registered slash command name for local autonomous loop (IMP-24). */
export const AUTONOMOUS_SLASH_COMMAND = "autonomous";

/** True when user message requests autonomous mode. */
export function isAutonomousCommand(text: string): boolean {
  return new RegExp(`^\\/?${AUTONOMOUS_SLASH_COMMAND}\\b`, "i").test(text.trim());
}

/** Strip the /autonomous prefix and return the goal text. */
export function parseAutonomousGoal(text: string): string {
  return text.replace(new RegExp(`^\\/?${AUTONOMOUS_SLASH_COMMAND}\\s+`, "i"), "").trim();
}
