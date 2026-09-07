import { createAsyncThunk } from "@reduxjs/toolkit";

import {
  hydrateReasoningEffort,
  setReasoningEffort,
} from "../slices/uiSlice";
import { ThunkApiType } from "../store";

export const loadReasoningEffortPrefs = createAsyncThunk<
  void,
  void,
  ThunkApiType
>("ui/loadReasoningEffortPrefs", async (_, { dispatch, extra, getState }) => {
  const localByModel = getState().ui.reasoningEffortByModel ?? {};
  const localEffort = getState().ui.reasoningEffort;
  const result = await extra.ideMessenger.request(
    "ui/getReasoningEffortPrefs",
    undefined,
  );
  if (result.status !== "success") {
    return;
  }

  const fromDisk = result.content;
  const diskEmpty =
    !fromDisk.lastEffort && Object.keys(fromDisk.byModel ?? {}).length === 0;
  const localHasData =
    Boolean(localEffort) || Object.keys(localByModel).length > 0;

  dispatch(
    hydrateReasoningEffort({
      lastEffort: localEffort ?? fromDisk.lastEffort,
      byModel: { ...(fromDisk.byModel ?? {}), ...localByModel },
    }),
  );

  if (diskEmpty && localHasData) {
    extra.ideMessenger.post("ui/updateReasoningEffortPrefs", {
      lastEffort: localEffort,
      byModel: localByModel,
    });
  }
});

export const saveReasoningEffort = createAsyncThunk<
  void,
  { effort: string; modelKeys?: string[] },
  ThunkApiType
>(
  "ui/saveReasoningEffort",
  async ({ effort, modelKeys }, { dispatch, extra }) => {
    dispatch(setReasoningEffort({ effort, modelKeys }));
    extra.ideMessenger.post("ui/updateReasoningEffortPrefs", {
      lastEffort: effort,
      byModel: Object.fromEntries(
        (modelKeys ?? []).map((key) => [key, effort]),
      ),
    });
  },
);
