/**
 * KN-345: vscode-free inline tip engine.
 *
 * Selection decorations show Chat (⌘/Ctrl+L) and Edit (⌘/Ctrl+I) when
 * `knoxchat.showInlineTip` is on. Empty files get a Cmd/Ctrl+I hint.
 * Hover "Hide hint" writes the setting false via `knoxchat.hideInlineTip`.
 */

/** VS Code setting that gates selection + empty-file tips. */
export const SHOW_INLINE_TIP_SETTING = "knoxchat.showInlineTip";
export const HIDE_INLINE_TIP_COMMAND = "knoxchat.hideInlineTip";

export const INLINE_TIP_DEBOUNCE_MS = 500;
export const INLINE_TIP_LINE_OFFSET = 4;
export const INLINE_TIP_EXCLUDED_URI_PREFIXES = [
  "output:",
  "vscode://inline-chat",
] as const;
export const INLINE_TIP_EXCLUDED_SCHEME = "comment";

export const INLINE_TIP_CHAT_KEY = "L";
export const INLINE_TIP_EDIT_KEY = "I";

export interface InlineTipLineDoc {
  lineCount: number;
  lineText(line: number): string;
}

export interface InlineTipSelection {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface InlineTipPosition {
  line: number;
  character: number;
}

export function shouldRenderInlineTip(args: {
  uri: string;
  scheme: string;
  enabled: boolean;
}): boolean {
  const isAllowedUri =
    !INLINE_TIP_EXCLUDED_URI_PREFIXES.some((prefix) =>
      args.uri.startsWith(prefix),
    ) && args.scheme !== INLINE_TIP_EXCLUDED_SCHEME;
  return isAllowedUri && args.enabled === true;
}

export function inlineTipShortcut(metaKeyLabel: string, key: string): string {
  return `${metaKeyLabel} + ${key}`;
}

export function emptyFileTipText(metaKeyName: string): string {
  return `Use ${metaKeyName} + I to generate code`;
}

export function hideInlineTipHoverMarkdown(
  command: string = HIDE_INLINE_TIP_COMMAND,
): string {
  return `[Hide hint](command:${command})`;
}

/**
 * Placement rules (product):
 * 1. Single-line selection: after that line's trimmed content.
 * 2. Multi-line selection: after the longer of the first non-empty selected
 *    line and the line above the selection.
 * Returns null if the selection is empty of content.
 */
export function calculateInlineTipPosition(
  document: InlineTipLineDoc,
  selection: InlineTipSelection,
): InlineTipPosition | null {
  const startLine = selection.startLine;
  const endLine = selection.endLine;
  const isFullLineSelection =
    selection.startCharacter === 0 &&
    (selection.endLine > selection.startLine
      ? selection.endCharacter === 0
      : selection.endCharacter === document.lineText(selection.endLine).length);

  const isLineEmpty = (lineNumber: number): boolean => {
    return document.lineText(lineNumber).trim().length === 0;
  };

  const getLineEndChar = (lineNumber: number): number => {
    return document.lineText(lineNumber).trimEnd().length;
  };

  if (startLine === endLine && isLineEmpty(startLine) && !isFullLineSelection) {
    return null;
  }

  let topNonEmptyLine = startLine;
  while (topNonEmptyLine <= endLine && isLineEmpty(topNonEmptyLine)) {
    topNonEmptyLine++;
  }

  if (topNonEmptyLine > endLine) {
    return null;
  }

  if (isFullLineSelection || startLine === endLine) {
    return {
      line: topNonEmptyLine,
      character: getLineEndChar(topNonEmptyLine) + INLINE_TIP_LINE_OFFSET,
    };
  }

  const lineAboveSelection = Math.max(0, startLine - 1);
  const baseEndChar = Math.max(
    getLineEndChar(topNonEmptyLine),
    getLineEndChar(lineAboveSelection),
  );

  return {
    line: topNonEmptyLine,
    character: baseEndChar + INLINE_TIP_LINE_OFFSET,
  };
}
