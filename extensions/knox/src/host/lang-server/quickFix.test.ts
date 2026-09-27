import * as assert from "node:assert";

import {
  askKnoxQuickFixSpec,
  buildHighlightedCodeRequest,
  buildQuickFixChatRequest,
  DISABLE_QUICK_FIX_SETTING,
  FOCUS_KNOX_GUI_COMMAND,
  HIGHLIGHTED_CODE_MESSAGE,
  isQuickFixProviderEnabled,
  QUICK_FIX_COMMAND,
  QUICK_FIX_COMMAND_TITLE,
  QUICK_FIX_CONTEXT_LINES,
  QUICK_FIX_KIND,
  QUICK_FIX_TITLE,
  quickFixSurroundingRange,
} from "./quickFix";

suite("KN-345 selection quick-fix → chat", () => {
  test("setting, command, and highlightedCode ids stay the same", () => {
    assert.strictEqual(DISABLE_QUICK_FIX_SETTING, "knoxchat.disableQuickFix");
    assert.strictEqual(QUICK_FIX_COMMAND, "knoxchat.quickFix");
    assert.strictEqual(QUICK_FIX_TITLE, "Ask Knox");
    assert.strictEqual(QUICK_FIX_COMMAND_TITLE, "Knox Quick Fix");
    assert.strictEqual(QUICK_FIX_KIND, "quickfix");
    assert.strictEqual(QUICK_FIX_CONTEXT_LINES, 3);
    assert.strictEqual(HIGHLIGHTED_CODE_MESSAGE, "highlightedCode");
    assert.strictEqual(FOCUS_KNOX_GUI_COMMAND, "knoxchat.knoxGUIView.focus");
    assert.strictEqual(isQuickFixProviderEnabled(undefined), true);
    assert.strictEqual(isQuickFixProviderEnabled(false), true);
    assert.strictEqual(isQuickFixProviderEnabled(true), false);
  });

  test("surrounding range expands ±3 lines and clamps to the document", () => {
    assert.deepStrictEqual(quickFixSurroundingRange(10, 12, 40), {
      startLine: 7,
      startCharacter: 0,
      endLine: 15,
      endCharacter: 0,
    });
    assert.deepStrictEqual(quickFixSurroundingRange(0, 0, 2), {
      startLine: 0,
      startCharacter: 0,
      endLine: 2,
      endCharacter: 0,
    });
    assert.deepStrictEqual(quickFixSurroundingRange(8, 9, 10), {
      startLine: 5,
      startCharacter: 0,
      endLine: 10,
      endCharacter: 0,
    });
  });

  test("Ask Knox posts highlightedCode with prompt and shouldRun", () => {
    const surrounding = quickFixSurroundingRange(4, 4, 20);
    const spec = askKnoxQuickFixSpec(surrounding, "Cannot find name 'foo'");
    assert.strictEqual(spec.title, "Ask Knox");
    assert.strictEqual(spec.kind, "quickfix");
    assert.strictEqual(spec.isPreferred, false);
    assert.strictEqual(spec.command.command, QUICK_FIX_COMMAND);
    assert.deepStrictEqual(spec.command.arguments, [
      surrounding,
      "Cannot find name 'foo'",
    ]);

    const request = buildQuickFixChatRequest(
      {
        filepath: "file:///src/a.ts",
        contents: "const foo = 1;",
        range: {
          start: { line: 1, character: 0 },
          end: { line: 7, character: 0 },
        },
      },
      "Please explain the cause of this error and how to solve it: Cannot find name 'foo'",
    );
    assert.strictEqual(request.shouldRun, true);
    assert.ok(request.prompt?.includes("Cannot find name 'foo'"));
    assert.strictEqual(request.rangeInFileWithContents.filepath, "file:///src/a.ts");

    const mentionOnly = buildHighlightedCodeRequest({
      filepath: "file:///src/a.ts",
      contents: "x",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    });
    assert.strictEqual(mentionOnly.shouldRun, undefined);
    assert.strictEqual(mentionOnly.prompt, undefined);
  });
});
