import { describe, expect, it } from "vitest";
import { ToolCallState } from "core";

import {
  DEFAULT_DOOM_LOOP_THRESHOLD,
  buildDoomLoopSummaryInstruction,
  canonicalizeToolArgs,
  collectTurnToolCalls,
  detectDoomLoop,
  fingerprintToolCall,
  isFailedToolCall,
  resolveDoomLoopThreshold,
} from "./doomLoop";

function toolState(opts: {
  name: string;
  args?: unknown;
  status?: ToolCallState["status"];
  failed?: boolean;
  id?: string;
}): ToolCallState {
  const args = opts.args ?? {};
  const argsJson = JSON.stringify(args);
  return {
    toolCallId: opts.id ?? "tc-1",
    status: opts.status ?? "done",
    parsedArgs: args,
    toolCall: {
      id: opts.id ?? "tc-1",
      type: "function",
      function: { name: opts.name, arguments: argsJson },
    },
    output: opts.failed
      ? [
          {
            name: "Tool Call Error",
            description: "failed",
            content: `Tool call "${opts.name}" failed:\n\nbad`,
            icon: "problems",
          },
        ]
      : [{ name: "ok", description: "ok", content: "ok" }],
  };
}

function assistant(states: ToolCallState[]) {
  return {
    message: { role: "assistant" as const, content: "", toolCalls: [] },
    contextItems: [],
    toolCallStates: states,
    toolCallState: states[0],
  };
}

function user(text = "go") {
  return {
    message: { role: "user" as const, content: text },
    contextItems: [],
  };
}

describe("canonicalizeToolArgs", () => {
  it("normalizes key order and JSON strings", () => {
    expect(canonicalizeToolArgs({ b: 2, a: 1 })).toBe(
      canonicalizeToolArgs('{"a":1,"b":2}'),
    );
    expect(canonicalizeToolArgs("")).toBe("{}");
    expect(canonicalizeToolArgs(undefined)).toBe("{}");
  });
});

describe("fingerprintToolCall", () => {
  it("is stable across arg key order", () => {
    const a = toolState({ name: "builtin_read_file", args: { filepath: "a.ts" } });
    const b = toolState({
      name: "builtin_read_file",
      args: { filepath: "a.ts" },
    });
    expect(fingerprintToolCall(a)).toBe(fingerprintToolCall(b));
  });

  it("differs when args differ", () => {
    const a = toolState({ name: "builtin_read_file", args: { filepath: "a.ts" } });
    const b = toolState({ name: "builtin_read_file", args: { filepath: "b.ts" } });
    expect(fingerprintToolCall(a)).not.toBe(fingerprintToolCall(b));
  });
});

describe("isFailedToolCall", () => {
  it("detects tool-call error output", () => {
    expect(isFailedToolCall(toolState({ name: "x", failed: true }))).toBe(true);
    expect(isFailedToolCall(toolState({ name: "x" }))).toBe(false);
  });
});

describe("collectTurnToolCalls", () => {
  it("only includes settled calls after the latest user message", () => {
    const history = [
      user("first"),
      assistant([toolState({ name: "old", id: "old", args: { n: 1 } })]),
      user("second"),
      assistant([
        toolState({ name: "new", id: "a", args: { n: 2 } }),
        toolState({
          name: "pending",
          id: "b",
          status: "generated",
          args: { n: 3 },
        }),
      ]),
    ];
    const collected = collectTurnToolCalls(history);
    expect(collected.map((c) => c.toolCallId)).toEqual(["a"]);
  });
});

describe("resolveDoomLoopThreshold", () => {
  it("defaults to 3, treats 0 as disabled, rejects 1", () => {
    expect(resolveDoomLoopThreshold(undefined)).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
    expect(resolveDoomLoopThreshold(0)).toBeNull();
    expect(resolveDoomLoopThreshold(1)).toBe(DEFAULT_DOOM_LOOP_THRESHOLD);
    expect(resolveDoomLoopThreshold(5)).toBe(5);
    expect(resolveDoomLoopThreshold(undefined, "systems")).toBe(5);
  });
});

