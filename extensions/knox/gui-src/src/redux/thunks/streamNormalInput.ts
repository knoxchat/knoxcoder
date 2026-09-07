import { createAsyncThunk } from "@reduxjs/toolkit";
import { ChatMessage } from "core";
import { modelSupportsTools } from "core/llm/autodetect";
import { ToCoreProtocol } from "core/protocol";

import { selectDefaultModel } from "../slices/configSlice";
import {
  abortStream,
  addPromptCompletionPair,
  recoverTextToolCalls,
  selectUseTools,
  streamUpdate,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { resolveReasoningEffort } from "../../util/reasoningEffort";
import { modelSupportsWebSearch } from "../../util/webSearch";

import { runGuiAgentLoop } from "./runGuiAgentLoop";

export const streamNormalInput = createAsyncThunk<
  void,
  {
    messages: ChatMessage[];
    legacySlashCommandData?: ToCoreProtocol["llm/streamChat"][0]["legacySlashCommandData"];
  },
  ThunkApiType
>(
  "chat/streamNormalInput",
  async (
    { messages, legacySlashCommandData },
    { dispatch, extra, getState },
  ) => {
    const state = getState();
    const defaultModel = selectDefaultModel(state);
    const streamAborter = state.session.streamAborter;
    const useTools = selectUseTools(state);
    if (!defaultModel) {
      throw new Error("Default model not defined");
    }

    if (useTools && modelSupportsTools(defaultModel)) {
      await runGuiAgentLoop({
        messages,
        legacySlashCommandData,
        dispatch,
        extra,
        getState,
      });
      return;
    }

    const reasoningEffort = resolveReasoningEffort(
      defaultModel,
      state.ui.reasoningEffortByModel ?? {},
      state.ui.reasoningEffort,
    );
    const webSearchSupported = modelSupportsWebSearch(defaultModel);
    const completionOptions: ToCoreProtocol["llm/streamChat"][0]["completionOptions"] =
      {
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(webSearchSupported ? { webSearch: state.ui.webSearchEnabled } : {}),
      };

    const gen = extra.ideMessenger.llmStreamChat(
      {
        completionOptions,
        title: defaultModel.title,
        messages,
        legacySlashCommandData,
      },
      streamAborter.signal,
    );

    let next = await gen.next();
    while (!next.done) {
      if (!getState().session.isStreaming) {
        dispatch(abortStream());
        break;
      }

      dispatch(streamUpdate(next.value));
      next = await gen.next();
    }

    if (next.done && next.value) {
      dispatch(addPromptCompletionPair([next.value]));

      try {
        if (state.session.mode === "chat") {
          extra.ideMessenger.post("devdata/log", {
            name: "chatInteraction",
            data: {
              prompt: next.value.prompt,
              completion: next.value.completion,
              modelProvider: defaultModel.provider,
              modelTitle: defaultModel.title,
              sessionId: state.session.id,
            },
          });
        }
      } catch (e) {
        console.error("Failed to send development data interaction log", e);
      }
    }

    dispatch(recoverTextToolCalls());
  },
);
