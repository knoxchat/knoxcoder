import { createAsyncThunk } from "@reduxjs/toolkit";
import { ChatHistoryItem } from "core";
import {
  extractSoulFiles,
  formatSettledToolSummary,
} from "core/context/soul";
import { renderChatMessage } from "core/util/messageContent";

import StreamErrorDialog from "../../pages/gui/StreamError";
import { clearDanglingMessages, setInactive } from "../slices/sessionSlice";
import { setDialogMessage, setShowDialog } from "../slices/uiSlice";
import { ThunkApiType } from "../store";
import { getHistoryToolStates } from "../util";

import { saveCurrentSession } from "./session";

function collectTurnToolSummary(history: ChatHistoryItem[]): string {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user") {
      start = i;
      break;
    }
  }
  const tools = [];
  for (let i = start; i < history.length; i++) {
    for (const state of getHistoryToolStates(history[i])) {
      const name = state.toolCall.function.name;
      tools.push({
        name,
        status: state.status,
        files: extractSoulFiles(
          name,
          state.parsedArgs ?? state.toolCall.function.arguments,
        ),
        ok: state.status === "done",
      });
    }
  }
  return formatSettledToolSummary(tools);
}

let wrapperDepth = 0;

export const streamThunkWrapper = createAsyncThunk<
  void,
  () => Promise<void>,
  ThunkApiType
>("chat/streamWrapper", async (runStream, { dispatch, extra, getState }) => {
  wrapperDepth += 1;
  try {
    await runStream();
  } catch (e: unknown) {
    dispatch(clearDanglingMessages());
    dispatch(setDialogMessage(<StreamErrorDialog error={e} />));
    dispatch(setShowDialog(true));
  } finally {
    wrapperDepth -= 1;

    // Memory finalization only fires on the outermost wrapper exit —
    // nested exits happen after every tool-call round and would duplicate.
    const isOutermostExit = wrapperDepth === 0;

    // ── Record assistant turn in the Memory Brain (best-effort) ──
    if (isOutermostExit) {
      try {
        const history = getState().session.history;
        const lastAssistant = [...history]
          .reverse()
          .find((item) => item.message.role === "assistant");
        const assistantContent = lastAssistant
          ? renderChatMessage(lastAssistant.message)
          : "";
        if (assistantContent) {
          void extra.ideMessenger
            .request("brain/recordMessage", {
              sessionId: getState().session.id,
              role: "assistant",
              content: assistantContent,
            })
            .catch(() => {});
        }
      } catch {
        // Memory recording is best-effort
      }
    }

    // ── Post-turn write for substantial turns ──
    const postState = getState();
    if (isOutermostExit) {
      try {
        const history = postState.session.history;
        const lastUser = [...history]
          .reverse()
          .find((item) => item.message.role === "user");
        const lastAssistant = [...history]
          .reverse()
          .find((item) => item.message.role === "assistant");
        const userMessage = lastUser
          ? renderChatMessage(lastUser.message)
          : "";
        const assistantMessage = lastAssistant
          ? renderChatMessage(lastAssistant.message)
          : "";
        const toolSummary = collectTurnToolSummary(history);
        let postTurnMinChars = 80;
        try {
          const cfgResult = await extra.ideMessenger.request(
            "brain/getConfig",
            undefined,
          );
          if (cfgResult.status === "success") {
            const min = (cfgResult.content as any)?.config?.post_turn_min_chars;
            if (typeof min === "number" && min >= 0) {
              postTurnMinChars = min;
            }
          }
        } catch {
          // Use default threshold
        }
        const substantial =
          userMessage.length + assistantMessage.length >= postTurnMinChars ||
          !!lastAssistant?.toolCallState ||
          !!toolSummary;
        if (substantial && (userMessage || assistantMessage || toolSummary)) {
          let workspaceDir = "";
          try {
            const dirs = await extra.ideMessenger.ide.getWorkspaceDirs();
            workspaceDir = dirs[0] ?? "";
          } catch {
            // Best-effort workspace path
          }
          void extra.ideMessenger
            .request("memory/postTurn", {
              sessionId: postState.session.id,
              userMessage,
              assistantMessage,
              toolSummary: toolSummary || undefined,
              title: postState.session.title,
              workspaceDir,
            })
            .catch(() => {});
        }
      } catch {
        // Post-turn memory is best-effort
      }
    }

    // Nested tool-result wrappers (skipContinue / runAgentLoop) must not
    // drop isStreaming or the next LLM round aborts. Only the outermost
    // chat turn marks the session idle. Still persist after each tool so a
    // long kernel loop is not lost on crash.
    if (isOutermostExit) {
      dispatch(setInactive());
    }
    const state = getState();
    await dispatch(
      saveCurrentSession({
        openNewSession: false,
        generateTitle: isOutermostExit && state.session.mode === "chat",
      }),
    );
  }
});
