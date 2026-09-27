import * as assert from "node:assert";

import {
  applyCodeBlockStreamEditPrompt,
  closedApplyState,
  decideApplyCodeBlockStream,
  decideApplyToFileGate,
  resolveApplyFilepath,
  runApplyToFile,
  streamingApplyState,
  type ApplyToFileHost,
  type ApplyToFileRequest,
} from "./applyToFile";

import type { DiffLine, ILLM } from "core";

function request(
  partial: Partial<ApplyToFileRequest> = {},
): ApplyToFileRequest {
  return {
    text: "const x = 1;\n",
    streamId: "stream-1",
    curSelectedModelTitle: "gpt",
    filepath: "/tmp/a.ts",
    ...partial,
  };
}

function fakeLlm(title = "gpt"): ILLM {
  return { title } as ILLM;
}

async function* emptyDiff(): AsyncGenerator<DiffLine> {
  // no lines
}

class RecordingHost implements ApplyToFileHost {
  states: ReturnType<typeof streamingApplyState>[] = [];
  errors: string[] = [];
  writes: Array<{ filepath: string; contents: string }> = [];
  opens: string[] = [];
  inserts: string[] = [];
  previews: Array<{ filepath: string; proposed: string; streamId: string }> =
    [];
  applyCalls: Array<{ oldFile: string; newFile: string; filename: string }> =
    [];
  streams: Array<{ kind: string; streamId: string; fileUri?: string }> = [];
  fileExistsResult = true;
  editor: ReturnType<ApplyToFileHost["getActiveEditor"]> = {
    content: "old\n",
    fsPath: "/tmp/a.ts",
    uri: "file:///tmp/a.ts",
    basename: "a.ts",
    selectionEmpty: true,
  };
  shadowEnabled = false;
  allowLarge = false;
  previewDecision: "accept" | "reject" = "accept";
  instantApply = true;
  modelsError: "failedLoadConfig" | "modelNotFound" | undefined;

  fileExists = async () => this.fileExistsResult;
  writeFile = async (filepath: string, contents: string) => {
    this.writes.push({ filepath, contents });
  };
  openFile = async (filepath: string) => {
    this.opens.push(filepath);
  };
  getActiveEditor = () => this.editor;
  showError = (error: string) => {
    this.errors.push(error);
  };
  isShadowPreviewEnabled = () => this.shadowEnabled;
  allowShadowPreviewLargeFiles = () => this.allowLarge;
  previewAndAwaitDecision = async (
    filepath: string,
    proposedContent: string,
    streamId: string,
  ) => {
    this.previews.push({
      filepath,
      proposed: proposedContent,
      streamId,
    });
    return this.previewDecision;
  };
  resolveApplyModels = async () => {
    if (this.modelsError) {
      return { kind: "error" as const, error: this.modelsError, title: "gpt" };
    }
    return { kind: "ok" as const, llm: fakeLlm(), fastLlm: fakeLlm("fast") };
  };
  applyCodeBlock = async (
    oldFile: string,
    newFile: string,
    filename: string,
  ): Promise<[boolean, AsyncGenerator<DiffLine>]> => {
    this.applyCalls.push({ oldFile, newFile, filename });
    return [this.instantApply, emptyDiff()];
  };
  streamDiffLines = async (
    _diffLines: AsyncGenerator<DiffLine>,
    _instant: boolean,
    streamId: string,
    fileUri: string,
  ) => {
    this.streams.push({ kind: "vertical-diff", streamId, fileUri });
  };
  streamEdit = async (args: {
    prompt: string;
    streamId: string;
    useSelection: boolean;
    newCode: string;
    modelTitle: string | undefined;
  }) => {
    this.streams.push({
      kind: args.useSelection ? "stream-edit-selection" : "stream-edit",
      streamId: args.streamId,
    });
  };
  insertAtStart = async (text: string) => {
    this.inserts.push(text);
  };
  notifyApplyState = (state: ReturnType<typeof streamingApplyState>) => {
    this.states.push(state);
  };
}

