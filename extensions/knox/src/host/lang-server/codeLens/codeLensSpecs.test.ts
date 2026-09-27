import * as assert from "node:assert";

import {
  CODELENS_COMMANDS,
  ENABLE_QUICK_ACTIONS_SETTING,
  quickActionCodeLensSpecs,
  quickActionCommands,
  shiftVerticalDiffCodeLensBlocks,
  suggestionCodeLensSpecs,
  verticalPerLineCodeLensSpecs,
} from "./codeLensSpecs";

suite("KN-341 CodeLens specs", () => {
  test("vertical per-line emits Accept/Reject with block index", () => {
    const uri = "file:///src/a.ts";
    const specs = verticalPerLineCodeLensSpecs(uri, [
      { start: 2, numRed: 1, numGreen: 2 },
      { start: 10, numRed: 0, numGreen: 1 },
    ]);
    assert.strictEqual(specs.length, 4);
    assert.deepStrictEqual(specs[0].command, {
      title: "Accept",
      command: CODELENS_COMMANDS.acceptVerticalBlock,
      arguments: [uri, 0],
    });
    assert.deepStrictEqual(specs[1].command, {
      title: "Reject",
      command: CODELENS_COMMANDS.rejectVerticalBlock,
      arguments: [uri, 0],
    });
    assert.strictEqual(specs[0].startLine, 2);
    assert.strictEqual(specs[0].endLine, 5);
    assert.deepStrictEqual(specs[2].command.arguments, [uri, 1]);
    assert.deepStrictEqual(verticalPerLineCodeLensSpecs(uri, []), []);
  });

  test("suggestions emit Accept/Reject and an Accept/Reject All hint on the first pair", () => {
    const first = { oldRange: 1, newRange: 2 };
    const second = { oldRange: 8, newRange: 9 };
    const specs = suggestionCodeLensSpecs(
      [
        { oldStartLine: 1, newEndLine: 4, suggestion: first },
        { oldStartLine: 8, newEndLine: 10, suggestion: second },
      ],
      "(⌘⇧⏎/⌘⇧⌫ Accept/Reject All)",
    );
    assert.strictEqual(specs.length, 5);
    assert.strictEqual(specs[0].command.command, CODELENS_COMMANDS.acceptSuggestion);
    assert.deepStrictEqual(specs[0].command.arguments, [first]);
    assert.strictEqual(specs[1].command.command, CODELENS_COMMANDS.rejectSuggestion);
    assert.strictEqual(specs[2].command.command, "");
    assert.ok(specs[2].command.title.includes("Accept/Reject All"));
    assert.strictEqual(specs[3].command.command, CODELENS_COMMANDS.acceptSuggestion);
    assert.deepStrictEqual(specs[3].command.arguments, [second]);
  });

  test("knoxchat.enableQuickActions gates default and custom actions", () => {
    assert.strictEqual(ENABLE_QUICK_ACTIONS_SETTING, "knoxchat.enableQuickActions");
    const range = { startLine: 3, endLine: 12 };
    assert.deepStrictEqual(
      quickActionCodeLensSpecs(false, [{ ...range, range }]),
      [],
    );
    const defaults = quickActionCodeLensSpecs(true, [{ ...range, range }]);
    assert.strictEqual(defaults.length, 1);
    assert.strictEqual(defaults[0].command.command, CODELENS_COMMANDS.defaultQuickAction);
    assert.strictEqual(defaults[0].command.title, "Knox");
    assert.deepStrictEqual(defaults[0].command.arguments, [{ range }]);

    const custom = quickActionCommands([
      { title: "Docstring", prompt: "Write a docstring", sendToChat: false },
      { title: "Explain", prompt: "Explain this", sendToChat: true },
    ]);
    assert.strictEqual(custom[0].command, CODELENS_COMMANDS.customQuickActionInline);
    assert.strictEqual(custom[1].command, CODELENS_COMMANDS.customQuickActionChat);
    assert.deepStrictEqual(
      quickActionCodeLensSpecs(true, [{ ...range, range }], []),
      [],
    );
  });

  test("shiftVerticalDiffCodeLensBlocks drops the accepted block and moves later ones", () => {
    const blocks = [
      { start: 2, numRed: 1, numGreen: 1 },
      { start: 8, numRed: 0, numGreen: 2 },
    ];
    assert.deepStrictEqual(shiftVerticalDiffCodeLensBlocks(blocks, 2, -2), [
      { start: 6, numRed: 0, numGreen: 2 },
    ]);
    assert.deepStrictEqual(shiftVerticalDiffCodeLensBlocks(blocks, 8, 1), [
      { start: 2, numRed: 1, numGreen: 1 },
    ]);
  });
});