describe("detectDoomLoop", () => {
  it("returns null below the threshold", () => {
    const history = [
      user(),
      assistant([
        toolState({ name: "builtin_read_file", args: { filepath: "a.ts" }, id: "1" }),
        toolState({ name: "builtin_read_file", args: { filepath: "a.ts" }, id: "2" }),
      ]),
    ];
    expect(detectDoomLoop(history)).toBeNull();
  });

  it("detects the same call repeated to the threshold", () => {
    const same = { filepath: "a.ts" };
    const history = [
      user(),
      assistant([
        toolState({ name: "builtin_read_file", args: same, id: "1" }),
        toolState({ name: "builtin_read_file", args: same, id: "2" }),
        toolState({ name: "builtin_read_file", args: same, id: "3" }),
      ]),
    ];
    const hit = detectDoomLoop(history);
    expect(hit?.kind).toBe("repeat");
    expect(hit?.toolName).toBe("builtin_read_file");
    expect(hit?.count).toBe(3);
  });

  it("counts a pending call toward the threshold", () => {
    const same = { filepath: "a.ts" };
    const history = [
      user(),
      assistant([
        toolState({ name: "builtin_read_file", args: same, id: "1" }),
        toolState({ name: "builtin_read_file", args: same, id: "2" }),
      ]),
    ];
    const pending = toolState({
      name: "builtin_read_file",
      args: same,
      id: "3",
      status: "generated",
    });
    expect(detectDoomLoop(history)).toBeNull();
    expect(detectDoomLoop(history, { pending: [pending] })?.kind).toBe("repeat");
  });

  it("detects a failure streak", () => {
    const history = [
      user(),
      assistant([
        toolState({ name: "builtin_edit_file", args: { n: 1 }, id: "1", failed: true }),
        toolState({ name: "builtin_edit_file", args: { n: 2 }, id: "2", failed: true }),
        toolState({ name: "builtin_write_file", args: { n: 3 }, id: "3", failed: true }),
      ]),
    ];
    const hit = detectDoomLoop(history);
    expect(hit?.kind).toBe("fail_streak");
    expect(hit?.count).toBe(3);
  });

  it("does not treat distinct successful calls as a loop", () => {
    const history = [
      user(),
      assistant([
        toolState({ name: "builtin_read_file", args: { filepath: "a.ts" }, id: "1" }),
        toolState({ name: "builtin_read_file", args: { filepath: "b.ts" }, id: "2" }),
        toolState({ name: "builtin_read_file", args: { filepath: "c.ts" }, id: "3" }),
      ]),
    ];
    expect(detectDoomLoop(history)).toBeNull();
  });

  it("does not doom-loop edit + make + edit + make + edit + make", () => {
    const makeArgs = { command: "make -j8" };
    const gcc = (fn: string) =>
      `Command: make -j8\nExit: 1\nsrc/foo.c:12:5: error: implicit declaration of function '${fn}'\nmake: *** [src/foo.o] Error 1`;
    const makeState = (id: string, fn: string): ToolCallState => ({
      ...toolState({
        name: "builtin_run_terminal_command",
        args: makeArgs,
        id,
      }),
      output: [{ name: "Terminal", description: "exited", content: gcc(fn) }],
    });
    const history = [
      user(),
      assistant([
        makeState("m1", "bar"),
        toolState({
          name: "builtin_edit_file",
          args: { filepath: "src/foo.c", old_string: "a", new_string: "b" },
          id: "e1",
        }),
        makeState("m2", "bar"),
        toolState({
          name: "builtin_edit_file",
          args: { filepath: "src/foo.c", old_string: "b", new_string: "c" },
          id: "e2",
        }),
        makeState("m3", "bar"),
      ]),
    ];
    expect(detectDoomLoop(history)).toBeNull();
  });

  it("does not doom-loop identical make args when the gcc error changes", () => {
    const makeArgs = { command: "make" };
    const makeState = (id: string, log: string): ToolCallState => ({
      ...toolState({
        name: "builtin_run_terminal_command",
        args: makeArgs,
        id,
      }),
      output: [{ name: "Terminal", description: "exited", content: log }],
    });
    const history = [
      user(),
      assistant([
        makeState("1", "src/foo.c:1:1: error: implicit declaration of function 'a'\n"),
        makeState("2", "src/foo.c:1:1: error: implicit declaration of function 'b'\n"),
        makeState("3", "src/foo.c:1:1: error: implicit declaration of function 'c'\n"),
      ]),
    ];
    expect(detectDoomLoop(history)).toBeNull();
  });

  it("still doom-loops three identical greps", () => {
    const same = { query: "copy_to_user" };
    const history = [
      user(),
      assistant([
        toolState({ name: "builtin_exact_search", args: same, id: "1" }),
        toolState({ name: "builtin_exact_search", args: same, id: "2" }),
        toolState({ name: "builtin_exact_search", args: same, id: "3" }),
      ]),
    ];
    expect(detectDoomLoop(history)?.kind).toBe("repeat");
  });

  it("does not doom-loop identical qemu boots when the oops RIP changes", () => {
    const qemuArgs = { action: "status", job_id: "pty_1" };
    const qemuState = (id: string, rip: string): ToolCallState => ({
      ...toolState({
        name: "builtin_qemu",
        args: qemuArgs,
        id,
      }),
      output: [
        {
          name: "QEMU",
          description: "panic",
          content: [
            "Kernel panic - not syncing: Fatal exception",
            `RIP: 0010:${rip}+0x10/0x20`,
            "Call Trace:",
            ` ${rip}+0x10/0x20 mm/filemap.c:42`,
          ].join("\n"),
        },
      ],
    });
    const history = [
      user(),
      assistant([
        qemuState("1", "copy_to_user"),
        qemuState("2", "copy_from_user"),
        qemuState("3", "do_fault"),
      ]),
    ];
    expect(detectDoomLoop(history)).toBeNull();
  });

  it("doom-loops three identical qemu boots with the same RIP", () => {
    const log = [
      "Kernel panic - not syncing: Fatal exception",
      "RIP: 0010:copy_to_user+0x10/0x20",
      "Call Trace:",
      " copy_to_user+0x10/0x20 mm/filemap.c:42",
    ].join("\n");
    const qemuState = (id: string): ToolCallState => ({
      ...toolState({
        name: "builtin_qemu",
        args: { action: "status", job_id: "pty_1" },
        id,
      }),
      output: [{ name: "QEMU", description: "panic", content: log }],
    });
    const history = [
      user(),
      assistant([qemuState("1"), qemuState("2"), qemuState("3")]),
    ];
    expect(detectDoomLoop(history)?.kind).toBe("repeat");
    expect(detectDoomLoop(history)?.toolName).toBe("builtin_qemu");
  });

  it("doom-loops three identical makes with the same error and no edits", () => {
    const log =
      "src/foo.c:12:5: error: implicit declaration of function 'bar'\nmake: *** Error 1";
    const makeState = (id: string): ToolCallState => ({
      ...toolState({
        name: "builtin_run_terminal_command",
        args: { command: "make" },
        id,
      }),
      output: [{ name: "Terminal", description: "exited", content: log }],
    });
    const history = [
      user(),
      assistant([makeState("1"), makeState("2"), makeState("3")]),
    ];
    expect(detectDoomLoop(history)?.kind).toBe("repeat");
    expect(detectDoomLoop(history)?.toolName).toBe(
      "builtin_run_terminal_command",
    );
  });

  it("can be disabled", () => {
    const same = { filepath: "a.ts" };
    const history = [
      user(),
      assistant([
        toolState({ name: "builtin_read_file", args: same, id: "1" }),
        toolState({ name: "builtin_read_file", args: same, id: "2" }),
        toolState({ name: "builtin_read_file", args: same, id: "3" }),
      ]),
    ];
    expect(detectDoomLoop(history, { threshold: null })).toBeNull();
  });
});

describe("buildDoomLoopSummaryInstruction", () => {
  it("forbids further tools", () => {
    const text = buildDoomLoopSummaryInstruction({
      kind: "repeat",
      threshold: 3,
      count: 3,
      toolName: "builtin_read_file",
    });
    expect(text.toLowerCase()).toContain("do not call any tools");
    expect(text).toContain("builtin_read_file");
  });
});
