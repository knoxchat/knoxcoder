/**
 * KN-345: vscode-free selection / diagnostic quick-fix → chat.
 *
 * Lightbulb "Ask Knox" posts `highlightedCode` with the diagnostic range
 * (±3 lines) plus an explain prompt and `shouldRun: true`. The native GUI
 * inserts the code block, appends the prompt, and submits.
 */

/** VS Code setting that unregisters the Ask Knox CodeAction provider. */
export const DISABLE_QUICK_FIX_SETTING = "knoxchat.disableQuickFix";
export const QUICK_FIX_COMMAND = "knoxchat.quickFix";
export const QUICK_FIX_TITLE = "Ask Knox";
export const QUICK_FIX_COMMAND_TITLE = "Knox Quick Fix";
export const QUICK_FIX_KIND = "quickfix";
export const QUICK_FIX_CONTEXT_LINES = 3;
export const HIGHLIGHTED_CODE_MESSAGE = "highlightedCode";
export const FOCUS_KNOX_GUI_COMMAND = "knoxchat.knoxGUIView.focus";

export interface QuickFixRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface RangeInFileWithContents {
  filepath: string;
  contents: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface HighlightedCodeRequest {
  rangeInFileWithContents: RangeInFileWithContents;
  prompt?: string;
  shouldRun?: boolean;
}

export function isQuickFixProviderEnabled(
  disableQuickFix: boolean | undefined,
): boolean {
  return disableQuickFix !== true;
}

export function quickFixSurroundingRange(
  startLine: number,
  endLine: number,
  lineCount: number,
  contextLines = QUICK_FIX_CONTEXT_LINES,
): QuickFixRange {
  return {
    startLine: Math.max(0, startLine - contextLines),
    startCharacter: 0,
    endLine: Math.min(lineCount, endLine + contextLines),
    endCharacter: 0,
  };
}

export function askKnoxQuickFixSpec(
  surrounding: QuickFixRange,
  diagnosticMessage: string,
): {
  title: typeof QUICK_FIX_TITLE;
  kind: typeof QUICK_FIX_KIND;
  isPreferred: false;
  command: {
    command: typeof QUICK_FIX_COMMAND;
    title: typeof QUICK_FIX_COMMAND_TITLE;
    arguments: [QuickFixRange, string];
  };
} {
  return {
    title: QUICK_FIX_TITLE,
    kind: QUICK_FIX_KIND,
    isPreferred: false,
    command: {
      command: QUICK_FIX_COMMAND,
      title: QUICK_FIX_COMMAND_TITLE,
      arguments: [surrounding, diagnosticMessage],
    },
  };
}

export function buildHighlightedCodeRequest(
  rangeInFileWithContents: RangeInFileWithContents,
  options?: { prompt?: string; shouldRun?: boolean },
): HighlightedCodeRequest {
  const request: HighlightedCodeRequest = { rangeInFileWithContents };
  if (options?.prompt) {
    request.prompt = options.prompt;
  }
  if (options?.shouldRun) {
    request.shouldRun = true;
  }
  return request;
}

/** Diagnostic / custom quick-action path: attach code, prompt, and submit. */
export function buildQuickFixChatRequest(
  rangeInFileWithContents: RangeInFileWithContents,
  prompt: string,
): HighlightedCodeRequest {
  return buildHighlightedCodeRequest(rangeInFileWithContents, {
    prompt,
    shouldRun: true,
  });
}
