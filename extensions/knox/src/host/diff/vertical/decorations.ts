import * as vscode from "vscode";

import {
  addLineSpans,
  buildWorkbenchAgentDiffPayload,
  deleteLineSpanStartingAt,
  LineSpan,
  shiftLineSpansAfter,
  workbenchDiffPayloadIsEmpty,
  type WorkbenchAgentDiffPayload,
} from "./lineRanges";

export const redDecorationType = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: { id: "diffEditor.removedLineBackground" },
  color: "#808080",
  outlineWidth: "1px",
  outlineStyle: "solid",
  outlineColor: { id: "diffEditor.removedTextBorder" },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

export const greenDecorationType = vscode.window.createTextEditorDecorationType(
  {
    isWholeLine: true,
    backgroundColor: { id: "diffEditor.insertedLineBackground" },
    outlineWidth: "1px",
    outlineStyle: "solid",
    outlineColor: { id: "diffEditor.insertedTextBorder" },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  },
);

export const indexDecorationType = vscode.window.createTextEditorDecorationType(
  {
    isWholeLine: true,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  },
);
export const belowIndexDecorationType =
  vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });

export const WORKBENCH_DIFF_COMMAND = "workbench.knox.setAgentDiffDecorations";

type WorkbenchKind = "red" | "green" | "index" | "belowIndex";

interface WorkbenchDiffState {
  red: LineSpan[];
  green: LineSpan[];
  index: LineSpan[];
  belowIndex: LineSpan[];
}

let workbenchDiffCommandAvailable: boolean | undefined;
const workbenchDiffByUri = new Map<string, WorkbenchDiffState>();
let workbenchFlushScheduled = false;

function emptyWorkbenchState(): WorkbenchDiffState {
  return { red: [], green: [], index: [], belowIndex: [] };
}

function rangeFromSpan(span: LineSpan): vscode.Range {
  return new vscode.Range(
    span.startLine,
    0,
    span.endLine,
    Number.MAX_SAFE_INTEGER,
  );
}

function spanFromRange(range: vscode.Range): LineSpan {
  return { startLine: range.start.line, endLine: range.end.line };
}

function getWorkbenchState(uri: string): WorkbenchDiffState {
  const current = workbenchDiffByUri.get(uri);
  if (current) {
    return current;
  }
  const created = emptyWorkbenchState();
  workbenchDiffByUri.set(uri, created);
  return created;
}

export function toWorkbenchAgentDiffPayload(
  uri: string,
): WorkbenchAgentDiffPayload {
  const state = workbenchDiffByUri.get(uri) ?? emptyWorkbenchState();
  return buildWorkbenchAgentDiffPayload(uri, state);
}

function scheduleWorkbenchDiffFlush(): void {
  if (workbenchFlushScheduled) {
    return;
  }
  workbenchFlushScheduled = true;
  queueMicrotask(() => {
    workbenchFlushScheduled = false;
    void flushWorkbenchAgentDiffs();
  });
}

async function flushWorkbenchAgentDiffs(): Promise<void> {
  if (workbenchDiffCommandAvailable === false) {
    return;
  }
  for (const uri of workbenchDiffByUri.keys()) {
    const payload = toWorkbenchAgentDiffPayload(uri);
    try {
      await vscode.commands.executeCommand(WORKBENCH_DIFF_COMMAND, payload);
      workbenchDiffCommandAvailable = true;
    } catch {
      workbenchDiffCommandAvailable = false;
      return;
    }
    if (workbenchDiffPayloadIsEmpty(payload)) {
      workbenchDiffByUri.delete(uri);
    }
  }
}

export function clearWorkbenchAgentDiff(uri: string): void {
  workbenchDiffByUri.set(uri, emptyWorkbenchState());
  scheduleWorkbenchDiffFlush();
}

export function setWorkbenchStreamIndex(
  uri: string,
  index: vscode.Range | undefined,
  belowIndex: vscode.Range | undefined,
): void {
  const current = getWorkbenchState(uri);
  current.index = index ? [spanFromRange(index)] : [];
  current.belowIndex = belowIndex ? [spanFromRange(belowIndex)] : [];
  workbenchDiffByUri.set(uri, current);
  scheduleWorkbenchDiffFlush();
}

export function applyIndexDecorations(
  editor: vscode.TextEditor,
  index: vscode.Range | undefined,
  belowIndex: vscode.Range | undefined,
): void {
  setWorkbenchStreamIndex(
    editor.document.uri.toString(),
    index,
    belowIndex,
  );
  const useEditorFallback = workbenchDiffCommandAvailable !== true;
  editor.setDecorations(
    indexDecorationType,
    useEditorFallback && index ? [index] : [],
  );
  editor.setDecorations(
    belowIndexDecorationType,
    useEditorFallback && belowIndex ? [belowIndex] : [],
  );
}

export class DecorationTypeRangeManager {
  constructor(
    private decorationType: vscode.TextEditorDecorationType,
    private editor: vscode.TextEditor,
    private readonly workbenchKind?: WorkbenchKind,
  ) {}

  private ranges: LineSpan[] = [];

  applyToNewEditor(newEditor: vscode.TextEditor) {
    this.editor = newEditor;
    this.apply();
  }

  addLines(startIndex: number, numLines: number) {
    this.ranges = addLineSpans(this.ranges, startIndex, numLines);
    this.apply();
  }

  addLine(index: number) {
    this.addLines(index, 1);
  }

  clear() {
    this.ranges = [];
    this.apply();
  }

  private apply() {
    if (this.workbenchKind) {
      const uri = this.editor.document.uri.toString();
      const current = getWorkbenchState(uri);
      current[this.workbenchKind] = this.ranges;
      workbenchDiffByUri.set(uri, current);
      scheduleWorkbenchDiffFlush();
      this.editor.setDecorations(
        this.decorationType,
        workbenchDiffCommandAvailable === true
          ? []
          : this.ranges.map(rangeFromSpan),
      );
      return;
    }
    this.editor.setDecorations(
      this.decorationType,
      this.ranges.map(rangeFromSpan),
    );
  }

  getRanges() {
    return this.ranges.map(rangeFromSpan);
  }

  shiftDownAfterLine(afterLine: number, offset: number) {
    this.ranges = shiftLineSpansAfter(this.ranges, afterLine, offset);
    this.apply();
  }

  deleteRangeStartingAt(line: number) {
    const { removed, ranges } = deleteLineSpanStartingAt(this.ranges, line);
    this.ranges = ranges;
    if (removed) {
      this.apply();
      return rangeFromSpan(removed);
    }
    return undefined;
  }
}
