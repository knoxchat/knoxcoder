import { describe, expect, it } from "vitest";

import { ToolCallError, ToolCallErrorCode } from "../tools/errors";

import { describeProtocolError } from "./describeProtocolError";

const t = (key: string, vars?: Record<string, string | number>) =>
  key === "connection.requestFailed"
    ? `Request failed with "${vars?.name}": ${vars?.message}. If you are having trouble setting up KnoxStudio, see the troubleshooting guide for assistance.`
    : key;

describe("describeProtocolError", () => {
  it("keeps tool failures as tool failures even though ToolCallError carries a cause", () => {
    const err = ToolCallError.from(
      new Error("old_string and new_string are identical; nothing would change."),
      "builtin_edit_file",
    );
    expect(err.cause).toBeDefined();
    const text = describeProtocolError(err, "tools/call", t);
    expect(text).not.toMatch(/Request failed|troubleshooting/i);
    expect(text).toMatch(/^INVALID_ARGUMENTS: old_string and new_string are identical/);
  });

  it("does not mislabel plain tool-route errors with a cause", () => {
    const err = Object.assign(new Error("Tool x cancelled"), {
      cause: { name: "Error", message: "inner" },
    });
    expect(describeProtocolError(err, "tools/call", t)).toBe("Tool x cancelled");
  });

  it("recognizes ToolCallError by shape after serialization", () => {
    const err = Object.assign(new Error("bad path"), {
      name: "ToolCallError",
      code: ToolCallErrorCode.FILE_NOT_FOUND,
      cause: { name: "Error", message: "bad path" },
    });
    expect(describeProtocolError(err, undefined, t)).toMatch(/^FILE_NOT_FOUND: bad path/);
  });

  it("still reports real connection failures on non-tool requests", () => {
    const timeout = Object.assign(new Error("fetch failed"), {
      cause: { name: "ConnectTimeoutError" },
    });
    expect(describeProtocolError(timeout, "llm/streamChat", t)).toBe("connection.timeout");
    const refused = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(describeProtocolError(refused, "llm/streamChat", t)).toBe("connection.refused");
    const other = Object.assign(new Error("fetch failed"), {
      cause: { name: "SocketError", message: "other side closed" },
    });
    expect(describeProtocolError(other, "llm/streamChat", t)).toMatch(/SocketError.*other side closed/);
  });

  it("passes through errors without a cause", () => {
    expect(describeProtocolError(new Error("plain"), "foo", t)).toBe("plain");
  });
});
