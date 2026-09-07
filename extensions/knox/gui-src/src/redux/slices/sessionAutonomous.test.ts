import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "core/tools/builtIn";

import sessionReducer, {
  applyAutonomousEvent,
  submitEditorAndInitAtIndex,
} from "./sessionSlice";

function sessionWithPlaceholder(id = "sess-1") {
  let state = sessionReducer(undefined, { type: "unknown" });
  state = {
    ...state,
    id,
  };
  return sessionReducer(
    state,
    submitEditorAndInitAtIndex({
      index: 0,
      editorState: { type: "doc", content: [] },
    }),
  );
}

describe("applyAutonomousEvent", () => {
  it("marks an ask event as generated so the permission bar can show", () => {
    let state = sessionWithPlaceholder();
    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:started",
        data: { session_id: state.id, goal: "patch mm", max_iterations: 4 },
      }),
    );
    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:tool_ask",
        data: {
          session_id: state.id,
          call_id: "ask1",
          name: BuiltInToolNames.EditFile,
          args: { filepath: "mm/filemap.c" },
        },
      }),
    );
    const pending = state.history.at(-1)?.toolCallStates?.[0];
    expect(pending?.status).toBe("generated");
    expect(pending?.toolCall.function.name).toBe(BuiltInToolNames.EditFile);
  });

  it("adds a calling tool card then marks it done with output", () => {
    let state = sessionWithPlaceholder();
    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:tool_start",
        data: {
          session_id: state.id,
          call_id: "c1",
          name: BuiltInToolNames.ReadFile,
          args: { filepath: "mm/filemap.c" },
        },
      }),
    );
    const started = state.history.at(-1)?.toolCallStates?.[0];
    expect(started?.status).toBe("calling");
    expect(started?.toolCall.function.name).toBe(BuiltInToolNames.ReadFile);

    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:tool_end",
        data: {
          session_id: state.id,
          call_id: "c1",
          name: BuiltInToolNames.ReadFile,
          ok: true,
          output: [
            { name: "file", description: "ok", content: "copy_to_user" },
          ],
        },
      }),
    );
    const done = state.history.at(-1)?.toolCallStates?.[0];
    expect(done?.status).toBe("done");
    expect(done?.output?.[0]?.content).toContain("copy_to_user");
  });

  it("ignores events for a different session", () => {
    let state = sessionWithPlaceholder("mine");
    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:tool_start",
        data: {
          session_id: "other",
          call_id: "c1",
          name: BuiltInToolNames.ReadFile,
          args: {},
        },
      }),
    );
    expect(state.history.at(-1)?.toolCallStates).toBeUndefined();
  });

  it("appends assistant text without wiping tool cards", () => {
    let state = sessionWithPlaceholder();
    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:tool_start",
        data: {
          session_id: state.id,
          call_id: "c1",
          name: BuiltInToolNames.ReadFile,
          args: {},
        },
      }),
    );
    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:assistant",
        data: {
          session_id: state.id,
          content: "looked at filemap",
        },
      }),
    );
    expect(state.history.at(-1)?.toolCallStates?.[0]?.toolCallId).toBe("c1");
    expect(state.history.at(-1)?.message.content).toContain("looked at filemap");
  });

  it("tracks outer-loop status without dumping iteration markdown", () => {
    let state = sessionWithPlaceholder();
    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:started",
        data: {
          session_id: state.id,
          goal: "boot panic in mm",
          max_iterations: 10,
        },
      }),
    );
    expect(state.autonomousLoop).toMatchObject({
      status: "running",
      iteration: 0,
      maxIterations: 10,
      goal: "boot panic in mm",
    });

    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:iteration",
        data: {
          session_id: state.id,
          iteration: 3,
          max_iterations: 10,
        },
      }),
    );
    expect(state.autonomousLoop.iteration).toBe(3);
    expect(state.history.at(-1)?.message.content).not.toContain("Iteration");

    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:completed",
        data: { session_id: state.id, iterations: 3 },
      }),
    );
    expect(state.autonomousLoop.status).toBe("completed");
    expect(state.autonomousLoop.iteration).toBe(3);
  });

  it("counts finished autonomous tools toward the turn step meter", () => {
    let state = sessionWithPlaceholder();
    expect(state.toolLoopSteps).toBe(0);
    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:tool_start",
        data: {
          session_id: state.id,
          call_id: "c1",
          name: BuiltInToolNames.ReadFile,
          args: {},
        },
      }),
    );
    state = sessionReducer(
      state,
      applyAutonomousEvent({
        type: "autonomous:tool_end",
        data: {
          session_id: state.id,
          call_id: "c1",
          name: BuiltInToolNames.ReadFile,
          ok: true,
          output: [],
        },
      }),
    );
    expect(state.toolLoopSteps).toBe(1);
  });
});
