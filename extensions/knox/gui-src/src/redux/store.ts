import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { createLogger } from "redux-logger";
import {
  createMigrate,
  MigrationManifest,
  persistReducer,
  persistStore,
} from "redux-persist";
import autoMergeLevel2 from "redux-persist/lib/stateReconciler/autoMergeLevel2";
import { createFilter } from "redux-persist-transform-filter";

import { IdeMessenger, IIdeMessenger } from "../context/IdeMessenger";
import { indexedDBStorage } from "../util/indexedDBStorage";
import { DEFAULT_PERMISSION_MODE } from "./util/permissionMode";
import { autoApproveAskFirstSettings } from "./util/toolPermissionDefaults";

import { agentModeStreamingMiddleware } from "./middleware/agentModeStreamingMiddleware";
import { autoSaveSessionMiddleware } from "./middleware/autoSaveSessionMiddleware";
import { profilesReducer } from "./slices";
import configReducer from "./slices/configSlice";
import editModeStateReducer from "./slices/editModeState";
import sessionReducer from "./slices/sessionSlice";
import statsReducer from "./slices/statsSlice";
import tabsReducer from "./slices/tabsSlice";
import uiReducer from "./slices/uiSlice";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const rootReducer = combineReducers({
  session: sessionReducer,
  ui: uiReducer,
  editModeState: editModeStateReducer,
  config: configReducer,
  tabs: tabsReducer,
  profiles: profilesReducer,
  stats: statsReducer,
});

const saveSubsetFilters = [
  createFilter("session", [
    "history",
    "id",
    "lastSessionId",
    "title",
    // Persist edit mode in case closes mid-edit
    "mode",
    "codeToEdit",
  ]),
  // Don't persist any of the edit state for now
  createFilter("editModeState", []),
  createFilter("config", ["defaultModelTitle"]),
  createFilter("ui", [
    "toolSettings",
    "toolGroupSettings",
    "reasoningEffort",
    "reasoningEffortByModel",
    "webSearchEnabled",
    "isBlockSettingsToolbarExpanded",
    "selectedBlockSettingsSection",
    "permissionMode",
  ]),
  createFilter("tabs", ["tabs"]),
  createFilter("profiles", ["preferencesByProfileId", "selectedProfileId"]),
  // Don't persist stats - fetched fresh from backend
  createFilter("stats", ["budgetAlert"]),
];

const migrations: MigrationManifest = {
  "0": (state) => {
    const oldState = state as any;

    return {
      config: {
        defaultModelTitle: oldState?.state?.defaultModelTitle ?? undefined,
      },
      session: {
        history: oldState?.state?.history ?? [],
        id: oldState?.state?.sessionId ?? "",
      },
      tabs: {
        tabs: [
          {
            id:
              Date.now().toString(36) + Math.random().toString(36).substring(2),
            title: "Chat 1",
            isActive: true,
          },
        ],
      },
      _persist: oldState?._persist,
    };
  },
  // Drop dead session.availableProfiles/organizations and org selection
  "1": (state) => {
    const s = state as any;
    if (s?.session) {
      const {
        availableProfiles: _ap,
        organizations: _orgs,
        ...session
      } = s.session;
      s.session = session;
    }
    if (s?.organizations) {
      s.organizations = {
        ...s.organizations,
        selectedOrganizationId: null,
      };
    }
    return s;
  },
  // Remove control-plane org/misc slices entirely
  "2": (state) => {
    const s = state as any;
    if (s) {
      delete s.organizations;
      delete s.misc;
    }
    return s;
  },
  // Drop removed plan/todo slices from persisted state
  "4": (state) => {
    const s = state as any;
    if (s) {
      delete s.planTask;
      delete s.todo;
    }
    return s;
  },
  // Default tool permissions: Auto-Approve instead of Ask first
  "5": (state) => {
    const s = state as any;
    const toolSettings = s?.ui?.toolSettings;
    if (toolSettings && typeof toolSettings === "object") {
      s.ui = {
        ...s.ui,
        toolSettings: autoApproveAskFirstSettings(toolSettings),
      };
    }
    return s;
  },
  // Default Agent permission overlay: Auto instead of Ask
  "6": (state) => {
    const s = state as any;
    if (s?.ui && (s.ui.permissionMode == null || s.ui.permissionMode === "default")) {
      s.ui = {
        ...s.ui,
        permissionMode: DEFAULT_PERMISSION_MODE,
      };
    }
    return s;
  },
};

const persistConfig = {
  version: 6,
  key: "root",
  storage: indexedDBStorage, // Now using IndexedDB instead of localStorage
  transforms: [...saveSubsetFilters],
  stateReconciler: autoMergeLevel2,
  migrate: createMigrate(migrations, { debug: false }),
};

const persistedReducer = persistReducer<ReturnType<typeof rootReducer>>(
  persistConfig,
  rootReducer,
);

export function setupStore() {
  const logger = createLogger({
    // Customize logger options if needed
    collapsed: true, // Collapse console groups by default
    timestamp: false, // Remove timestamps from log
    diff: true, // Show diff between states
  });

  return configureStore({
    // persistedReducer causes type errors with async thunks
    reducer: persistedReducer as unknown as typeof rootReducer,
    // reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        thunk: {
          extraArgument: {
            ideMessenger: new IdeMessenger(),
          },
        },
      })
        .concat(autoSaveSessionMiddleware)
        .concat(agentModeStreamingMiddleware)
        .concat(logger),
  });
}

export type ThunkApiType = {
  state: RootState;
  extra: { ideMessenger: IIdeMessenger };
};

export const store = setupStore();

export type RootState = ReturnType<typeof rootReducer>;

export type AppDispatch = typeof store.dispatch;

export const persistor = persistStore(store);
