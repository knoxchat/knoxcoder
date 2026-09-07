import { describe, expect, it } from "vitest";

import {
  findCurrentToolCall,
  findPendingGeneratedToolCalls,
  hasUnsettledToolCalls,
} from "./index";

function item(states: Array<{ id: string; status: any }>) {
  const toolCallStates = states.map((state) => ({
    toolCallId: state.id,
    status: state.status,
    parsedArgs: {},
    toolCall: {
      id: state.id,
      type: "function" as const,
      function: { name: "builtin_read_file", arguments: "{}" },
    },
  }));
  return {
    message: { role: "assistant" as const, content: "", toolCalls: [] },
    contextItems: [],
    toolCallStates,
    toolCallState: toolCallStates[0],
  };
}

describe("tool call batch helpers", () => {
  it("finds pending generated calls on the latest assistant turn", () => {
    const history = [
      item([
        { id: "a", status: "done" },
        { id: "b", status: "generated" },
      ]),
    ] as any;
    expect(findPendingGeneratedToolCalls(history).map((s) => s.toolCallId)).toEqual([
      "b",
    ]);
    expect(findCurrentToolCall(history)?.toolCallId).toBe("b");
    expect(hasUnsettledToolCalls(history)).toBe(true);
  });

  it("treats only done/canceled as settled", () => {
    const history = [
      item([
        { id: "a", status: "done" },
        { id: "b", status: "canceled" },
      ]),
    ] as any;
    expect(hasUnsettledToolCalls(history)).toBe(false);
    expect(findPendingGeneratedToolCalls(history)).toEqual([]);
  });
});
