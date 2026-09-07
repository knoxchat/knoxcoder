import { createAsyncThunk } from "@reduxjs/toolkit";
import type { AgentJobUpdate } from "core/protocol/agentJobs";

import { setBackgroundJobs } from "../slices/uiSlice";
import { ThunkApiType } from "../store";

export const refreshAgentJobs = createAsyncThunk<void, void, ThunkApiType>(
  "ui/refreshAgentJobs",
  async (_, { dispatch, extra }) => {
    const result = await extra.ideMessenger.request("agent/jobs", {
      action: "list",
    });
    if (result.status === "error") {
      return;
    }
    dispatch(setBackgroundJobs(result.content.jobs ?? []));
  },
);

export const runAgentJobAction = createAsyncThunk<
  void,
  { action: "kill" | "killAll" | "dismiss" | "clear"; jobId?: string },
  ThunkApiType
>("ui/runAgentJobAction", async ({ action, jobId }, { dispatch, extra }) => {
  const result = await extra.ideMessenger.request("agent/jobs", {
    action,
    jobId,
  });
  if (result.status === "error") {
    return;
  }
  dispatch(setBackgroundJobs(result.content.jobs ?? []));
});

export const applyAgentJobUpdate = createAsyncThunk<
  void,
  AgentJobUpdate,
  ThunkApiType
>("ui/applyAgentJobUpdate", async (payload, { dispatch }) => {
  dispatch(setBackgroundJobs(payload.jobs ?? []));
});
