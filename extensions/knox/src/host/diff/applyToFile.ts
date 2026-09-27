/**
 * KN-342: vscode-free applyToFile pipeline.
 *
 * Chat Apply: optional shadow preview → applyCodeBlock → vertical diffs →
 * updateApplyState. The messenger supplies an ApplyToFileHost; this module
 * owns the step order so the path is testable without vscode types.
 */

import { shouldPreviewApply } from "../agent/shadowWorkspace";

import type { DiffLine, ILLM } from "core";

export type ApplyStateStatus = "streaming" | "done" | "closed";

export interface ApplyToFileRequest {
  text: string;
  streamId: string;
  curSelectedModelTitle: string;
  filepath?: string;
}

export interface ApplyStatePayload {
  streamId: string;
  status: ApplyStateStatus;
  numDiffs?: number;
  filepath?: string;
  fileContent?: string;
}

export interface ApplyEditorSnapshot {
  content: string;
  fsPath: string;
  uri: string;
  basename: string;
  selectionEmpty: boolean;
}

export type ApplyToFileError =
  | "noActiveEditor"
  | "failedLoadConfig"
  | "modelNotFound";

export type ApplyModels =
  | { kind: "ok"; llm: ILLM; fastLlm: ILLM }
  | { kind: "error"; error: Exclude<ApplyToFileError, "noActiveEditor">; title?: string };

export type ApplyStreamKind = "vertical-diff" | "stream-edit";

export type ApplyToFileGate =
  | { kind: "no-editor" }
  | { kind: "empty-insert"; filepath?: string }
  | { kind: "shadow-preview"; filepath: string }
  | { kind: "apply-code-block" };

export interface ApplyToFileHost {
  fileExists(filepath: string): Promise<boolean>;
  writeFile(filepath: string, contents: string): Promise<void>;
  openFile(filepath: string): Promise<void>;
  getActiveEditor(): ApplyEditorSnapshot | undefined;
  showError(error: ApplyToFileError, args?: { title?: string }): void;
  isShadowPreviewEnabled(): boolean;
  allowShadowPreviewLargeFiles(): boolean;
  previewAndAwaitDecision(
    filepath: string,
    proposedContent: string,
    streamId: string,
  ): Promise<"accept" | "reject">;
  resolveApplyModels(curSelectedModelTitle: string): Promise<ApplyModels>;
  applyCodeBlock(
    oldFile: string,
    newFile: string,
    filename: string,
    llm: ILLM,
    fastLlm: ILLM,
  ): Promise<[boolean, AsyncGenerator<DiffLine>]>;
  streamDiffLines(
    diffLines: AsyncGenerator<DiffLine>,
    instant: boolean,
    streamId: string,
    fileUri: string,
  ): Promise<void>;
  streamEdit(args: {
    prompt: string;
    modelTitle: string | undefined;
    streamId: string;
    useSelection: boolean;
    newCode: string;
  }): Promise<void>;
  insertAtStart(text: string): Promise<void>;
  notifyApplyState(state: ApplyStatePayload): void;
}

export function streamingApplyState(
  request: ApplyToFileRequest,
): ApplyStatePayload {
  return {
    streamId: request.streamId,
    status: "streaming",
    fileContent: request.text,
    filepath: request.filepath,
  };
}

export function closedApplyState(args: {
  streamId: string;
  fileContent?: string;
  filepath?: string;
  numDiffs?: number;
}): ApplyStatePayload {
  return {
    streamId: args.streamId,
    status: "closed",
    numDiffs: args.numDiffs ?? 0,
    fileContent: args.fileContent,
    filepath: args.filepath,
  };
}

export function resolveApplyFilepath(
  requested: string | undefined,
  editorFsPath: string | undefined,
): string | undefined {
  return requested || editorFsPath;
}

export function decideApplyToFileGate(args: {
  hasEditor: boolean;
  currentContent: string;
  filepath?: string;
  proposedContent: string;
  shadowPreviewEnabled: boolean;
  allowLargeFiles: boolean;
}): ApplyToFileGate {
  if (!args.hasEditor) {
    return { kind: "no-editor" };
  }
  if (!args.currentContent.trim()) {
    return { kind: "empty-insert", filepath: args.filepath };
  }
  if (
    args.filepath &&
    shouldPreviewApply({
      enabled: args.shadowPreviewEnabled,
      fileExists: true,
      currentContent: args.currentContent,
      proposedContent: args.proposedContent,
      allowLargeFiles: args.allowLargeFiles,
    })
  ) {
    return { kind: "shadow-preview", filepath: args.filepath };
  }
  return { kind: "apply-code-block" };
}

