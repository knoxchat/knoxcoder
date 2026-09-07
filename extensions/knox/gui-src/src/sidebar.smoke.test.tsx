import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

import { Checkpoints } from "./components/Checkpoints";
import { History } from "./components/History";
import { UserSettingsForm } from "./pages/config/UserSettingsForm";
import { LocalStorageProvider } from "./context/LocalStorage";
import { IdeMessengerContext } from "./context/IdeMessenger";
import configReducer from "./redux/slices/configSlice";
import sessionReducer, {
  streamUpdate,
  submitEditorAndInitAtIndex,
} from "./redux/slices/sessionSlice";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: { type: "3rdParty", init: () => undefined },
}));

vi.mock("./redux/thunks/session", () => ({
  refreshSessionMetadata: () => ({ type: "session/refreshSessionMetadata" }),
  deleteSession: () => ({ type: "session/deleteSession" }),
}));

vi.mock("./hooks/useWebviewListener", () => ({
  useWebviewListener: () => undefined,
}));

vi.mock("./components/gui/Shortcut", () => ({
  default: ({ children }: { children: unknown }) => (
    <span>{children as string}</span>
  ),
}));

vi.mock("./components/gui/Tooltip", () => ({
  ToolTip: () => null,
}));

afterEach(() => {
  vi.clearAllMocks();
});

function messenger(requestImpl?: ReturnType<typeof vi.fn>) {
  return {
    request:
      requestImpl ??
      vi.fn().mockResolvedValue({
        status: "success",
        content: {
          checkpoints: [],
          total: 0,
          offset: 0,
          limit: 50,
          hasMore: false,
          compareCatalog: [],
          workspaceFolders: [],
        },
      }),
    post: vi.fn(),
    respond: vi.fn(),
    streamRequest: vi.fn(),
    llmStreamChat: vi.fn(),
    ide: {} as any,
  } as any;
}

describe("sidebar smoke (T8.4 / T8.5)", () => {
  it("chat submit creates a user turn and streams a stub reply", () => {
    let state = sessionReducer(undefined, { type: "unknown" });
    state = sessionReducer(
      state,
      submitEditorAndInitAtIndex({
        index: 0,
        editorState: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "hello knox" }],
            },
          ],
        },
      }),
    );
    expect(state.history.length).toBeGreaterThanOrEqual(2);
    expect(state.history[0].editorState).toBeTruthy();

    state = sessionReducer(
      state,
      streamUpdate([{ role: "assistant", content: "stub reply" }]),
    );
    const assistant = state.history.find((item) => item.message.role === "assistant");
    expect(assistant?.message.content).toBe("stub reply");
  });

  it("history empty state: type in the search box", async () => {
    const store = configureStore({
      reducer: {
        session: sessionReducer,
      },
    });
    render(
      <Provider store={store}>
        <History />
      </Provider>,
    );

    expect(await screen.findByText("noConversationsFound")).toBeTruthy();
    const search = screen.getByPlaceholderText("searchConversations");
    fireEvent.change(search, { target: { value: "oauth" } });
    expect((search as HTMLInputElement).value).toBe("oauth");
  });

  it("settings page shows interface and agent controls", () => {
    const store = configureStore({
      reducer: {
        config: configReducer,
      },
    });
    render(
      <Provider store={store}>
        <LocalStorageProvider>
          <IdeMessengerContext.Provider value={messenger()}>
            <UserSettingsForm />
          </IdeMessengerContext.Provider>
        </LocalStorageProvider>
      </Provider>,
    );

    expect(screen.getByText("interfaceSettings")).toBeTruthy();
    expect(screen.getByText("agentSettings")).toBeTruthy();
    expect(screen.getAllByText("language").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("switch", { name: "showSessionTabs" }));
  });

  it("checkpoints empty state is shown when the workspace has none", async () => {
    const request = vi.fn().mockResolvedValue({
      status: "success",
      content: {
        checkpoints: [],
        total: 0,
        offset: 0,
        limit: 50,
        hasMore: false,
        compareCatalog: [],
        workspaceFolders: [],
      },
    });
    const store = configureStore({
      reducer: {
        session: (state = { id: "sess-smoke" }) => state,
      },
    });
    render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger(request)}>
          <Checkpoints />
        </IdeMessengerContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "listCheckpoints",
        expect.objectContaining({ offset: 0 }),
      );
    });
    expect(await screen.findByText("noCheckpointsFound")).toBeTruthy();
  });
});
