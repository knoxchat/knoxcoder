import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ChatMessage, Session, SessionMetadata } from "core";
import { NEW_SESSION_TITLE } from "core/util/constants";
import { renderChatMessage } from "core/util/messageContent";

import { IIdeMessenger } from "../../context/IdeMessenger";
import { selectDefaultModel } from "../slices/configSlice";
import {
  deleteSessionMetadata,
  newSession,
  setAllSessionMetadata,
  updateSessionMetadata,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";

const MAX_TITLE_LENGTH = 100;

// Async session functions live in thunks (because of IDE messaging mostly)
// see sessionSlice for sync redux session functions

export async function getSession(
  ideMessenger: IIdeMessenger,
  id: string,
): Promise<Session> {
  const result = await ideMessenger.request("history/load", { id });
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.content;
}

export const refreshSessionMetadata = createAsyncThunk<
  SessionMetadata[],
  {
    offset?: number;
    limit?: number;
  },
  ThunkApiType
>("session/refreshMetadata", async ({ offset, limit }, { dispatch, extra }) => {
  // Get the current workspace directory
  const currentWorkspace = window.workspacePaths?.[0] || "";
  
  const result = await extra.ideMessenger.request("history/list", {
    limit,
    offset,
    workspaceDirectory: currentWorkspace,
  });
  if (result.status === "error") {
    throw new Error(result.error);
  }
  dispatch(setAllSessionMetadata(result.content));
  return result.content;
});

export const deleteSession = createAsyncThunk<void, string, ThunkApiType>(
  "session/delete",
  async (id, { getState, dispatch, extra }) => {
    dispatch(deleteSessionMetadata(id)); // optimistic
    const state = getState();
    if (id === state.session.id) {
      await dispatch(
        loadLastSession({
          saveCurrentSession: false,
        }),
      );
    }
    const result = await extra.ideMessenger.request("history/delete", { id });
    if (result.status === "error") {
      throw new Error(result.error);
    }
    dispatch(refreshSessionMetadata({}));
  },
);

export const updateSession = createAsyncThunk<void, Session, ThunkApiType>(
  "session/update",
  async (session, { extra, dispatch }) => {
    dispatch(
      updateSessionMetadata({
        sessionId: session.sessionId,
        title: session.title,
      }),
    ); // optimistic session metadata update
    await extra.ideMessenger.request("history/save", session);
    await dispatch(refreshSessionMetadata({}));
  },
);

/*
 this is only used for the custom focusKnoxSessionId command at the moment
*/
export const loadSession = createAsyncThunk<
  void,
  {
    sessionId: string;
    saveCurrentSession: boolean;
  },
  ThunkApiType
>(
  "session/load",
  async (
    { sessionId, saveCurrentSession: save },
    { extra, dispatch, getState },
  ) => {
    const previousSessionId = getState().session.id;
    if (save) {
      const result = await dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: true,
        }),
      );
      unwrapResult(result);
    }
    // Close the session we're leaving in the Memory Brain so it gets
    // topic-flushed, summarized, and its working memory persisted.
    // Fire-and-forget — memory must never block session switching.
    if (previousSessionId && previousSessionId !== sessionId) {
      void extra.ideMessenger
        .request("brain/dispatch", {
          action: "close_session",
          session_id: previousSessionId,
        })
        .catch(() => {});
    }
    const session = await getSession(extra.ideMessenger, sessionId);
    dispatch(newSession(session));

    // Restore working memory for the loaded session before the next send.
    // Await briefly so reopen isn't a silent no-op; don't block UI long.
    try {
      const dirs = await extra.ideMessenger.ide.getWorkspaceDirs();
      await Promise.race([
        extra.ideMessenger.request("brain/trackSession", {
          sessionId,
          title: session.title || "",
          workspaceDir: dirs[0] ?? "",
        }),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch {
      // Best-effort WM restore
    }
  },
);

export const loadLastSession = createAsyncThunk<
  void,
  {
    saveCurrentSession: boolean;
  },
  ThunkApiType
>(
  "session/loadLast",
  async ({ saveCurrentSession: shouldSave }, { extra, dispatch, getState }) => {
    const state = getState();
    const previousSessionId = state.session.id;

    if (state.session.id && shouldSave) {
      // Save current session before loading last one
      try {
        const result = await dispatch(
          saveCurrentSession({
            openNewSession: false,
            generateTitle: true,
          }),
        );
        unwrapResult(result);
      } catch (e) {
        console.error("Error saving current session:", e);
      }
    }
    
    // Get the current workspace directory
    const currentWorkspace = window.workspacePaths?.[0] || "";
    
    // Only try to load workspace-specific sessions if we have a workspace
    if (!currentWorkspace) {
      dispatch(newSession());
      return;
    }
    
    // Get all sessions for the current workspace
    const result = await extra.ideMessenger.request("history/list", {
      workspaceDirectory: currentWorkspace,
      limit: 1, // We only need the most recent one
    });
    
    if (result.status === "error") {
      console.error("Error loading sessions:", result.error);
      dispatch(newSession());
      return;
    }
    
    const sessions = result.content;
    if (!sessions || sessions.length === 0) {
      // No sessions exist for this workspace, create a new one
      console.log(`No sessions found for workspace: ${currentWorkspace}`);
      dispatch(newSession());
      return;
    }
    
    // Load the most recent session for this workspace
    const mostRecentSession = sessions[0];
    console.log(`Loading session ${mostRecentSession.sessionId} for workspace: ${currentWorkspace}`);
    
    try {
      const session = await getSession(extra.ideMessenger, mostRecentSession.sessionId);
      if (previousSessionId && previousSessionId !== session.sessionId) {
        void extra.ideMessenger
          .request("brain/dispatch", {
            action: "close_session",
            session_id: previousSessionId,
          })
          .catch(() => {});
      }
      dispatch(newSession(session));

      try {
        const dirs = await extra.ideMessenger.ide.getWorkspaceDirs();
        await Promise.race([
          extra.ideMessenger.request("brain/trackSession", {
            sessionId: session.sessionId,
            title: session.title || "",
            workspaceDir: dirs[0] ?? "",
          }),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch {
        // Best-effort WM restore
      }
    } catch (e) {
      console.error(`Error loading session ${mostRecentSession.sessionId}:`, e);
      dispatch(newSession());
    }
  },
);

function getChatTitleFromMessage(message: ChatMessage) {
  const text =
    renderChatMessage(message)
      .split("\n")
      .filter((l) => l.trim() !== "")
      .slice(-1)[0] || "";

  // Truncate
  if (text.length > MAX_TITLE_LENGTH) {
    return text.slice(0, MAX_TITLE_LENGTH - 3) + "...";
  }
  return text;
}

export const saveCurrentSession = createAsyncThunk<
  void,
  { openNewSession: boolean; generateTitle: boolean },
  ThunkApiType
>(
  "session/saveCurrent",
  async ({ openNewSession, generateTitle }, { dispatch, extra, getState }) => {
    const state = getState();
    if (state.session.history.length === 0) {
      return;
    }

    if (openNewSession) {
      dispatch(newSession());
      // Close the finished session in the Memory Brain (topic flush,
      // summarization, working-memory persistence). Fire-and-forget.
      if (state.session.id) {
        void extra.ideMessenger
          .request("brain/dispatch", {
            action: "close_session",
            session_id: state.session.id,
          })
          .catch(() => {});
      }
    }

    // New session has already been dispatched
    // Now save previous session and update chat title if relevant
    let title = state.session.title;
    if (title === NEW_SESSION_TITLE) {
      const defaultModel = selectDefaultModel(state);
      if (!state.config.config?.disableSessionTitles && defaultModel) {
        let assistantResponse = state.session.history
          ?.filter((h) => h.message.role === "assistant")[0]
          ?.message?.content?.toString();

        if (assistantResponse && generateTitle) {
          try {
            const result = await extra.ideMessenger.request(
              "chatDescriber/describe",
              {
                text: assistantResponse,
                selectedModelTitle: defaultModel.title,
              },
            );
            if (result.status === "success" && result.content) {
              title = result.content;
            }
          } catch (e) {
            console.error("Failed to generate chat title", e);
          }
        }
      }
      // Fallbacks if above doesn't work out or session titles disabled
      if (title === NEW_SESSION_TITLE) {
        title = getChatTitleFromMessage(state.session.history[0].message);
      }
    }
    // More fallbacks in case of no title
    if (!title.length) {
      const metadata = getState().session.allSessionMetadata.find(
        (m) => m.sessionId === state.session.id,
      );
      if (metadata?.title) {
        title = metadata.title;
      }
    }
    if (!title.length) {
      title = NEW_SESSION_TITLE;
    }

    const session: Session = {
      sessionId: state.session.id,
      title,
      workspaceDirectory: window.workspacePaths?.[0] || "",
      history: state.session.history,
    };

    const result = await dispatch(updateSession(session));
    unwrapResult(result);
  },
);