export function decideApplyCodeBlockStream(instant: boolean): ApplyStreamKind {
  return instant ? "vertical-diff" : "stream-edit";
}

export function applyCodeBlockStreamEditPrompt(suggestedCode: string): string {
  return `The following code was suggested as an edit:\n\`\`\`\n${suggestedCode}\n\`\`\`\nPlease apply it to the previous code.`;
}

function abortApply(
  host: ApplyToFileHost,
  request: ApplyToFileRequest,
  error: ApplyToFileError,
  extra?: { filepath?: string; fileContent?: string; title?: string },
): void {
  host.showError(error, extra?.title ? { title: extra.title } : undefined);
  host.notifyApplyState(
    closedApplyState({
      streamId: request.streamId,
      filepath: extra?.filepath ?? request.filepath,
      fileContent: extra?.fileContent ?? request.text,
      numDiffs: 0,
    }),
  );
}

/**
 * Execute chat Apply: notify streaming → optional shadow → applyCodeBlock →
 * VerticalDiffManager (streamDiffLines or streamEdit). Vertical diffs emit
 * later updateApplyState via onStatusUpdate.
 */
export async function runApplyToFile(
  host: ApplyToFileHost,
  request: ApplyToFileRequest,
): Promise<void> {
  host.notifyApplyState(streamingApplyState(request));

  if (request.filepath) {
    const fileExists = await host.fileExists(request.filepath);
    if (!fileExists) {
      await host.writeFile(request.filepath, "");
      await host.openFile(request.filepath);
    }
    await host.openFile(request.filepath);
  }

  const editor = host.getActiveEditor();
  if (!editor) {
    abortApply(host, request, "noActiveEditor");
    return;
  }

  const filepath = resolveApplyFilepath(request.filepath, editor.fsPath);
  const gate = decideApplyToFileGate({
    hasEditor: true,
    currentContent: editor.content,
    filepath,
    proposedContent: request.text,
    shadowPreviewEnabled: host.isShadowPreviewEnabled(),
    allowLargeFiles: host.allowShadowPreviewLargeFiles(),
  });

  if (gate.kind === "empty-insert") {
    await host.insertAtStart(request.text);
    host.notifyApplyState(
      closedApplyState({
        streamId: request.streamId,
        fileContent: request.text,
        filepath,
        numDiffs: 0,
      }),
    );
    return;
  }

  if (gate.kind === "shadow-preview") {
    const decision = await host.previewAndAwaitDecision(
      gate.filepath,
      request.text,
      request.streamId,
    );
    if (decision === "reject") {
      host.notifyApplyState(
        closedApplyState({
          streamId: request.streamId,
          fileContent: editor.content,
          filepath: gate.filepath,
          numDiffs: 0,
        }),
      );
      return;
    }
    await host.openFile(gate.filepath);
  }

  const editorAfterPreview = host.getActiveEditor();
  if (!editorAfterPreview) {
    abortApply(host, request, "noActiveEditor", { filepath });
    return;
  }

  const models = await host.resolveApplyModels(request.curSelectedModelTitle);
  if (models.kind === "error") {
    abortApply(host, request, models.error, {
      filepath,
      title: models.title ?? request.curSelectedModelTitle,
    });
    return;
  }

  const [instant, diffLines] = await host.applyCodeBlock(
    editorAfterPreview.content,
    request.text,
    editorAfterPreview.basename,
    models.llm,
    models.fastLlm,
  );

  if (decideApplyCodeBlockStream(instant) === "vertical-diff") {
    await host.streamDiffLines(
      diffLines,
      instant,
      request.streamId,
      editorAfterPreview.uri,
    );
    return;
  }

  await host.streamEdit({
    prompt: applyCodeBlockStreamEditPrompt(request.text),
    modelTitle: models.llm.title,
    streamId: request.streamId,
    useSelection: !editorAfterPreview.selectionEmpty,
    newCode: request.text,
  });
}
