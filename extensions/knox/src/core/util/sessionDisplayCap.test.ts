import { ChatHistoryItem, Session } from "../index.js";
import { describe, expect, it } from "vitest";

import {
  GUI_DISPLAY_MAX_CHARS,
  GUI_SESSION_HYDRATE_BUDGET_BYTES,
  estimateSessionPayloadBytes,
  slimSessionForGui,
  shouldWarnLargeSession,
} from "./sessionDisplayCap";

function toolItem(id: string, body: string): ChatHistoryItem {
  return {
    message: { role: "tool", content: body, toolCallId: id },
    contextItems: [
      {
        name: "Terminal",
        description: "out",
        content: body,
        id: { providerTitle: "tool", itemId: id },
      },
    ],
    promptLogs: [
      {
        modelTitle: "m",
        completionOptions: {} as never,
        prompt: "P".repeat(50_000),
        completion: "C".repeat(50_000),
      },
    ],
    toolCallState: {
      toolCallId: id,
      toolCall: {
        id,
        type: "function",
        function: { name: "builtin_run_terminal_command", arguments: "{}" },
      },
      status: "done",
      parsedArgs: {},
      output: [{ name: "Terminal", description: "out", content: body }],
    },
  } as ChatHistoryItem;
}

describe("slimSessionForGui (CSLD-21)", () => {
  it("drops promptLogs and duplicate settled outputs without touching tool message.content", () => {
    const full = "z".repeat(GUI_DISPLAY_MAX_CHARS + 500);
    const session: Session = {
      sessionId: "s1",
      title: "t",
      workspaceDirectory: "/w",
      history: [toolItem("c1", full)],
    };
    const { session: slimmed, slimmed: changed } = slimSessionForGui(session);
    expect(changed).toBe(true);
    expect(slimmed.history[0].promptLogs).toBeUndefined();
    expect(slimmed.history[0].toolCallState?.output).toBeUndefined();
    expect(slimmed.history[0].message.content).toBe(full);
    expect(slimmed.history[0].contextItems[0].content.length).toBeLessThan(
      full.length,
    );
    expect(slimmed.guiHydrateSlimmed).toBe(true);
    expect(shouldWarnLargeSession(slimmed)).toBe(true);
  });

  it("does not warn after dropping only small promptLogs", () => {
    const session: Session = {
      sessionId: "s3",
      title: "t",
      workspaceDirectory: "/w",
      history: [
        {
          message: { role: "assistant", content: "hi" },
          contextItems: [],
          promptLogs: [
            {
              modelTitle: "m",
              completionOptions: {} as never,
              prompt: "short",
              completion: "also short",
            },
          ],
        } as ChatHistoryItem,
      ],
    };
    const result = slimSessionForGui(session);
    expect(result.slimmed).toBe(true);
    expect(result.session.guiHydrateSlimmed).toBeUndefined();
    expect(shouldWarnLargeSession(result.session)).toBe(false);
  });

  it("keeps a small session unchanged and under budget", () => {
    const session: Session = {
      sessionId: "s2",
      title: "t",
      workspaceDirectory: "/w",
      history: [
        {
          message: { role: "user", content: "hi" },
          contextItems: [],
        },
      ],
    };
    const result = slimSessionForGui(session);
    expect(result.slimmed).toBe(false);
    expect(result.overBudget).toBe(false);
    expect(result.session).toBe(session);
    expect(result.originalBytes).toBeLessThan(GUI_SESSION_HYDRATE_BUDGET_BYTES);
    expect(estimateSessionPayloadBytes(session)).toBe(result.originalBytes);
  });
});
