import { BrowserSerializedKnoxConfig } from "core";
import { preloadKnoxChatModels } from "core/llm/toolSupport";
import { ConfigResult } from "knoxdev-package/config-yaml";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { VSC_THEME_COLOR_VARS } from "../components";
import { IdeMessengerContext } from "../context/IdeMessenger";
import {
  initializeProfilePreferencesThunk,
  selectProfileThunk,
  selectSelectedProfileId,
} from "../redux";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import {
  selectDefaultModel,
  setConfigResult,
} from "../redux/slices/configSlice";
import {
  addContextItemsAtIndex,
  newSession,
  setInactive,
  setToolCallOutput,
} from "../redux/slices/sessionSlice";
import { applyAgentJobUpdate, refreshAgentJobs } from "../redux/thunks/agentJobs";
import { runAgentWorktree } from "../redux/thunks/agentWorktree";
import { refreshSessionMetadata, loadLastSession } from "../redux/thunks/session";
import { loadReasoningEffortPrefs } from "../redux/thunks/reasoningEffort";
import { updateFileSymbolsFromHistory } from "../redux/thunks/updateFileSymbols";
import { getLastActiveSessionState } from "../util/lastActiveSession";
import { setLocalStorage } from "../util/localStorage";

import { formatRestoreNotice } from "core/context/soul";

import { setRestoreNotice } from "../redux/thunks/injectedContextCache";
import { useWebviewListener } from "./useWebviewListener";

