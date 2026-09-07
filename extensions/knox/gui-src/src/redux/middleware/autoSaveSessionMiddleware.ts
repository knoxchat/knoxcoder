import { Middleware } from "@reduxjs/toolkit";

import { RootState } from "../store";
import { saveCurrentSession } from "../thunks/session";
import { setLastActiveSessionState } from "../../util/lastActiveSession";

/**
 * Auto-save middleware that saves session to disk (~/.knox/sessions) automatically
 * This ensures chat history is persisted even if the editor is closed unexpectedly
 */
export const autoSaveSessionMiddleware: Middleware<{}, RootState> =
  (store) => (next) => {
    let lastSaveTime = 0;
    let saveTimeout: NodeJS.Timeout | null = null;
    const SAVE_DEBOUNCE_MS = 2000; // Debounce saves by 2 seconds
    const MIN_SAVE_INTERVAL_MS = 5000; // Minimum 5 seconds between saves

    const rememberCurrentSessionState = () => {
      const state = store.getState();
      const workspace = window.workspacePaths?.[0] || "";

      setLastActiveSessionState({
        workspace,
        sessionId: state.session.id,
        isEmpty: state.session.history.length === 0,
      });
    };

    const debouncedSave = () => {
      const now = Date.now();
      
      // Clear any pending save
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      // Schedule a new save
      saveTimeout = setTimeout(() => {
        const timeSinceLastSave = Date.now() - lastSaveTime;
        
        // Only save if enough time has passed
        if (timeSinceLastSave >= MIN_SAVE_INTERVAL_MS) {
          const state = store.getState();
          
          // Only save if there's actual history
          if (state.session.history.length > 0 && !state.session.isStreaming) {
            lastSaveTime = Date.now();
            store.dispatch(
              saveCurrentSession({
                openNewSession: false,
                generateTitle: false, // Don't generate title during auto-save
              }) as any,
            );
            console.log("[Auto-Save] Session saved to disk");
          }
        }
      }, SAVE_DEBOUNCE_MS);
    };

    return (action: any) => {
      const result = next(action);

      if (
        action.type === "session/newSession" ||
        action.type === "session/submitEditorAndInitAtIndex" ||
        action.type === "session/streamUpdate" ||
        action.type === "session/updateHistoryItemAtIndex" ||
        action.type === "session/deleteMessage"
      ) {
        rememberCurrentSessionState();
      }

      // Trigger auto-save on relevant actions
      if (
        action.type === "session/streamUpdate" ||
        action.type === "session/updateHistoryItemAtIndex" ||
        action.type === "session/addContextItemsAtIndex" ||
        action.type === "session/updateSessionTitle" ||
        action.type === "session/deleteMessage"
      ) {
        debouncedSave();
      }

      return result;
    };
  };

