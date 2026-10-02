import { describe, expect, it } from "vitest";

import {
  ToolCallError,
  ToolCallErrorCode,
  formatToolErrorForModel,
  isToolInputError,
  toolFailureCategory,
} from "./errors";

const classify = (message: string) => ToolCallError.from(new Error(message), "builtin_x");

describe("ToolCallError.from classification", () => {
  it("does not treat 'workspace' / 'editor' wording as a transient IDE failure", () => {
    const err = classify(
      "Failed to resolve file path 'x.rs': Could not find file x.rs Use a workspace-relative path (e.g. src/main.rs).",
    );
    expect(err.code).toBe(ToolCallErrorCode.FILE_NOT_FOUND);
    expect(err.retryable).toBe(false);

    const editorMention = classify("Patch for \"editor/config.ts\" produced no changes.");
    expect(editorMention.retryable).toBe(false);
    expect(editorMention.code).toBe(ToolCallErrorCode.INVALID_ARGUMENTS);
  });

  it("classifies edit/patch input mistakes as non-retryable input errors", () => {
    for (const message of [
      "old_string and new_string are identical; nothing would change.",
      "old_string was not found in \"a.ts\".",
      "Patch for \"src/main.rs\" produced no changes.",
      "old_string matched 3 times in \"a.ts\".",
    ]) {
      const err = classify(message);
      expect(err.retryable, message).toBe(false);
      expect(isToolInputError(err.code), message).toBe(true);
    }
  });

  it("still retries genuine transient failures", () => {
    expect(classify("ECONNRESET while fetching").retryable).toBe(true);
    expect(classify("Tool timed out after 30000ms").retryable).toBe(true);
    expect(classify("Extension host: editor disposed").retryable).toBe(true);
    expect(classify("429 Too Many Requests").retryable).toBe(true);
  });

  it("maps unknown tools", () => {
    expect(classify('Tool "foo" not found.').code).toBe(ToolCallErrorCode.TOOL_NOT_FOUND);
  });
});

describe("toolFailureCategory", () => {
  it("uses the InvalidJson / UnknownName / SchemaMismatch buckets", () => {
    const mk = (code: ToolCallErrorCode) =>
      new ToolCallError({ code, message: "m", toolName: "t" });
    expect(toolFailureCategory(mk(ToolCallErrorCode.ARGUMENT_PARSE_ERROR))).toBe("InvalidJson");
    expect(toolFailureCategory(mk(ToolCallErrorCode.TOOL_NOT_FOUND))).toBe("UnknownName");
    expect(toolFailureCategory(mk(ToolCallErrorCode.MISSING_REQUIRED_PARAM))).toBe("SchemaMismatch");
    expect(toolFailureCategory(mk(ToolCallErrorCode.CANCELLED))).toBe("Cancelled");
    expect(toolFailureCategory(mk(ToolCallErrorCode.NETWORK_ERROR))).toBe("Execution");
  });
});

describe("formatToolErrorForModel", () => {
  it("prefixes the code once and adds a recovery hint", () => {
    const err = new ToolCallError({
      code: ToolCallErrorCode.FILE_NOT_FOUND,
      message: "File missing",
      toolName: "t",
    });
    const text = formatToolErrorForModel(err);
    expect(text.startsWith("FILE_NOT_FOUND: File missing")).toBe(true);
    expect(text).toMatch(/builtin_glob/);
    expect(formatToolErrorForModel(new ToolCallError({
      code: ToolCallErrorCode.NETWORK_ERROR,
      message: "NETWORK_ERROR: down",
      toolName: "t",
    }))).toBe("NETWORK_ERROR: down");
  });
});
