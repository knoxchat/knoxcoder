import { describe, expect, it } from "vitest";

import {
  mergeToolCallDeltas,
  primaryToolCallState,
  syncToolCallStatesFromDeltas,
} from "./mergeToolCallDeltas";

describe("mergeToolCallDeltas", () => {
  it("appends argument fragments onto the same index", () => {
    const first = mergeToolCallDeltas([], [
      {
        index: 0,
        id: "c1",
        type: "function",
        function: { name: "builtin_read_file", arguments: '{"file' },
      },
    ]);
    const second = mergeToolCallDeltas(first, [
      { index: 0, function: { arguments: 'path":"a.ts"}' } },
    ]);
    expect(second).toHaveLength(1);
    expect(second[0]?.function?.arguments).toBe('{"filepath":"a.ts"}');
    expect(second[0]?.function?.name).toBe("builtin_read_file");
  });

  it("keeps a second tool call on index 1 instead of concatenating onto [0]", () => {
    const first = mergeToolCallDeltas([], [
      {
        index: 0,
        id: "c1",
        type: "function",
        function: { name: "builtin_read_file", arguments: '{"filepath":"a.ts"}' },
      },
    ]);
    const second = mergeToolCallDeltas(first, [
      {
        index: 1,
        id: "c2",
        type: "function",
        function: { name: "builtin_glob", arguments: '{"pattern":"*.ts"}' },
      },
    ]);
    expect(second).toHaveLength(2);
    expect(second[0]?.id).toBe("c1");
    expect(second[1]?.id).toBe("c2");
    expect(second[0]?.function?.arguments).toBe('{"filepath":"a.ts"}');
  });

  it("merges Anthropic-style deltas by id", () => {
    const first = mergeToolCallDeltas([], [
      { id: "toolu_1", type: "function", function: { name: "read", arguments: "{" } },
    ]);
    const second = mergeToolCallDeltas(first, [
      { id: "toolu_1", function: { arguments: "}" } },
    ]);
    expect(second).toHaveLength(1);
    expect(second[0]?.function?.arguments).toBe("{}");
  });
});

describe("toolCallDeltaToState name canonicalization", () => {
  it("maps read_file_line onto builtin_read_file so the card is not Agent Tool Usage", () => {
    const states = syncToolCallStatesFromDeltas(
      [
        {
          id: "c2",
          type: "function",
          function: {
            name: "read_file_line",
            arguments: '{"filepath":"tetris/src/main.rs","startLine":760,"endLine":840}',
          },
        },
      ],
      undefined,
    );
    expect(states[0]?.toolCall.function.name).toBe("builtin_read_file");
  });

  it("maps read_file onto builtin_read_file so permissions and routing match", () => {
    const states = syncToolCallStatesFromDeltas(
      [
        {
          id: "c1",
          type: "function",
          function: {
            name: "read_file",
            arguments: '{"filepath":"a.ts"}',
          },
        },
      ],
      undefined,
    );
    expect(states[0]?.toolCall.function.name).toBe("builtin_read_file");
  });
});

describe("syncToolCallStatesFromDeltas", () => {
  it("preserves status when arguments grow", () => {
    const states = syncToolCallStatesFromDeltas(
      [{ id: "c1", type: "function", function: { name: "read", arguments: "{" } }],
      undefined,
    );
    states[0].status = "generated";
    const next = syncToolCallStatesFromDeltas(
      [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }],
      states,
    );
    expect(next[0]?.status).toBe("generated");
    expect(next[0]?.toolCall.function.arguments).toBe("{}");
  });
});

describe("primaryToolCallState", () => {
  it("prefers the first unfinished state", () => {
    const primary = primaryToolCallState([
      {
        toolCallId: "a",
        status: "done",
        parsedArgs: {},
        toolCall: { id: "a", type: "function", function: { name: "r", arguments: "{}" } },
      },
      {
        toolCallId: "b",
        status: "generated",
        parsedArgs: {},
        toolCall: { id: "b", type: "function", function: { name: "w", arguments: "{}" } },
      },
    ]);
    expect(primary?.toolCallId).toBe("b");
  });
});
