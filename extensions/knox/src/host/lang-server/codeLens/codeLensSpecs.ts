/**
 * KN-341: vscode-free CodeLens command specs for vertical diffs, inline
 * suggestions, and quick actions. Providers wrap these in vscode.CodeLens.
 */

export const CODELENS_COMMANDS = {
  acceptVerticalBlock: "knoxchat.acceptVerticalDiffBlock",
  rejectVerticalBlock: "knoxchat.rejectVerticalDiffBlock",
  acceptSuggestion: "knoxchat.acceptSuggestion",
  rejectSuggestion: "knoxchat.rejectSuggestion",
  acceptAllSuggestions: "knoxchat.acceptAllSuggestions",
  rejectAllSuggestions: "knoxchat.rejectAllSuggestions",
  defaultQuickAction: "knoxchat.defaultQuickAction",
  customQuickActionChat: "knoxchat.customQuickActionSendToChat",
  customQuickActionInline: "knoxchat.customQuickActionStreamInlineEdit",
} as const;

export const ENABLE_QUICK_ACTIONS_SETTING = "knoxchat.enableQuickActions";

export interface VerticalDiffCodeLensBlock {
  start: number;
  numRed: number;
  numGreen: number;
}

export interface CodeLensCommandSpec {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface CodeLensSpec {
  startLine: number;
  endLine: number;
  command: CodeLensCommandSpec;
  /** Opaque vscode.Range (or equivalent) used as the CodeLens range. */
  lensRange?: unknown;
}

export interface SuggestionCodeLensRange {
  oldStartLine: number;
  newEndLine: number;
  suggestion: unknown;
}

export interface QuickActionConfigSpec {
  title: string;
  prompt: string;
  sendToChat: boolean;
}

export interface QuickActionRangeSpec {
  startLine: number;
  endLine: number;
  range: unknown;
}

export function verticalPerLineCodeLensSpecs(
  uri: string,
  blocks: readonly VerticalDiffCodeLensBlock[],
): CodeLensSpec[] {
  const lenses: CodeLensSpec[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const startLine = block.start;
    const endLine = block.start + block.numGreen + block.numRed;
    lenses.push(
      {
        startLine,
        endLine,
        command: {
          title: "Accept",
          command: CODELENS_COMMANDS.acceptVerticalBlock,
          arguments: [uri, i],
        },
      },
      {
        startLine,
        endLine,
        command: {
          title: "Reject",
          command: CODELENS_COMMANDS.rejectVerticalBlock,
          arguments: [uri, i],
        },
      },
    );
  }
  return lenses;
}

export function suggestionCodeLensSpecs(
  suggestions: readonly SuggestionCodeLensRange[],
  acceptRejectAllHint?: string,
): CodeLensSpec[] {
  const lenses: CodeLensSpec[] = [];
  for (const suggestion of suggestions) {
    const startLine = suggestion.oldStartLine;
    const endLine = suggestion.newEndLine;
    lenses.push(
      {
        startLine,
        endLine,
        command: {
          title: "Accept",
          command: CODELENS_COMMANDS.acceptSuggestion,
          arguments: [suggestion.suggestion],
        },
      },
      {
        startLine,
        endLine,
        command: {
          title: "Reject",
          command: CODELENS_COMMANDS.rejectSuggestion,
          arguments: [suggestion.suggestion],
        },
      },
    );
    if (lenses.length === 2 && acceptRejectAllHint) {
      lenses.push({
        startLine,
        endLine,
        command: {
          title: acceptRejectAllHint,
          command: "",
        },
      });
    }
  }
  return lenses;
}

export function quickActionCodeLensSpecs(
  enabled: boolean,
  ranges: readonly QuickActionRangeSpec[],
  custom?: readonly QuickActionConfigSpec[],
): CodeLensSpec[] {
  if (!enabled) {
    return [];
  }
  return ranges.flatMap(({ startLine, endLine, range }) =>
    quickActionCommands(custom).map((command) => ({
      startLine,
      endLine,
      lensRange: range,
      command: {
        title: command.title,
        command: command.command,
        arguments:
          command.command === CODELENS_COMMANDS.defaultQuickAction
            ? [{ range }]
            : [command.prompt, range],
      },
    })),
  );
}

export function quickActionCommands(
  custom?: readonly QuickActionConfigSpec[],
): Array<{ title: string; command: string; prompt?: string }> {
  if (custom) {
    return custom.map(({ title, prompt, sendToChat }) => ({
      title,
      prompt,
      command: sendToChat
        ? CODELENS_COMMANDS.customQuickActionChat
        : CODELENS_COMMANDS.customQuickActionInline,
    }));
  }
  return [
    {
      title: "Knox",
      command: CODELENS_COMMANDS.defaultQuickAction,
    },
  ];
}

/**
 * After accept/reject of the block that starts at `startLine`, drop that
 * block and shift later blocks by `offset` (negative when lines were removed).
 */
export function shiftVerticalDiffCodeLensBlocks(
  blocks: readonly VerticalDiffCodeLensBlock[],
  startLine: number,
  offset: number,
): VerticalDiffCodeLensBlock[] {
  return blocks
    .filter((block) => block.start !== startLine)
    .map((block) =>
      block.start > startLine
        ? { ...block, start: block.start + offset }
        : block,
    );
}
