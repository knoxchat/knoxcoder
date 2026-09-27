/**
 * KN-340: pure line-span math for vertical diffs. Shared by the host
 * decoration manager and workbench payload builder so split editors stay in
 * sync through IKnoxDiffDecorationService without depending on vscode types.
 */

export interface LineSpan {
  startLine: number;
  endLine: number;
}

export interface WorkbenchDiffLines {
  startLineNumber: number;
  endLineNumber: number;
}

export interface WorkbenchAgentDiffPayload {
  uri: string;
  red: WorkbenchDiffLines[];
  green: WorkbenchDiffLines[];
  index: WorkbenchDiffLines[];
  belowIndex: WorkbenchDiffLines[];
}

export function addLineSpans(
  ranges: readonly LineSpan[],
  startIndex: number,
  numLines: number,
): LineSpan[] {
  if (numLines <= 0) {
    return ranges.slice();
  }
  const next = ranges.slice();
  const last = next[next.length - 1];
  if (last && last.endLine === startIndex - 1) {
    next[next.length - 1] = {
      startLine: last.startLine,
      endLine: last.endLine + numLines,
    };
  } else {
    next.push({
      startLine: startIndex,
      endLine: startIndex + numLines - 1,
    });
  }
  return next;
}

export function shiftLineSpansAfter(
  ranges: readonly LineSpan[],
  afterLine: number,
  offset: number,
): LineSpan[] {
  if (offset === 0) {
    return ranges.slice();
  }
  return ranges.map((range) => {
    if (range.startLine < afterLine) {
      return range;
    }
    return {
      startLine: range.startLine + offset,
      endLine: range.endLine + offset,
    };
  });
}

export function deleteLineSpanStartingAt(
  ranges: readonly LineSpan[],
  line: number,
): { removed: LineSpan | undefined; ranges: LineSpan[] } {
  const index = ranges.findIndex((range) => range.startLine === line);
  if (index === -1) {
    return { removed: undefined, ranges: ranges.slice() };
  }
  const next = ranges.slice();
  const [removed] = next.splice(index, 1);
  return { removed, ranges: next };
}

export function lineSpansToWorkbench(
  ranges: readonly LineSpan[],
): WorkbenchDiffLines[] {
  return ranges.map((range) => ({
    startLineNumber: range.startLine,
    endLineNumber: range.endLine,
  }));
}

export function workbenchDiffPayloadIsEmpty(
  payload: Pick<
    WorkbenchAgentDiffPayload,
    "red" | "green" | "index" | "belowIndex"
  >,
): boolean {
  return (
    payload.red.length === 0 &&
    payload.green.length === 0 &&
    payload.index.length === 0 &&
    payload.belowIndex.length === 0
  );
}

export function buildWorkbenchAgentDiffPayload(
  uri: string,
  ranges: {
    red?: readonly LineSpan[];
    green?: readonly LineSpan[];
    index?: readonly LineSpan[];
    belowIndex?: readonly LineSpan[];
  },
): WorkbenchAgentDiffPayload {
  return {
    uri,
    red: lineSpansToWorkbench(ranges.red ?? []),
    green: lineSpansToWorkbench(ranges.green ?? []),
    index: lineSpansToWorkbench(ranges.index ?? []),
    belowIndex: lineSpansToWorkbench(ranges.belowIndex ?? []),
  };
}
