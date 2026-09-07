import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ChatMessage, ContextItem } from "core";
import { constructMessages } from "core/llm/constructMessages";
import { renderContextItems } from "core/util/messageContent";

import { selectDefaultModel } from "../slices/configSlice";
import {
  addContextItemsAtIndex,
  incrementToolLoopSteps,
  setActive,
  streamUpdate,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { hasUnsettledToolCalls } from "../util";

import {
  getInjectedSystemContext,
  mergeInjectIntoMessages,
} from "./injectedContextCache";
import { resetStateForNewMessage } from "./resetStateForNewMessage";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";

export const streamResponseAfterToolCall = createAsyncThunk<
  void,
  {
    toolCallId: string;
    toolOutput: ContextItem[];
    skipLlmContinue?: boolean;
  },
  ThunkApiType
>(
  "chat/streamAfterToolCall",
  async ({ toolCallId, toolOutput, skipLlmContinue }, { dispatch, getState }) => {
    await dispatch(
      streamThunkWrapper(async () => {
        const state = getState();
        const initialHistory = state.session.history;
        const defaultModel = selectDefaultModel(state);

        if (!defaultModel) {
          throw new Error("No model selected");
        }

        resetStateForNewMessage();

        await new Promise((resolve) => setTimeout(resolve, 0));

        const newMessage: ChatMessage = {
          role: "tool",
          content: renderContextItems(toolOutput),
          toolCallId,
        };
        dispatch(streamUpdate([newMessage]));
        dispatch(
          addContextItemsAtIndex({
            index: initialHistory.length,
            contextItems: toolOutput.map((contextItem) => ({
              ...contextItem,
              id: {
                providerTitle: "toolCall",
                itemId: toolCallId,
              },
            })),
          }),
        );

        dispatch(setActive());

        if (
          skipLlmContinue ||
          hasUnsettledToolCalls(getState().session.history)
        ) {
          return;
        }

        // Count this completed tool→continue cycle toward agent.maxSteps.
        dispatch(incrementToolLoopSteps());

        const updatedHistory = getState().session.history;
        let messages = constructMessages(
          [...updatedHistory],
          getState().session.id,
        );

        // Re-inject the memory/plan context from the start of this turn.
        // History never contains the injected system message, so without
        // this every tool round silently drops the memory context.
        // Merge into the leading system message (compileChatMessages keeps it).
        const injectedContext = getInjectedSystemContext(
          getState().session.id,
        );
        if (injectedContext) {
          messages = mergeInjectIntoMessages(messages, injectedContext);
        }

        unwrapResult(await dispatch(streamNormalInput({ messages })));
      }),
    );
  },
);

/** Resume the model after a parallel tool batch already wrote tool result messages. */
export const continueAfterToolBatch = createAsyncThunk<
  void,
  undefined,
  ThunkApiType
>("chat/continueAfterToolBatch", async (_, { dispatch, getState }) => {
  await dispatch(
    streamThunkWrapper(async () => {
      if (hasUnsettledToolCalls(getState().session.history)) {
        return;
      }
      const defaultModel = selectDefaultModel(getState());
      if (!defaultModel) {
        throw new Error("No model selected");
      }
      dispatch(setActive());
      dispatch(incrementToolLoopSteps());
      let messages = constructMessages(
        [...getState().session.history],
        getState().session.id,
      );
      const injectedContext = getInjectedSystemContext(getState().session.id);
      if (injectedContext) {
        messages = mergeInjectIntoMessages(messages, injectedContext);
      }
      unwrapResult(await dispatch(streamNormalInput({ messages })));
    }),
  );
});
