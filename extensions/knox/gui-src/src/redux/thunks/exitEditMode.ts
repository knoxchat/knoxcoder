import { createAsyncThunk } from "@reduxjs/toolkit";
import { MessageModes } from "core";

import { setEditDone } from "../slices/editModeState";
import {
  clearCodeToEdit,
  selectIsInEditMode,
  selectIsSingleRangeEditOrInsertion,
  setMainEditorContentTrigger,
  setMode,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";

export const exitEditMode = createAsyncThunk<
  void,
  { nextMode?: MessageModes } | undefined,
  ThunkApiType
>(
  "edit/complete",
  async (payload, { dispatch, extra, getState }) => {
    const state = getState();
    const isInEditMode = selectIsInEditMode(state);
    const codeToEdit = state.session.codeToEdit;
    const isSingleRangeEditOrInsertion =
      selectIsSingleRangeEditOrInsertion(state);

    if (!isInEditMode) {
      return;
    }

    dispatch(setMode(payload?.nextMode ?? "chat"));

    for (const code of codeToEdit) {
      extra.ideMessenger.post("rejectDiff", {
        filepath: code.filepath,
      });
    }

    dispatch(clearCodeToEdit());
    dispatch(setEditDone());
    dispatch(setMainEditorContentTrigger(undefined));

    extra.ideMessenger.post("edit/exit", {
      shouldFocusEditor: isSingleRangeEditOrInsertion,
    });
  },
);
