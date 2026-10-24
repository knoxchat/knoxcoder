import { describe, expect, it } from "vitest";

import { Tool } from "..";
import { ToolCallError, ToolCallErrorCode } from "./errors";
import { BuiltInToolNames } from "./builtIn";
import {
  getRequiredToolParams,
  isMissingToolArg,
  normalizeToolArgs,
  validateToolArgs,
} from "./middleware";
import { createNewFileTool } from "./definitions/createNewFile";
import { writeFileTool } from "./definitions/writeFile";
import { smartFileEditorTool } from "./definitions/composite";
import { lspTool } from "./definitions/lsp";
import { planTool } from "./definitions/plan";

describe("isMissingToolArg", () => {
  it("treats undefined, null, and blank strings as missing", () => {
    expect(isMissingToolArg(undefined)).toBe(true);
    expect(isMissingToolArg(null)).toBe(true);
    expect(isMissingToolArg("")).toBe(true);
    expect(isMissingToolArg("   ")).toBe(true);
  });

  it("accepts non-empty strings and other values", () => {
    expect(isMissingToolArg("ok")).toBe(false);
    expect(isMissingToolArg(0)).toBe(false);
    expect(isMissingToolArg(false)).toBe(false);
  });
});

describe("getRequiredToolParams", () => {
  it("prefers Tool JSON Schema required over fallback map", () => {
    expect(getRequiredToolParams("composite_smart_edit", smartFileEditorTool)).toEqual(
      ["filepath", "modification"],
    );
  });

  it("falls back to builtin map when schema has no required", () => {
    const bare: Tool = {
      type: "function",
      displayTitle: "Bare",
      readonly: true,
      group: "test",
      function: {
        name: BuiltInToolNames.SearchWeb,
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
    };
    expect(getRequiredToolParams(BuiltInToolNames.SearchWeb, bare)).toEqual([
      "query",
    ]);
  });
});

describe("validateToolArgs fail-closed", () => {
  it("rejects create_new_file without contents (schema)", () => {
    expect(() =>
      validateToolArgs(
        BuiltInToolNames.CreateNewFile,
        { filepath: "a.ts" },
        createNewFileTool,
      ),
    ).toThrow(ToolCallError);

    try {
      validateToolArgs(
        BuiltInToolNames.CreateNewFile,
        { filepath: "a.ts", contents: "   " },
        createNewFileTool,
      );
    } catch (e) {
      expect(e).toBeInstanceOf(ToolCallError);
      expect((e as ToolCallError).code).toBe(
        ToolCallErrorCode.MISSING_REQUIRED_PARAM,
      );
      expect((e as ToolCallError).message).toMatch(/placeholders are not accepted/i);
      expect((e as ToolCallError).message).toMatch(/contents/);
      return;
    }
    expect.fail("expected throw");
  });

  it("accepts complete create_new_file args", () => {
    expect(() =>
      validateToolArgs(
        BuiltInToolNames.CreateNewFile,
        { filepath: "a.ts", contents: "export {}" },
        createNewFileTool,
      ),
    ).not.toThrow();
  });

  it("rejects composite_smart_edit missing modification", () => {
    expect(() =>
      validateToolArgs(
        "composite_smart_edit",
        { filepath: "x.ts" },
        smartFileEditorTool,
      ),
    ).toThrow(/modification/);
  });

  it("rejects blank query via fallback map when no tool schema", () => {
    expect(() =>
      validateToolArgs(BuiltInToolNames.SearchWeb, { query: "" }),
    ).toThrow(/query/);
  });

  it("accepts workspaceSymbol with operation + query only", () => {
    expect(() =>
      validateToolArgs(
        BuiltInToolNames.Lsp,
        { operation: "workspaceSymbol", query: "copy_process" },
        lspTool,
      ),
    ).not.toThrow();
  });
});

describe("normalizeToolArgs", () => {
  it("copies path → filepath for read_file when filepath is missing", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.ReadFile, {
        path: "backend/src/relay/channeltype.rs",
      }),
    ).toMatchObject({
      filepath: "backend/src/relay/channeltype.rs",
    });
  });

  it("does not overwrite an existing filepath", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.ReadFile, {
        filepath: "a.ts",
        path: "b.ts",
      }),
    ).toMatchObject({ filepath: "a.ts" });
  });

  it("applies the Settings maxFiles default for view_subdirectory", () => {
    expect(
      normalizeToolArgs(
        BuiltInToolNames.ViewSubdirectory,
        { directory_path: "src" },
        { defaultMaxFiles: 5000 },
      ).maxFiles,
    ).toBe(5000);
  });

  it("maps Pi/Claude oldText/newText → old_string/new_string for edit_file", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.EditFile, {
        path: "src/a.ts",
        oldText: "foo",
        newText: "bar",
      }),
    ).toMatchObject({
      filepath: "src/a.ts",
      old_string: "foo",
      new_string: "bar",
    });
    expect(
      normalizeToolArgs(BuiltInToolNames.EditFile, {
        filepath: "a.ts",
        edits: JSON.stringify([{ oldText: "a", newText: "b" }]),
      }).edits,
    ).toMatchObject([{ old_string: "a", new_string: "b" }]);
    expect(
      normalizeToolArgs(BuiltInToolNames.EditFile, {
        filepath: "a.ts",
        edits: [{ search: "a", replace: "b" }, { oldString: "c", newString: ["d"] }],
      }).edits,
    ).toMatchObject([
      { old_string: "a", new_string: "b" },
      { old_string: "c", new_string: "d" },
    ]);
  });

  it("maps diff → patch for apply_patch", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.ApplyPatch, {
        diff: "*** Begin Patch\n*** End Patch",
      }),
    ).toMatchObject({ patch: "*** Begin Patch\n*** End Patch" });
  });

  it("maps content/text aliases → contents for write_file and create_new_file", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.WriteFile, {
        path: "src/main.rs",
        content: "fn main() {}",
      }),
    ).toMatchObject({ filepath: "src/main.rs", contents: "fn main() {}" });
    expect(
      normalizeToolArgs(BuiltInToolNames.CreateNewFile, {
        filepath: "a.rs",
        file_content: "// a",
      }),
    ).toMatchObject({ contents: "// a" });
  });

  it("explains missing contents on write_file with received params", () => {
    expect(() =>
      validateToolArgs(
        BuiltInToolNames.WriteFile,
        { filepath: "src/main.rs" },
        writeFileTool,
      ),
    ).toThrow(/received: filepath[\s\S]*cut off/);
  });

  it("maps directory → directory_path", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.ViewSubdirectory, {
        directory: "backend",
      }),
    ).toMatchObject({ directory_path: "backend" });
  });

  it("maps read_file_line-style line aliases", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.ReadFile, {
        file_path: "src/main.rs",
        start_line: 760,
        end_line: 840,
      }),
    ).toMatchObject({
      filepath: "src/main.rs",
      startLine: 760,
      endLine: 840,
    });
  });

  it("strips path junk and lifts :line into startLine for read_file", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.ReadFile, {
        filepath: ">kernel/src/interrupts.rs:40",
      }),
    ).toMatchObject({
      filepath: "kernel/src/interrupts.rs",
      startLine: 40,
    });
  });

  it("strips quoted blockquote paths on write_file", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.WriteFile, {
        filepath: '">src/main.rs"',
        contents: "fn main() {}",
      }),
    ).toMatchObject({ filepath: "src/main.rs" });
  });

  it("heals builtin_plan aliases and does not require action", () => {
    expect(() => validateToolArgs(BuiltInToolNames.Plan, {}, planTool)).not.toThrow();
    expect(
      normalizeToolArgs(BuiltInToolNames.Plan, {
        action: "Start",
        items: ["Scaffold", "Verify"],
        goal: "Dioxus snake",
      }),
    ).toMatchObject({
      action: "create",
      steps: ["Scaffold", "Verify"],
      title: "Dioxus snake",
    });
  });

  it("maps grep-style search aliases", () => {
    expect(
      normalizeToolArgs(BuiltInToolNames.ExactSearch, {
        pattern: "Game::new",
        glob: "src/**/*.rs",
        output_mode: "content",
        head_limit: 20,
      }),
    ).toMatchObject({
      query: "Game::new",
      fileGlob: "src/**/*.rs",
      outputMode: "content",
      maxResults: 20,
    });
  });
});
