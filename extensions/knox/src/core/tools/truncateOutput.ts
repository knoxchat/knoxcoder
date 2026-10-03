/**
 * Shared tool-output truncation policy (K-033).
 * Every readonly tool funnels large text through here so caps and hints agree.
 */

export const DEFAULT_MAX_OUTPUT_LINES = 2000;
export const DEFAULT_MAX_OUTPUT_CHARS = 60_000;
export const DEFAULT_HEAD_TAIL_LINES = 40;

export interface TruncateResult {
  text: string;
  truncated: boolean;
  totalLines: number;
  omittedLines: number;
}

/** Keep the first `maxLines` lines and add a continuation hint. */
export function capLines(
  text: string,
  opts: {
    maxLines?: number;
    /** 1-based line number of the first line of `text` in its source. */
    firstLine?: number;
    hint?: (nextLine: number) => string;
  } = {},
): TruncateResult {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_OUTPUT_LINES;
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return { text, truncated: false, totalLines: lines.length, omittedLines: 0 };
  }
  const first = opts.firstLine ?? 1;
  const next = first + maxLines;
  const hint =
    opts.hint?.(next) ??
    `… ${lines.length - maxLines} more lines. Continue with startLine=${next}.`;
  return {
    text: `${lines.slice(0, maxLines).join("\n")}\n${hint}`,
    truncated: true,
    totalLines: lines.length,
    omittedLines: lines.length - maxLines,
  };
}

/** Keep head and tail lines, dropping the middle. */
export function headTail(
  text: string,
  opts: { head?: number; tail?: number } = {},
): TruncateResult {
  const head = opts.head ?? DEFAULT_HEAD_TAIL_LINES;
  const tail = opts.tail ?? DEFAULT_HEAD_TAIL_LINES;
  const lines = text.split("\n");
  if (lines.length <= head + tail) {
    return { text, truncated: false, totalLines: lines.length, omittedLines: 0 };
  }
  const omitted = lines.length - head - tail;
  return {
    text: [
      ...lines.slice(0, head),
      `… truncated ${omitted} middle lines …`,
      ...lines.slice(-tail),
    ].join("\n"),
    truncated: true,
    totalLines: lines.length,
    omittedLines: omitted,
  };
}

/** Hard character cap on line boundaries; appends `hint`. */
export function capChars(
  text: string,
  maxChars: number = DEFAULT_MAX_OUTPUT_CHARS,
  hint = "narrow the query or pass a smaller range",
): TruncateResult {
  const totalLines = text.split("\n").length;
  if (text.length <= maxChars) {
    return { text, truncated: false, totalLines, omittedLines: 0 };
  }
  let cut = text.lastIndexOf("\n", maxChars);
  if (cut < maxChars / 2) {
    cut = maxChars;
  }
  const kept = text.slice(0, cut);
  const keptLines = kept.split("\n").length;
  return {
    text: `${kept}\n… output truncated at ${maxChars} chars (${totalLines - keptLines} lines omitted); ${hint}.`,
    truncated: true,
    totalLines,
    omittedLines: totalLines - keptLines,
  };
}
