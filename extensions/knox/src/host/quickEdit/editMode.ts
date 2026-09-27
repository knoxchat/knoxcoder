/**
 * KN-346: vscode-free Cmd/Ctrl+I edit-mode engine.
 *
 * Host commands post `focusEdit` / `focusEditWithoutClear` / `addCodeToEdit`
 * into the native composer. A single-range prompt goes out as
 * `edit/sendPrompt`; Esc posts `exitEditMode`. QuickEdit QuickPick stays as
 * a leftover — the product path is the native composer.
 */

export const FOCUS_EDIT_COMMAND = "knoxchat.focusEdit";
export const FOCUS_EDIT_WITHOUT_CLEAR_COMMAND = "knoxchat.focusEditWithoutClear";
export const EXIT_EDIT_MODE_COMMAND = "knoxchat.exitEditMode";
export const IN_EDIT_MODE_CONTEXT = "knoxchat.inEditMode";

export const FOCUS_EDIT_MESSAGE = "focusEdit";
export const FOCUS_EDIT_WITHOUT_CLEAR_MESSAGE = "focusEditWithoutClear";
export const ADD_CODE_TO_EDIT_MESSAGE = "addCodeToEdit";
export const EXIT_EDIT_MODE_MESSAGE = "exitEditMode";
export const EDIT_SEND_PROMPT_MESSAGE = "edit/sendPrompt";
export const EDIT_EXIT_MESSAGE = "edit/exit";
export const SET_EDIT_STATUS_MESSAGE = "setEditStatus";

export interface EditLinePosition {
  line: number;
  character: number;
}

export interface EditRange {
  start: EditLinePosition;
  end: EditLinePosition;
}

export interface EditSelection {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface CodeToEditPayload {
  filepath: string;
  contents: string;
  range?: EditRange;
}

/**
 * Cmd+I always covers whole lines. A trailing line with character 0 is
 * excluded unless the caret is on that same start line (empty selection).
 */
export function lastIncludedLineForEditSelection(sel: EditSelection): number {
  if (sel.endCharacter === 0) {
    if (sel.endLine === sel.startLine) {
      return sel.startLine;
    }
    return sel.endLine - 1;
  }
  return sel.endLine;
}

export function buildWholeLineEditRange(
  sel: EditSelection,
  lastLineEndCharacter: number,
): EditRange {
  return {
    start: { line: sel.startLine, character: 0 },
    end: {
      line: lastIncludedLineForEditSelection(sel),
      character: lastLineEndCharacter,
    },
  };
}

/** Expand the contents start to column 0 when the line prefix is only whitespace. */
export function leadingWhitespaceExpandsSelection(
  textBeforeSelectionStart: string,
): boolean {
  return textBeforeSelectionStart.trim().length === 0;
}

export function shouldSkipAddCodeToEdit(hasVerticalDiff: boolean): boolean {
  return hasVerticalDiff === true;
}

export function buildCodeToEditPayload(args: {
  filepath: string;
  contents: string;
  range?: EditRange;
}): CodeToEditPayload {
  if (args.range) {
    return {
      filepath: args.filepath,
      contents: args.contents,
      range: args.range,
    };
  }
  return { filepath: args.filepath, contents: args.contents };
}

export function buildWholeFileCodeToEdit(
  filepath: string,
  contents: string,
): CodeToEditPayload {
  return { filepath, contents };
}
