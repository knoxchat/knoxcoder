import * as assert from "node:assert";

import {
  applyBatch,
  batchActionForKind,
  BATCH_DIFF_COMMANDS,
  BATCH_DIFF_NAVIGATE_COMMAND,
  BATCH_DIFF_PROTOCOL,
  BATCH_DIFF_ROUTE,
  collectPendingFiles,
  emptyBatchDiffResult,
  fileUrisForBatch,
  pendingFilesPayload,
  protocolTypeForKind,
  type BatchDiffHost,
} from "./batchDiff";

class RecordingHost implements BatchDiffHost {
  cleared: Array<{ fileUri: string; accept: boolean }> = [];
  saved: string[] = [];
  throwOn?: string;

  clearForFile(fileUri: string, accept: boolean): void {
    if (this.throwOn === fileUri) {
      throw new Error(`fail ${fileUri}`);
    }
    this.cleared.push({ fileUri, accept });
  }

  saveIfDirty = async (fileUri: string) => {
    this.saved.push(fileUri);
  };
}

suite("KN-344 batch multi-file diffs", () => {
  test("commands, protocol, and native route keep the same ids", () => {
    assert.strictEqual(BATCH_DIFF_ROUTE, "/batch-diff");
    assert.strictEqual(BATCH_DIFF_NAVIGATE_COMMAND, "knoxchat.navigateTo");
    assert.strictEqual(BATCH_DIFF_COMMANDS.show, "knox.batch.show");
    assert.strictEqual(BATCH_DIFF_COMMANDS.acceptAll, "knox.batch.acceptAll");
    assert.strictEqual(BATCH_DIFF_COMMANDS.rejectAll, "knox.batch.rejectAll");
    assert.strictEqual(
      BATCH_DIFF_COMMANDS.acceptSelected,
      "knox.batch.acceptSelected",
    );
    assert.strictEqual(
      BATCH_DIFF_COMMANDS.rejectSelected,
      "knox.batch.rejectSelected",
    );
    assert.strictEqual(
      BATCH_DIFF_PROTOCOL.getPendingFiles,
      "batch/getPendingFiles",
    );
    assert.strictEqual(BATCH_DIFF_PROTOCOL.acceptAll, "batch/acceptAll");
    assert.strictEqual(BATCH_DIFF_PROTOCOL.rejectAll, "batch/rejectAll");
    assert.strictEqual(
      BATCH_DIFF_PROTOCOL.acceptSelected,
      "batch/acceptSelected",
    );
    assert.strictEqual(
      BATCH_DIFF_PROTOCOL.rejectSelected,
      "batch/rejectSelected",
    );
  });

  test("collectPendingFiles skips empty CodeLens maps", () => {
    const pending = collectPendingFiles([
      ["file:///a.ts", { length: 2 }],
      ["file:///b.ts", { length: 0 }],
      ["file:///c.ts", { length: 1 }],
    ]);
    assert.deepStrictEqual(
      pending.map((entry) => ({
        filepath: entry.filepath,
        numDiffs: entry.numDiffs,
        selected: entry.selected,
      })),
      [
        { filepath: "file:///a.ts", numDiffs: 2, selected: true },
        { filepath: "file:///c.ts", numDiffs: 1, selected: true },
      ],
    );
    assert.deepStrictEqual(pendingFilesPayload(pending).files, [
      { filepath: "file:///a.ts", numDiffs: 2, selected: true },
      { filepath: "file:///c.ts", numDiffs: 1, selected: true },
    ]);
  });

  test("kind maps to action and file URI lists", () => {
    const pending = collectPendingFiles([
      ["file:///a.ts", { length: 1 }],
      ["file:///b.ts", { length: 3 }],
    ]);
    assert.strictEqual(batchActionForKind("acceptAll"), "accept");
    assert.strictEqual(batchActionForKind("rejectSelected"), "reject");
    assert.deepStrictEqual(fileUrisForBatch("acceptAll", pending), [
      "file:///a.ts",
      "file:///b.ts",
    ]);
    assert.deepStrictEqual(
      fileUrisForBatch("rejectSelected", pending, ["file:///b.ts"]),
      ["file:///b.ts"],
    );
    assert.deepStrictEqual(
      fileUrisForBatch("acceptSelected", pending, undefined),
      [],
    );
    assert.strictEqual(
      protocolTypeForKind("acceptAll"),
      "batch/acceptAll",
    );
  });

  test("applyBatch accepts then saves; rejects skip save; failures continue", async () => {
    const host = new RecordingHost();
    const accepted = await applyBatch(host, "accept", [
      "file:///a.ts",
      "file:///b.ts",
    ]);
    assert.deepStrictEqual(accepted, {
      totalFiles: 2,
      successFiles: 2,
      failedFiles: [],
    });
    assert.deepStrictEqual(host.cleared, [
      { fileUri: "file:///a.ts", accept: true },
      { fileUri: "file:///b.ts", accept: true },
    ]);
    assert.deepStrictEqual(host.saved, ["file:///a.ts", "file:///b.ts"]);

    const rejectHost = new RecordingHost();
    rejectHost.throwOn = "file:///fail.ts";
    const rejected = await applyBatch(rejectHost, "reject", [
      "file:///ok.ts",
      "file:///fail.ts",
      "file:///later.ts",
    ]);
    assert.deepStrictEqual(rejected, {
      totalFiles: 3,
      successFiles: 2,
      failedFiles: ["file:///fail.ts"],
    });
    assert.deepStrictEqual(rejectHost.saved, []);
    assert.deepStrictEqual(
      rejectHost.cleared.map((item) => item.fileUri),
      ["file:///ok.ts", "file:///later.ts"],
    );
    assert.deepStrictEqual(emptyBatchDiffResult(), {
      totalFiles: 0,
      successFiles: 0,
      failedFiles: [],
    });
  });
});
