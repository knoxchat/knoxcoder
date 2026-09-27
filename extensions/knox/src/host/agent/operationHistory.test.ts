import * as assert from "node:assert";

import {
  buildOperationHistoryPickItems,
  changedSnapshotPairs,
  CLEAR_OPERATION_HISTORY_COMMAND,
  describeSnapshotChange,
  ENHANCED_REDO_COMMAND,
  ENHANCED_UNDO_COMMAND,
  findLatestOperationIndexForPath,
  formatSnapshotChangeDetail,
  KNOX_CAN_REDO_CONTEXT_KEY,
  KNOX_CAN_UNDO_CONTEXT_KEY,
  LEGACY_REDO_LAST_OPERATION_COMMAND,
  OPERATION_HISTORY_MAX_SIZE,
  operationHistoryInspectPayload,
  OperationHistoryStack,
  pathsLikelyMatch,
  REDO_LAST_OPERATION_COMMAND,
  SHOW_OPERATION_HISTORY_COMMAND,
  snapshotBytesEqual,
  UNDO_LAST_OPERATION_COMMAND,
} from "./operationHistory";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function snap(content: Uint8Array | null): { content: Uint8Array | null } {
  return { content };
}

suite("KN-351 operation history", () => {
  test("command and context-key ids stay contributed", () => {
    assert.strictEqual(ENHANCED_UNDO_COMMAND, "knox.enhancedUndo");
    assert.strictEqual(ENHANCED_REDO_COMMAND, "knox.enhancedRedo");
    assert.strictEqual(UNDO_LAST_OPERATION_COMMAND, "knox.undoLastOperation");
    assert.strictEqual(REDO_LAST_OPERATION_COMMAND, "knox.redoLastOperation");
    assert.strictEqual(
      LEGACY_REDO_LAST_OPERATION_COMMAND,
      "knox.chatoLastOperation",
    );
    assert.strictEqual(
      SHOW_OPERATION_HISTORY_COMMAND,
      "knox.showOperationHistory",
    );
    assert.strictEqual(
      CLEAR_OPERATION_HISTORY_COMMAND,
      "knox.clearOperationHistory",
    );
    assert.strictEqual(KNOX_CAN_UNDO_CONTEXT_KEY, "knoxCanUndo");
    assert.strictEqual(KNOX_CAN_REDO_CONTEXT_KEY, "knoxCanRedo");
    assert.strictEqual(OPERATION_HISTORY_MAX_SIZE, 100);
  });

  test("record / undo / redo restore the same ops and a new record clears redo", () => {
    const stack = new OperationHistoryStack<string>();
    stack.record("a");
    stack.record("b");
    assert.strictEqual(stack.canUndo(), true);
    assert.strictEqual(stack.canRedo(), false);

    const undone = stack.takeUndo();
    assert.strictEqual(undone, "b");
    stack.commitUndo(undone!);
    assert.strictEqual(stack.canRedo(), true);
    assert.deepStrictEqual([...stack.undoStack], ["a"]);
    assert.deepStrictEqual([...stack.redoStack], ["b"]);

    const redone = stack.takeRedo();
    assert.strictEqual(redone, "b");
    stack.commitRedo(redone!);
    assert.strictEqual(stack.canRedo(), false);
    assert.deepStrictEqual([...stack.undoStack], ["a", "b"]);

    const again = stack.takeUndo();
    stack.commitUndo(again!);
    stack.record("c");
    assert.deepStrictEqual([...stack.undoStack], ["a", "c"]);
    assert.deepStrictEqual([...stack.redoStack], []);
  });

  test("failed undo puts the op back; cap drops the oldest", () => {
    const stack = new OperationHistoryStack<number>(2);
    stack.record(1);
    stack.record(2);
    stack.record(3);
    assert.deepStrictEqual([...stack.undoStack], [2, 3]);

    const taken = stack.takeUndo();
    assert.strictEqual(taken, 3);
    stack.restoreUndo(taken!);
    assert.deepStrictEqual([...stack.undoStack], [2, 3]);
    assert.strictEqual(stack.canRedo(), false);
  });

  test("snapshot equality skips no-op mutations", () => {
    assert.strictEqual(snapshotBytesEqual(snap(null), snap(null)), true);
    assert.strictEqual(snapshotBytesEqual(snap(bytes("a")), snap(null)), false);
    assert.strictEqual(
      snapshotBytesEqual(snap(bytes("ab")), snap(bytes("ab"))),
      true,
    );
    assert.strictEqual(
      snapshotBytesEqual(snap(bytes("ab")), snap(bytes("ac"))),
      false,
    );
    assert.deepStrictEqual(
      changedSnapshotPairs([
        { before: snap(bytes("a")), after: snap(bytes("a")) },
        { before: snap(null), after: snap(bytes("b")) },
      ]),
      [{ before: snap(null), after: snap(bytes("b")) }],
    );
  });

  test("pathsLikelyMatch and latest-op lookup follow the file", () => {
    assert.strictEqual(pathsLikelyMatch("src/a.ts", "src/a.ts"), true);
    assert.strictEqual(
      pathsLikelyMatch("file:///Users/me/src/a.ts", "src/a.ts"),
      true,
    );
    assert.strictEqual(pathsLikelyMatch("src/a.ts", "src/b.ts"), false);
    const ops = [
      { context: { filePath: "src/a.ts" } },
      { context: { filePath: "src/b.ts" } },
      { context: { filePath: "src/a.ts" } },
    ];
    assert.strictEqual(findLatestOperationIndexForPath(ops, "src/a.ts"), 2);
    assert.strictEqual(findLatestOperationIndexForPath(ops, "src/b.ts"), 1);
    assert.strictEqual(findLatestOperationIndexForPath(ops, "src/c.ts"), -1);
  });

  test("QuickPick is newest-first and inspect payload treats missing snapshots as not existed", () => {
    const items = buildOperationHistoryPickItems(
      [
        { description: "old", timestamp: 1 },
        { description: "new", timestamp: 2 },
      ],
      {
        formatTime: (ts) => `t${ts}`,
        detail: (op) => op.description.toUpperCase(),
      },
    );
    assert.deepStrictEqual(
      items.map((item) => item.label),
      ["1. new", "2. old"],
    );
    assert.strictEqual(items[0].description, "t2");
    assert.strictEqual(items[0].detail, "NEW");
    assert.strictEqual(items[0].operation.description, "new");

    const created = operationHistoryInspectPayload({
      id: "op-1",
      description: "builtin_create_new_file: src/a.ts",
      timestamp: 9,
      context: {
        toolName: "builtin_create_new_file",
        args: { filepath: "src/a.ts" },
        filePath: "src/a.ts",
      },
      before: snap(null),
      after: snap(bytes("hi")),
    });
    assert.strictEqual(created.beforeExisted, false);
    assert.strictEqual(created.afterExisted, true);
    assert.strictEqual(created.beforeBytes, 0);
    assert.strictEqual(created.afterBytes, 2);

    const missing = operationHistoryInspectPayload({
      id: "op-2",
      description: "missing",
      timestamp: 1,
      context: { toolName: "builtin_edit_file", args: null },
      before: null,
      after: null,
    });
    assert.strictEqual(missing.beforeExisted, false);
    assert.strictEqual(missing.afterExisted, false);
  });

  test("change details use history.* keys for create / delete / modify", () => {
    const t: (key: string, vars?: Record<string, string>) => string = (
      key,
      vars,
    ) => `${key}:${JSON.stringify(vars ?? {})}`;
    assert.strictEqual(
      formatSnapshotChangeDetail(
        describeSnapshotChange({ before: snap(null), after: snap(bytes("ab")) }),
        t,
      ),
      'history.changeCreated:{"bytes":"2"}',
    );
    assert.strictEqual(
      formatSnapshotChangeDetail(
        describeSnapshotChange({ before: snap(bytes("xyz")), after: snap(null) }),
        t,
      ),
      'history.changeDeleted:{"bytes":"3"}',
    );
    assert.strictEqual(
      formatSnapshotChangeDetail(
        describeSnapshotChange({
          before: snap(bytes("a")),
          after: snap(bytes("abcd")),
        }),
        t,
      ),
      'history.changeModified:{"before":"1","after":"4"}',
    );
    assert.strictEqual(
      formatSnapshotChangeDetail(
        describeSnapshotChange({ before: null, after: null }),
        t,
      ),
      "history.changeNone:{}",
    );
  });
});
