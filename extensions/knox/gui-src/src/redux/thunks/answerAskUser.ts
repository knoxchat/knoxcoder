import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";

import { findToolCallStateById } from "../util";
import {
  acceptToolCall,
  setToolCallOutput,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import {
  formatAskUserAnswers,
  parseAskUserQuestions,
} from "core/tools/implementations/askUser";

import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";
import {
  hasGuiAskUserWaiter,
  resolveGuiAskUser,
} from "../util/guiToolApproval";

export const answerAskUser = createAsyncThunk<
  void,
  { toolCallId: string; answers: Record<string, string | string[]> },
  ThunkApiType
>("chat/answerAskUser", async ({ toolCallId, answers }, { dispatch, extra, getState }) => {
  const session = getState().session;
  const state = findToolCallStateById(session.history, toolCallId);
  if (!state || state.status !== "generated") {
    return;
  }

  const questions = parseAskUserQuestions(
    state.parsedArgs?.questions ?? [],
  );
  const content = formatAskUserAnswers(questions, answers);
  void extra.ideMessenger
    .request("brain/recordSoulEvent", {
      sessionId: session.id,
      kind: "tool_success",
      toolName: "builtin_ask_user",
      files: [],
      ok: true,
      summary: content,
    })
    .catch(() => {});
  void extra.ideMessenger
    .request("brain/store", {
      category: "decision",
      title: `User decision: ${questions[0]?.prompt?.slice(0, 80) || "ask_user"}`,
      content,
      keywords: "ask-user,decision",
      importance: 0.7,
      session_id: session.id,
    })
    .catch(() => {});
  const output = [
    {
      name: "answers",
      description: `Answered ${questions.length} question${
        questions.length === 1 ? "" : "s"
      }`,
      content,
    },
  ];

  dispatch(setToolCallOutput({ toolCallId, output }));
  dispatch(acceptToolCall(toolCallId));

  if (hasGuiAskUserWaiter(toolCallId)) {
    unwrapResult(
      await dispatch(
        streamResponseAfterToolCall({
          toolCallId,
          toolOutput: output,
          skipLlmContinue: true,
        }),
      ),
    );
    resolveGuiAskUser(toolCallId, output);
    return;
  }

  unwrapResult(
    await dispatch(
      streamResponseAfterToolCall({
        toolCallId,
        toolOutput: output,
      }),
    ),
  );
});
