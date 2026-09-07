import { fireEvent, render, screen } from "@testing-library/react";
import { ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

import { AskUser } from "./AskUser";

const { dispatch, answerAskUser, cancelTool } = vi.hoisted(() => ({
  dispatch: vi.fn((action: unknown) => action),
  answerAskUser: vi.fn((payload: unknown) => ({
    type: "chat/answerAskUser",
    payload,
  })),
  cancelTool: vi.fn(() => ({ type: "chat/cancelTool" })),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { current?: number; total?: number }) => {
      if (key === "askUserProgress") {
        return `Question ${opts?.current} of ${opts?.total}`;
      }
      return key;
    },
  }),
}));

vi.mock("../../../redux/hooks", () => ({
  useAppDispatch: () => dispatch,
}));

vi.mock("../../../redux/thunks/answerAskUser", () => ({
  answerAskUser,
}));

vi.mock("../../../redux/thunks/cancelTool", () => ({
  cancelTool,
}));

function toolState(
  questions: unknown[],
  status: ToolCallState["status"] = "generated",
): ToolCallState {
  return {
    toolCallId: "ask-1",
    status,
    parsedArgs: { questions },
    toolCall: {
      id: "ask-1",
      type: "function",
      function: { name: BuiltInToolNames.AskUser, arguments: "{}" },
    },
  };
}

describe("AskUser", () => {
  beforeEach(() => {
    dispatch.mockClear();
    answerAskUser.mockClear();
    cancelTool.mockClear();
  });

  it("renders a questionnaire choice card and submits the selection", () => {
    render(
      <AskUser
        toolCallState={toolState([
          {
            prompt: "How would you like to run/play the Rust Tetris game?",
            options: [
              "Terminal game (crossterm) — runs in your terminal",
              "Browser game (WebAssembly) — compiles Rust to WASM",
              "Desktop GUI (e.g. bevy/macroquad) — a windowed native app",
            ],
          },
        ])}
      />,
    );

    expect(
      screen.getByText("How would you like to run/play the Rust Tetris game?"),
    ).toBeTruthy();
    expect(screen.getByText("Desktop GUI (e.g. bevy/macroquad)")).toBeTruthy();
    expect(screen.getByText("a windowed native app")).toBeTruthy();

    const submit = screen.getByRole("button", {
      name: "askUserSubmit",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByText("Desktop GUI (e.g. bevy/macroquad)"));
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(answerAskUser).toHaveBeenCalledWith({
      toolCallId: "ask-1",
      answers: {
        q1: "Desktop GUI (e.g. bevy/macroquad) — a windowed native app",
      },
    });
  });

  it("walks multiple questions before submit", () => {
    render(
      <AskUser
        toolCallState={toolState([
          { prompt: "Library?", options: ["zod", "joi"] },
          { id: "scope", prompt: "Scope?", options: ["auth", "all"] },
        ])}
      />,
    );

    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByText("zod"));
    fireEvent.click(screen.getByRole("button", { name: "askUserNext" }));
    expect(screen.getByText("Scope?")).toBeTruthy();
    fireEvent.click(screen.getByText("auth"));
    fireEvent.click(screen.getByRole("button", { name: "askUserSubmit" }));
    expect(answerAskUser).toHaveBeenCalledWith({
      toolCallId: "ask-1",
      answers: { q1: "zod", scope: "auth" },
    });
  });

  it("denies the question", () => {
    render(
      <AskUser
        toolCallState={toolState([{ prompt: "Go ahead?", options: ["yes"] }])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "deny" }));
    expect(cancelTool).toHaveBeenCalled();
  });

  it("selects a choice with a number shortcut", () => {
    render(
      <AskUser
        toolCallState={toolState([
          { prompt: "Pick one", options: ["alpha", "beta"] },
        ])}
      />,
    );
    fireEvent.keyDown(screen.getByRole("form"), { key: "2" });
    fireEvent.click(screen.getByRole("button", { name: "askUserSubmit" }));
    expect(answerAskUser).toHaveBeenCalledWith({
      toolCallId: "ask-1",
      answers: { q1: "beta" },
    });
  });
});
