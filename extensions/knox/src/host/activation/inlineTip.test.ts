import * as assert from "node:assert";

import {
  calculateInlineTipPosition,
  emptyFileTipText,
  hideInlineTipHoverMarkdown,
  HIDE_INLINE_TIP_COMMAND,
  INLINE_TIP_CHAT_KEY,
  INLINE_TIP_DEBOUNCE_MS,
  INLINE_TIP_EDIT_KEY,
  INLINE_TIP_EXCLUDED_SCHEME,
  INLINE_TIP_EXCLUDED_URI_PREFIXES,
  INLINE_TIP_LINE_OFFSET,
  inlineTipShortcut,
  shouldRenderInlineTip,
  SHOW_INLINE_TIP_SETTING,
  type InlineTipLineDoc,
} from "./inlineTip";

function doc(lines: string[]): InlineTipLineDoc {
  return {
    lineCount: lines.length,
    lineText: (line) => lines[line] ?? "",
  };
}

suite("KN-345 inline tips", () => {
  test("setting, hide command, and debounce keep the same ids", () => {
    assert.strictEqual(SHOW_INLINE_TIP_SETTING, "knoxchat.showInlineTip");
    assert.strictEqual(HIDE_INLINE_TIP_COMMAND, "knoxchat.hideInlineTip");
    assert.strictEqual(INLINE_TIP_DEBOUNCE_MS, 500);
    assert.strictEqual(INLINE_TIP_LINE_OFFSET, 4);
    assert.deepStrictEqual([...INLINE_TIP_EXCLUDED_URI_PREFIXES], [
      "output:",
      "vscode://inline-chat",
    ]);
    assert.strictEqual(INLINE_TIP_EXCLUDED_SCHEME, "comment");
    assert.strictEqual(inlineTipShortcut("⌘", INLINE_TIP_CHAT_KEY), "⌘ + L");
    assert.strictEqual(inlineTipShortcut("Ctrl", INLINE_TIP_EDIT_KEY), "Ctrl + I");
    assert.strictEqual(emptyFileTipText("Cmd"), "Use Cmd + I to generate code");
    assert.strictEqual(
      hideInlineTipHoverMarkdown(),
      "[Hide hint](command:knoxchat.hideInlineTip)",
    );
  });

  test("shouldRenderInlineTip requires the setting and skips output/comment uris", () => {
    const file = {
      uri: "file:///src/a.ts",
      scheme: "file",
      enabled: true,
    };
    assert.strictEqual(shouldRenderInlineTip(file), true);
    assert.strictEqual(shouldRenderInlineTip({ ...file, enabled: false }), false);
    assert.strictEqual(
      shouldRenderInlineTip({
        uri: "output:extension-output-vscode.knox",
        scheme: "output",
        enabled: true,
      }),
      false,
    );
    assert.strictEqual(
      shouldRenderInlineTip({
        uri: "vscode://inline-chat/session",
        scheme: "vscode",
        enabled: true,
      }),
      false,
    );
    assert.strictEqual(
      shouldRenderInlineTip({
        uri: "comment://thread",
        scheme: "comment",
        enabled: true,
      }),
      false,
    );
  });

  test("calculateInlineTipPosition skips empty content and places after the line", () => {
    const lines = doc(["hello"]);
    assert.strictEqual(
      calculateInlineTipPosition(doc(["   "]), {
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 2,
      }),
      null,
    );
    assert.deepStrictEqual(
      calculateInlineTipPosition(lines, {
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 5,
      }),
      { line: 0, character: 5 + INLINE_TIP_LINE_OFFSET },
    );
    assert.deepStrictEqual(
      calculateInlineTipPosition(doc(["hello  "]), {
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 3,
      }),
      { line: 0, character: 5 + INLINE_TIP_LINE_OFFSET },
    );
  });

  test("multi-line tip sits after the longer of the first non-empty line and the line above", () => {
    assert.deepStrictEqual(
      calculateInlineTipPosition(doc(["short", "longer line", "x"]), {
        startLine: 1,
        startCharacter: 1,
        endLine: 2,
        endCharacter: 1,
      }),
      { line: 1, character: "longer line".length + INLINE_TIP_LINE_OFFSET },
    );
    assert.deepStrictEqual(
      calculateInlineTipPosition(doc(["very long prefix here", "hi", "z"]), {
        startLine: 1,
        startCharacter: 0,
        endLine: 2,
        endCharacter: 1,
      }),
      {
        line: 1,
        character: "very long prefix here".length + INLINE_TIP_LINE_OFFSET,
      },
    );
    assert.deepStrictEqual(
      calculateInlineTipPosition(doc(["a", "bbb", "cc", "d"]), {
        startLine: 1,
        startCharacter: 0,
        endLine: 3,
        endCharacter: 0,
      }),
      { line: 1, character: 3 + INLINE_TIP_LINE_OFFSET },
    );
    assert.strictEqual(
      calculateInlineTipPosition(doc(["", "", ""]), {
        startLine: 0,
        startCharacter: 0,
        endLine: 2,
        endCharacter: 0,
      }),
      null,
    );
  });
});