function useSetup() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const history = useAppSelector((store) => store.session.history);
  const sessionId = useAppSelector((store) => store.session.id);
  const defaultModel = useAppSelector(selectDefaultModel);
  const selectedProfileId = useAppSelector(selectSelectedProfileId);

  const hasLoadedConfig = useRef(false);

  const handleConfigUpdate = useCallback(
    async (
      initial: boolean,
      result: {
        result: ConfigResult<BrowserSerializedKnoxConfig>;
        profileId: string | null;
      },
    ) => {
      const { result: configResult, profileId } = result;
      if (initial && hasLoadedConfig.current) {
        return;
      }
      hasLoadedConfig.current = true;
      dispatch(setConfigResult(configResult));
      dispatch(selectProfileThunk(profileId));
      void dispatch(loadReasoningEffortPrefs());

      const isNewProfileId = profileId && profileId !== selectedProfileId;

      if (isNewProfileId) {
        dispatch(initializeProfilePreferencesThunk({ profileId }));
      }

      // Perform any actions needed with the config
      if (configResult.config?.ui?.fontSize) {
        setLocalStorage("fontSize", configResult.config.ui.fontSize);
        document.body.style.fontSize = `${configResult.config.ui.fontSize}px`;
      }
    },
    [dispatch, hasLoadedConfig],
  );

  const loadConfig = useCallback(
    async (initial: boolean) => {
      const result = await ideMessenger.request(
        "config/getSerializedProfileInfo",
        undefined,
      );
      if (result.status === "error") {
        return;
      }
      await handleConfigUpdate(initial, result.content);
    },
    [ideMessenger, handleConfigUpdate],
  );

  // Load config from the IDE
  useEffect(() => {
    const initialize = async () => {
      await preloadKnoxChatModels();
      await loadConfig(true);
      void dispatch(loadReasoningEffortPrefs());
    };

    void initialize();
    const interval = setInterval(() => {
      if (hasLoadedConfig.current) {
        // Init to run on initial config load
        dispatch(updateFileSymbolsFromHistory());
        dispatch(refreshSessionMetadata({}));
        dispatch(runAgentWorktree("status"));
        dispatch(refreshAgentJobs());
        
        // Load workspace session after config is loaded
        const workspace = window.workspacePaths?.[0];
        if (workspace) {
          const lastActiveSession = getLastActiveSessionState(workspace);

          // Check if the current persisted session belongs to this workspace
          // If not, clear it before loading the correct workspace session.
          // Otherwise preserve the rehydrated current chat, including an
          // intentionally empty chat created with "New Chat" before shutdown.
          const currentSessionId = sessionId;
          if (lastActiveSession?.isEmpty) {
            if (history.length > 0) {
              dispatch(newSession());
            }
            console.log(`Config loaded - preserving empty session for workspace: ${workspace}`);
          } else if (currentSessionId && history.length > 0) {
            // Verify this session belongs to the current workspace by checking with backend
            ideMessenger.request('history/load', { id: currentSessionId })
              .then(result => {
                if (result.status === 'success' && result.content.workspaceDirectory) {
                  const sessionWorkspace = result.content.workspaceDirectory.replace(/\/$/, '');
                  const currentWorkspace = workspace.replace(/\/$/, '');
                  
                  if (sessionWorkspace !== currentWorkspace) {
                    console.log(`Clearing session from different workspace: ${sessionWorkspace} != ${currentWorkspace}`);
                    dispatch(newSession());
                    console.log(`Config loaded - loading session for workspace: ${workspace}`);
                    dispatch(loadLastSession({ saveCurrentSession: false }));
                  } else {
                    console.log(`Config loaded - preserving current session for workspace: ${workspace}`);
                  }
                }
              })
              .catch(() => {
                // If session doesn't exist or errors, load the latest workspace session.
                console.log(`Config loaded - loading session for workspace: ${workspace}`);
                dispatch(loadLastSession({ saveCurrentSession: false }));
              });
          } else {
            console.log(`Config loaded - loading session for workspace: ${workspace}`);
            dispatch(loadLastSession({ saveCurrentSession: false }));
          }
        }

        // This triggers sending pending status to the GUI
        clearInterval(interval);
        return;
      }
      loadConfig(true);
    }, 2_000);

    return () => clearInterval(interval);
  }, [hasLoadedConfig, loadConfig, ideMessenger, dispatch]);

  useWebviewListener(
    "checkpointRestored",
    async (payload) => {
      const targetSession = payload.sessionId || sessionId;
      if (!targetSession) {
        return;
      }
      setRestoreNotice(
        targetSession,
        formatRestoreNotice({
          checkpointId: payload.checkpointId,
          description: payload.description,
          restoredFiles: payload.restoredFiles ?? [],
          memoryRewound: payload.memoryRewound,
          memoryMessage: payload.memoryMessage,
        }),
      );
    },
    [sessionId],
  );

  useWebviewListener(
    "configUpdate",
    async (update) => {
      if (!update) {
        return;
      }
      console.log("Received configUpdate:", update);
      await handleConfigUpdate(false, update);
    },
    [handleConfigUpdate],
  );

  // Load symbols for chat on any session change
  useEffect(() => {
    if (sessionId) {
      dispatch(updateFileSymbolsFromHistory());
    }
  }, [sessionId, dispatch]);

  // Load workspace-specific session when workspace changes
  const [currentWorkspace, setCurrentWorkspace] = useState<string | null>(null);
  useEffect(() => {
    const workspace = window.workspacePaths?.[0] || null;
    const lastActiveSession = workspace
      ? getLastActiveSessionState(workspace)
      : undefined;
    
    // If workspace has changed, load the most recent session for this workspace
    if (workspace !== currentWorkspace) {
      const previousWorkspace = currentWorkspace;
      setCurrentWorkspace(workspace);
      
      // Clear any persisted session from different workspace to prevent cross-workspace pollution
      const currentSessionId = history.length > 0 ? history[0]?.message?.id : null;
      if (workspace && currentSessionId && previousWorkspace && previousWorkspace !== workspace) {
        console.log(`Workspace changed from '${previousWorkspace}' to '${workspace}' - clearing old session`);
        dispatch(newSession()); // Clear current session first
      }
      
      // Only load workspace session if:
      // 1. We have a workspace
      // 2. Config has been loaded
      // 3. This is actually a workspace change (not initial load with null)
      if (workspace && hasLoadedConfig.current && previousWorkspace !== null) {
        console.log(`Workspace changed from '${previousWorkspace}' to '${workspace}' - loading workspace session`);
        dispatch(loadLastSession({ saveCurrentSession: true }));
      } else if (workspace && hasLoadedConfig.current && previousWorkspace === null) {
        // This is the initial workspace load
        if (lastActiveSession?.isEmpty) {
          if (history.length > 0) {
            dispatch(newSession());
          }
          console.log(`Initial workspace load: '${workspace}' - preserving empty session`);
        } else if (history.length > 0) {
          console.log(`Initial workspace load: '${workspace}' - preserving current session`);
        } else {
          console.log(`Initial workspace load: '${workspace}' - loading workspace session`);
          dispatch(loadLastSession({ saveCurrentSession: false }));
        }
      }
    }
  }, [currentWorkspace, hasLoadedConfig, dispatch, history]);

  // ON LOAD
  useEffect(() => {
    // Override persisted state
    dispatch(setInactive());

    for (const colorVar of VSC_THEME_COLOR_VARS) {
      // Remove alpha channel from colors
      const value = getComputedStyle(document.documentElement).getPropertyValue(
        colorVar,
      );
      if (colorVar.startsWith("#") && value.length > 7) {
        document.body.style.setProperty(colorVar, value.slice(0, 7));
      }
    }
  }, []);

  // IDE event listeners
  useWebviewListener(
    "getWebviewHistoryLength",
    async () => {
      return history.length;
    },
    [history],
  );

  useWebviewListener(
    "getCurrentSessionId",
    async () => {
      return sessionId;
    },
    [sessionId],
  );

  useWebviewListener("setInactive", async () => {
    dispatch(setInactive());
  });

  useWebviewListener("tools/partialOutput", async (data) => {
    dispatch(
      setToolCallOutput({
        toolCallId: data.toolCallId,
        output: data.contextItems,
      }),
    );
  });

  useWebviewListener("agent/jobUpdate", async (data) => {
    dispatch(applyAgentJobUpdate(data));
  });

  useWebviewListener("addContextItem", async (data) => {
    dispatch(
      addContextItemsAtIndex({
        index: data.historyIndex,
        contextItems: [data.item],
      }),
    );
  });


  useWebviewListener(
    "getDefaultModelTitle",
    async () => {
      return defaultModel?.title;
    },
    [defaultModel],
  );

  // Do not listen for agentStreamingUpdate to toggle isStreaming.
  // streamThunkWrapper owns that flag. A bounced isComplete=true used to
  // call setInactive mid-tool-loop, so the next LLM turn after
  // builtin_edit_file exited immediately.

}

export default useSetup;