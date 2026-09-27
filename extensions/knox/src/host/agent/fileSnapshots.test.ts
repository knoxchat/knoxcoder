import * as assert from "node:assert";

import {
  extractMutatingFilePath,
  extractMutatingFilePaths,
  isMutatingTool,
  MUTATING_TOOL_NAMES,
  parseToolArguments,
} from "./fileSnapshots";

suite("fileSnapshots helpers", () => {
  test("parseToolArguments accepts object and JSON string", () => {
    assert.deepStrictEqual(parseToolArguments({ target_file: "a.ts" }), {
      target_file: "a.ts",
    });
    assert.deepStrictEqual(
      parseToolArguments('{"filepath":"b.ts","contents":"x"}'),
      { filepath: "b.ts", contents: "x" },
    );
  });

  test("parseToolArguments rejects invalid input", () => {
    assert.strictEqual(parseToolArguments(null), null);
    assert.strictEqual(parseToolArguments(""), null);
    assert.strictEqual(parseToolArguments("not-json"), null);
    assert.strictEqual(parseToolArguments(["array"]), null);
  });

  test("extractMutatingFilePath reads known argument keys", () => {
    assert.strictEqual(
      extractMutatingFilePath("composite_smart_edit", { filepath: "src/a.ts" }),
      "src/a.ts",
    );
    assert.strictEqual(
      extractMutatingFilePath("builtin_create_new_file", {
        filepath: "src/b.ts",
      }),
      "src/b.ts",
    );
    assert.strictEqual(
      extractMutatingFilePath("builtin_edit_file", {
        filepath: "src/c.ts",
        old_string: "a",
        new_string: "b",
      }),
      "src/c.ts",
    );
    assert.strictEqual(
      extractMutatingFilePath("builtin_write_file", {
        filepath: "src/d.ts",
        contents: "x",
      }),
      "src/d.ts",
    );
    assert.strictEqual(
      extractMutatingFilePath("builtin_apply_patch", {
        patch: "*** Begin Patch\n*** Update File: src/e.ts\n@@\n-a\n+b\n*** End Patch",
      }),
      "src/e.ts",
    );
    assert.strictEqual(
      extractMutatingFilePath("builtin_generate_tests", {
        filepath: "src/a.ts",
        outputPath: "src/a.test.ts",
      }),
      "src/a.test.ts",
    );
    assert.strictEqual(
      extractMutatingFilePath("builtin_generate_tests", {
        filepath: "src/a.ts",
      }),
      undefined,
    );
    assert.strictEqual(
      extractMutatingFilePath("builtin_read_file", { filepath: "d.ts" }),
      undefined,
    );
  });

  test("extractMutatingFilePaths snapshots every apply_patch path", () => {
    assert.deepStrictEqual(
      extractMutatingFilePaths("builtin_apply_patch", {
        patch:
          "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** Add File: src/b.ts\n+c\n*** End Patch",
      }),
      ["src/a.ts", "src/b.ts"],
    );
    assert.deepStrictEqual(
      extractMutatingFilePaths("builtin_edit_file", {
        filepath: "src/c.ts",
        old_string: "a",
        new_string: "b",
      }),
      ["src/c.ts"],
    );
  });

  test("isMutatingTool matches the mutating set", () => {
    for (const name of MUTATING_TOOL_NAMES) {
      assert.strictEqual(isMutatingTool(name), true);
    }
    assert.strictEqual(isMutatingTool("builtin_read_file"), false);
    assert.strictEqual(isMutatingTool("web_search"), false);
  });
});
