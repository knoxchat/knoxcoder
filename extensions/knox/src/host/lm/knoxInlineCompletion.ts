/**
 * KN-363: vscode-free optional ghost-text inline completions.
 *
 * Off by default (`knoxchat.enableInlineCompletions`) so chat stays the
 * primary surface. The host adapter registers the VS Code provider only
 * while the setting is true.
 */

export const ENABLE_INLINE_COMPLETIONS_SETTING = "knoxchat.enableInlineCompletions";
export const ENABLE_INLINE_COMPLETIONS_DEFAULT = false;

export const INLINE_COMPLETION_PREFIX_LINES = 40;
export const INLINE_COMPLETION_SUFFIX_LINES = 12;
export const INLINE_COMPLETION_MAX_CHARS = 800;
export const INLINE_COMPLETION_MAX_FILE_CHARS = 200_000;
export const INLINE_COMPLETION_COMPLETE_OPTIONS = {
  maxTokens: 128,
  temperature: 0.1,
} as const;

export const INLINE_COMPLETION_TRIGGER_AUTOMATIC = "automatic";
export const INLINE_COMPLETION_TRIGGER_EXPLICIT = "explicit";

export const INLINE_COMPLETION_EXCLUDED_SCHEMES = [
  "output",
  "comment",
  "git",
  "knox",
  "debug",
  "vscode",
] as const;

export type InlineCompletionTriggerKind =
  | typeof INLINE_COMPLETION_TRIGGER_AUTOMATIC
  | typeof INLINE_COMPLETION_TRIGGER_EXPLICIT;

export type InlineCompletionDocumentSlice = {
  lines: readonly string[];
  line: number;
  character: number;
  prefixLineCount?: number;
  suffixLineCount?: number;
};

export function isInlineCompletionsEnabled(value: unknown): boolean {
  return value === true;
}

export function shouldProvideInlineCompletion(args: {
  enabled: boolean;
  scheme: string;
  documentChars: number;
  triggerKind: InlineCompletionTriggerKind;
  atWord: boolean;
  atLineStart: boolean;
}): boolean {
  if (!args.enabled) {
    return false;
  }
  if (
    (INLINE_COMPLETION_EXCLUDED_SCHEMES as readonly string[]).includes(
      args.scheme,
    )
  ) {
    return false;
  }
  if (args.documentChars > INLINE_COMPLETION_MAX_FILE_CHARS) {
    return false;
  }
  if (
    args.triggerKind === INLINE_COMPLETION_TRIGGER_AUTOMATIC &&
    !args.atWord &&
    args.atLineStart
  ) {
    return false;
  }
  return true;
}

export function slicePrefixSuffix(
  args: InlineCompletionDocumentSlice,
): { prefix: string; suffix: string } {
  const prefixLineCount =
    args.prefixLineCount ?? INLINE_COMPLETION_PREFIX_LINES;
  const suffixLineCount =
    args.suffixLineCount ?? INLINE_COMPLETION_SUFFIX_LINES;
  const start = Math.max(0, args.line - prefixLineCount);
  const end = Math.min(args.lines.length, args.line + suffixLineCount + 1);
  const before = args.lines.slice(start, args.line);
  const cursor = args.lines[args.line] ?? "";
  const after = args.lines.slice(args.line + 1, end);
  const prefix =
    before.length > 0
      ? `${before.join("\n")}\n${cursor.slice(0, args.character)}`
      : cursor.slice(0, args.character);
  const suffix =
    after.length > 0
      ? `${cursor.slice(args.character)}\n${after.join("\n")}`
      : cursor.slice(args.character);
  return { prefix, suffix };
}

export function buildFimPrompt(
  languageId: string,
  prefix: string,
  suffix: string,
): string {
  return [
    "You are a code completion engine. Continue the code at the cursor.",
    "Return only the completion text — no markdown, no fences, no explanation.",
    `Language: ${languageId}`,
    "<<<PREFIX>>>",
    prefix,
    "<<<SUFFIX>>>",
    suffix,
    "<<<COMPLETION>>>",
  ].join("\n");
}

export function stripPrefixOverlap(completion: string, prefix: string): string {
  const linePrefix = prefix.split("\n").pop() ?? "";
  if (!linePrefix || !completion) {
    return completion;
  }
  if (completion.startsWith(linePrefix)) {
    return completion.slice(linePrefix.length);
  }
  const max = Math.min(linePrefix.length, completion.length);
  for (let i = max; i > 0; i--) {
    if (completion.startsWith(linePrefix.slice(-i))) {
      return completion.slice(i);
    }
  }
  return completion;
}

export function sanitizeCompletion(raw: string, prefix = ""): string {
  let text = raw.replace(/\r\n/g, "\n");
  if (text.trimStart().startsWith("```")) {
    text = text.trim();
    text = text.replace(/^```[^\n]*\n?/, "").replace(/```\s*$/, "").trim();
  }
  text = text.replace(/\s+$/, "");
  text = stripPrefixOverlap(text, prefix);
  if (text.length > INLINE_COMPLETION_MAX_CHARS) {
    text = text.slice(0, INLINE_COMPLETION_MAX_CHARS);
  }
  return text;
}

export const INLINE_COMPLETION_MODEL_SETTING = "knoxchat.inlineCompletionModel";
export const INLINE_COMPLETION_ACCEPT_COMMAND = "knoxchat.inlineCompletionAccepted";
export const INLINE_COMPLETION_STATS_COMMAND = "knoxchat.showInlineCompletionStats";

/**
 * K-051: a small, fast model can be named in `knoxchat.inlineCompletionModel`
 * (matched by title); otherwise fall back to the edit, then chat, then first model.
 */
export function pickInlineCompletionModel<T>(selected: {
  edit?: T | null;
  chat?: T | null;
  models?: ReadonlyArray<T> | null;
  preferredTitle?: string;
}): T | undefined {
  const preferred = selected.preferredTitle?.trim();
  if (preferred) {
    const match = selected.models?.find(
      (m) => (m as { title?: string } | null)?.title === preferred,
    );
    if (match) {
      return match;
    }
  }
  return selected.edit ?? selected.chat ?? selected.models?.[0];
}
