import * as assert from "node:assert";

import {
  ADD_CODE_TO_EDIT_MESSAGE,
  EDIT_EXIT_MESSAGE,
  EDIT_SEND_PROMPT_MESSAGE,
  EXIT_EDIT_MODE_COMMAND,
  EXIT_EDIT_MODE_MESSAGE,
  FOCUS_EDIT_COMMAND,
  FOCUS_EDIT_MESSAGE,
  FOCUS_EDIT_WITHOUT_CLEAR_COMMAND,
  FOCUS_EDIT_WITHOUT_CLEAR_MESSAGE,
  IN_EDIT_MODE_CONTEXT,
  SET_EDIT_STATUS_MESSAGE,
  buildCodeToEditPayload,
  buildWholeFileCodeToEdit,
  buildWholeLineEditRange,
  lastIncludedLineForEditSelection,
  leadingWhitespaceExpandsSelection,
  shouldSkipAddCodeToEdit,
} from "./editMode";

suite("KN-346 Cmd/Ctrl+I edit mode", () => {
  test("command, protocol, and context ids stay the same", () => {
    assert.strictEqual(FOCUS_EDIT_COMMAND, "knoxchat.focusEdit");
    assert.strictEqual(FOCUS_EDIT_WITHOUT_CLEAR_COMMAND, "knoxchat.focusEditWithoutClear");
    assert.strictEqual(EXIT_EDIT_MODE_COMMAND, "knoxchat.exitEditMode");
    assert.strictEqual(IN_EDIT_MODE_CONTEXT, "knoxchat.inEditMode");
    assert.strictEqual(FOCUS_EDIT_MESSAGE, "focusEdit");
    assert.strictEqual(FOCUS_EDIT_WITHOUT_CLEAR_MESSAGE, "focusEditWithoutClear");
    assert.strictEqual(ADD_CODE_TO_EDIT_MESSAGE, "addCodeToEdit");
    assert.strictEqual(EXIT_EDIT_MODE_MESSAGE, "exitEditMode");
    assert.strictEqual(EDIT_SEND_PROMPT_MESSAGE, "edit/sendPrompt");
    assert.strictEqual(EDIT_EXIT_MESSAGE, "edit/exit");
    assert.strictEqual(SET_EDIT_STATUS_MESSAGE, "setEditStatus");
  });

  test("Cmd+I whole-line range trims a trailing empty line", () => {
    assert.strictEqual(
      lastIncludedLineForEditSelection({
        startLine: 2,
        startCharacter: 0,
        endLine: 5,
        endCharacter: 0,
      }),
      4,
    );
    assert.strictEqual(
      lastIncludedLineForEditSelection({
        startLine: 3,
        startCharacter: 0,
        endLine: 3,
        endCharacter: 0,
      }),
      3,
    );
    assert.deepStrictEqual(
      buildWholeLineEditRange(
        {
          startLine: 1,
          startCharacter: 4,
          endLine: 3,
          endCharacter: 2,
        },
        18,
      ),
      {
        start: { line: 1, character: 0 },
        end: { line: 3, character: 18 },
      },
    );
  });

  test("indent-only prefixes expand contents to column 0", () => {
    assert.strictEqual(leadingWhitespaceExpandsSelection("  \t"), true);
    assert.strictEqual(leadingWhitespaceExpandsSelection("const x"), false);
    assert.strictEqual(shouldSkipAddCodeToEdit(true), true);
    assert.strictEqual(shouldSkipAddCodeToEdit(false), false);
  });

  test("addCodeToEdit payloads keep a range for selection and omit it for whole files", () => {
    assert.deepStrictEqual(
      buildCodeToEditPayload({
        filepath: "file:///src/a.ts",
        contents: "const x = 1;",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 12 },
        },
      }),
      {
        filepath: "file:///src/a.ts",
        contents: "const x = 1;",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 12 },
        },
      },
    );
    assert.deepStrictEqual(
      buildWholeFileCodeToEdit("file:///src/a.ts", "export {};\n"),
      { filepath: "file:///src/a.ts", contents: "export {};\n" },
    );
  });
});