suite("KN-342 applyToFile pipeline", () => {
  test("streaming and closed payloads keep streamId and filepath", () => {
    const req = request();
    assert.deepStrictEqual(streamingApplyState(req), {
      streamId: "stream-1",
      status: "streaming",
      fileContent: req.text,
      filepath: "/tmp/a.ts",
    });
    assert.deepStrictEqual(
      closedApplyState({
        streamId: "stream-1",
        fileContent: "old",
        filepath: "/tmp/a.ts",
      }),
      {
        streamId: "stream-1",
        status: "closed",
        numDiffs: 0,
        fileContent: "old",
        filepath: "/tmp/a.ts",
      },
    );
    assert.strictEqual(resolveApplyFilepath(undefined, "/tmp/b.ts"), "/tmp/b.ts");
    assert.strictEqual(resolveApplyFilepath("/tmp/a.ts", "/tmp/b.ts"), "/tmp/a.ts");
  });

  test("gate: empty insert, shadow preview, or applyCodeBlock", () => {
    assert.strictEqual(
      decideApplyToFileGate({
        hasEditor: false,
        currentContent: "a",
        filepath: "/tmp/a.ts",
        proposedContent: "b",
        shadowPreviewEnabled: true,
        allowLargeFiles: false,
      }).kind,
      "no-editor",
    );
    assert.deepStrictEqual(
      decideApplyToFileGate({
        hasEditor: true,
        currentContent: "  \n",
        filepath: "/tmp/a.ts",
        proposedContent: "b",
        shadowPreviewEnabled: true,
        allowLargeFiles: false,
      }),
      { kind: "empty-insert", filepath: "/tmp/a.ts" },
    );
    assert.deepStrictEqual(
      decideApplyToFileGate({
        hasEditor: true,
        currentContent: "old",
        filepath: "/tmp/a.ts",
        proposedContent: "new",
        shadowPreviewEnabled: true,
        allowLargeFiles: false,
      }),
      { kind: "shadow-preview", filepath: "/tmp/a.ts" },
    );
    assert.strictEqual(
      decideApplyToFileGate({
        hasEditor: true,
        currentContent: "old",
        filepath: "/tmp/a.ts",
        proposedContent: "new",
        shadowPreviewEnabled: false,
        allowLargeFiles: false,
      }).kind,
      "apply-code-block",
    );
    const huge = Array.from({ length: 4001 }, (_, i) => `line ${i}`).join("\n");
    assert.strictEqual(
      decideApplyToFileGate({
        hasEditor: true,
        currentContent: huge,
        filepath: "/tmp/a.ts",
        proposedContent: `${huge}\n// patched`,
        shadowPreviewEnabled: true,
        allowLargeFiles: false,
      }).kind,
      "apply-code-block",
    );
    assert.strictEqual(
      decideApplyToFileGate({
        hasEditor: true,
        currentContent: huge,
        filepath: "/tmp/a.ts",
        proposedContent: `${huge}\n// patched`,
        shadowPreviewEnabled: true,
        allowLargeFiles: true,
      }).kind,
      "shadow-preview",
    );
  });

  test("instant applyCodeBlock streams vertical diffs; otherwise streamEdit", () => {
    assert.strictEqual(decideApplyCodeBlockStream(true), "vertical-diff");
    assert.strictEqual(decideApplyCodeBlockStream(false), "stream-edit");
    assert.ok(
      applyCodeBlockStreamEditPrompt("x").includes("```\nx\n```"),
    );
  });

  test("runApplyToFile creates missing files then empty-inserts", async () => {
    const host = new RecordingHost();
    host.fileExistsResult = false;
    host.editor = {
      content: "",
      fsPath: "/tmp/a.ts",
      uri: "file:///tmp/a.ts",
      basename: "a.ts",
      selectionEmpty: true,
    };
    const req = request();
    await runApplyToFile(host, req);
    assert.deepStrictEqual(host.writes, [{ filepath: "/tmp/a.ts", contents: "" }]);
    assert.ok(host.opens.includes("/tmp/a.ts"));
    assert.deepStrictEqual(host.inserts, [req.text]);
    assert.strictEqual(host.applyCalls.length, 0);
    assert.strictEqual(host.states[0].status, "streaming");
    assert.strictEqual(host.states[1].status, "closed");
    assert.strictEqual(host.states[1].filepath, "/tmp/a.ts");
    assert.strictEqual(host.states[1].numDiffs, 0);
  });

  test("shadow reject closes apply state and skips applyCodeBlock", async () => {
    const host = new RecordingHost();
    host.shadowEnabled = true;
    host.previewDecision = "reject";
    await runApplyToFile(host, request());
    assert.strictEqual(host.previews.length, 1);
    assert.strictEqual(host.applyCalls.length, 0);
    assert.strictEqual(host.streams.length, 0);
    const last = host.states[host.states.length - 1];
    assert.strictEqual(last.status, "closed");
    assert.strictEqual(last.fileContent, "old\n");
  });

  test("shadow accept continues to applyCodeBlock then vertical diffs", async () => {
    const host = new RecordingHost();
    host.shadowEnabled = true;
    host.previewDecision = "accept";
    await runApplyToFile(host, request());
    assert.strictEqual(host.previews.length, 1);
    assert.strictEqual(host.applyCalls.length, 1);
    assert.deepStrictEqual(host.streams, [
      {
        kind: "vertical-diff",
        streamId: "stream-1",
        fileUri: "file:///tmp/a.ts",
      },
    ]);
  });

  test("lazy applyCodeBlock uses streamEdit", async () => {
    const host = new RecordingHost();
    host.instantApply = false;
    await runApplyToFile(host, request());
    assert.strictEqual(host.previews.length, 0);
    assert.deepStrictEqual(host.streams, [
      { kind: "stream-edit", streamId: "stream-1" },
    ]);
  });

  test("missing editor aborts with closed apply state", async () => {
    const host = new RecordingHost();
    host.editor = undefined;
    await runApplyToFile(host, request({ filepath: undefined }));
    assert.deepStrictEqual(host.errors, ["noActiveEditor"]);
    assert.strictEqual(host.applyCalls.length, 0);
    assert.strictEqual(host.states[0].status, "streaming");
    assert.strictEqual(host.states[1].status, "closed");
  });
});
