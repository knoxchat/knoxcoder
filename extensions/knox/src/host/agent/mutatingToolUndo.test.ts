import * as assert from "node:assert";
import * as vscode from "vscode";

import {
  captureMutatingToolBefore,
  clearPendingMutatingToolBefores,
  pendingMutatingToolBeforeCount,
  recordMutatingToolAfter,
} from "./mutatingToolUndo";

suite("mutatingToolUndo", () => {
  teardown(() => {
    clearPendingMutatingToolBefores();
  });

  test("non-mutating tools return null before id", async () => {
    const beforeId = await captureMutatingToolBefore({
      toolName: "builtin_read_file",
      toolArguments: { filepath: "src/a.ts" },
    });
    assert.strictEqual(beforeId, null);
    assert.strictEqual(pendingMutatingToolBeforeCount(), 0);
  });

  test("mutating tool without path returns null", async () => {
    const beforeId = await captureMutatingToolBefore({
      toolName: "composite_smart_edit",
      toolArguments: { contents: "x" },
    });
    assert.strictEqual(beforeId, null);
    assert.strictEqual(pendingMutatingToolBeforeCount(), 0);
  });

  test("commit:false discards pending before without leaking", async () => {
    const beforeId = await captureMutatingToolBefore({
      toolName: "composite_smart_edit",
      toolArguments: { filepath: "src/does-not-need-to-exist.ts" },
    });
    assert.ok(typeof beforeId === "string" && beforeId.length > 0);
    assert.strictEqual(pendingMutatingToolBeforeCount(), 1);

    await recordMutatingToolAfter({
      toolName: "composite_smart_edit",
      toolArguments: { filepath: "src/does-not-need-to-exist.ts" },
      beforeId,
      commit: false,
    });
    assert.strictEqual(pendingMutatingToolBeforeCount(), 0);
  });

  test("commit:true releases pending before id", async () => {
    const filePath = "src/mutating-undo-test.ts";
    const beforeId = await captureMutatingToolBefore({
      toolName: "builtin_create_new_file",
      toolArguments: { filepath: filePath, contents: "hello" },
    });
    assert.ok(beforeId);
    assert.strictEqual(pendingMutatingToolBeforeCount(), 1);

    await recordMutatingToolAfter({
      toolName: "builtin_create_new_file",
      toolArguments: { filepath: filePath, contents: "hello" },
      beforeId,
      commit: true,
    });
    assert.strictEqual(pendingMutatingToolBeforeCount(), 0);

    // Best-effort cleanup if the test created a workspace file.
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (folders?.[0]) {
        const uri = vscode.Uri.joinPath(folders[0].uri, filePath);
        await vscode.workspace.fs.delete(uri, { useTrash: false });
      }
    } catch {
      // File may not exist — fine.
    }
  });
});
