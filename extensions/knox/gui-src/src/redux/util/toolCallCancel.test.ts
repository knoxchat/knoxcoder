import { describe, expect, it } from "vitest";

import {
  isCancelledToolError,
  isUserStoppedToolCall,
  shouldAbortToolContinuation,
  shouldResumeAfterUnexpectedAbort,
} from "./toolCallCancel";

const base = {
  toolCallId: "tc1",
  toolCall: {
    id: "tc1",
    type: "function" as const,
    function: { name: "builtin_run_terminal_command", arguments: "{}" },
  },
  parsedArgs: {},
};

describe("shouldAbortToolContinuation", () => {
  it("aborts when there is no tool call", () => {
    expect(shouldAbortToolContinuation(undefined)).toBe(true);
  });

  it("continues only while status is calling", () => {
    expect(
      shouldAbortToolContinuation({ ...base, status: "calling" }),
    ).toBe(false);
    expect(
      shouldAbortToolContinuation({ ...base, status: "canceled" }),
    ).toBe(true);
    expect(
      shouldAbortToolContinuation({ ...base, status: "done" }),
    ).toBe(true);
    expect(
      shouldAbortToolContinuation({ ...base, status: "generated" }),
    ).toBe(true);
  });
});

describe("isUserStoppedToolCall", () => {
  it("treats only canceled as a user Stop", () => {
    expect(isUserStoppedToolCall({ ...base, status: "canceled" })).toBe(true);
  });

  it("does not treat a missing lookup as a user Stop", () => {
    expect(isUserStoppedToolCall(undefined)).toBe(false);
  });

  it("does not treat an in-flight call as a user Stop", () => {
    expect(isUserStoppedToolCall({ ...base, status: "calling" })).toBe(false);
    expect(isUserStoppedToolCall({ ...base, status: "done" })).toBe(false);
  });
});

describe("isCancelledToolError", () => {
  it("detects cancel/abort wording", () => {
    expect(isCancelledToolError("Tool cancelled")).toBe(true);
    expect(isCancelledToolError("Operation canceled by user")).toBe(true);
    expect(isCancelledToolError("The operation was aborted")).toBe(true);
    expect(isCancelledToolError("file not found")).toBe(false);
    expect(isCancelledToolError(undefined)).toBe(false);
  });
});

describe("shouldResumeAfterUnexpectedAbort", () => {
  it("resumes when Core aborted but the GUI call is still in-flight", () => {
    expect(
      shouldResumeAfterUnexpectedAbort(
        { ...base, status: "calling" },
        "Tool \"builtin_run_terminal_command\" cancelled",
      ),
    ).toBe(true);
    expect(
      shouldResumeAfterUnexpectedAbort(
        { ...base, status: "calling" },
        "The operation was aborted",
      ),
    ).toBe(true);
  });

  it("does not resume after the user hits Stop", () => {
    expect(
      shouldResumeAfterUnexpectedAbort(
        { ...base, status: "canceled" },
        "Tool cancelled",
      ),
    ).toBe(false);
  });

  it("does not resume for a normal tool error", () => {
    expect(
      shouldResumeAfterUnexpectedAbort(
        { ...base, status: "calling" },
        "file not found",
      ),
    ).toBe(false);
  });
});
