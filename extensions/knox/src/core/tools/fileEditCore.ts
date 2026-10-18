/**
 * Shared file-edit matcher used by builtin_edit_file and builtin_apply_patch.
 *
 * Ported from Pi's edit-diff behavior: match against the original file,
 * tolerate unicode/quote/trailing-whitespace drift, preserve unchanged
 * line bytes, and detect overlapping replacements. Sequential matching
 * remains a fallback so chained edits in one call still work.
 */

export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) {
    return "\n";
  }
  if (crlfIdx === -1) {
    return "\n";
  }
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

export function splitBom(raw: string): { bom: string; text: string } {
  if (raw.charCodeAt(0) === 0xfeff) {
    return { bom: raw.slice(0, 1), text: raw.slice(1) };
  }
  return { bom: "", text: raw };
}

/**
 * Progressive normalization for near-miss matching: trailing whitespace,
 * smart quotes, unicode dashes, and special spaces. Leading indent is
 * intentionally left alone (Knox recovers that separately).
 */
export function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function canonicalizeMatchChar(ch: string): string {
  if (/[\u2018\u2019\u201A\u201B]/.test(ch)) {
    return "'";
  }
  if (/[\u201C\u201D\u201E\u201F]/.test(ch)) {
    return '"';
  }
  if (/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/.test(ch)) {
    return "-";
  }
  if (/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/.test(ch)) {
    return " ";
  }
  return ch;
}

/**
 * Collapse all whitespace (including newlines) to a single space so markdown
 * wrap drift still locates the same unique span. indexMap[i] is the original
 * offset of collapsed[i].
 */
export function collapseWhitespace(text: string): {
  collapsed: string;
  indexMap: number[];
} {
  let collapsed = "";
  const indexMap: number[] = [];
  let i = 0;
  const isWs = (ch: string) => /\s/.test(ch) || ch === " ";
  while (i < text.length) {
    const raw = text[i];
    const ch = canonicalizeMatchChar(raw);
    if (isWs(raw) || isWs(ch)) {
      while (i < text.length) {
        const r = text[i];
        const n = canonicalizeMatchChar(r);
        if (!(isWs(r) || isWs(n))) {
          break;
        }
        i++;
      }
      if (collapsed.length > 0 && !collapsed.endsWith(" ")) {
        collapsed += " ";
        indexMap.push(i - 1);
      }
      continue;
    }
    collapsed += ch;
    indexMap.push(i);
    i++;
  }
  if (collapsed.endsWith(" ")) {
    collapsed = collapsed.slice(0, -1);
    indexMap.pop();
  }
  return { collapsed, indexMap };
}

const MIN_COLLAPSED_MATCH = 12;

export interface CollapsedSpan {
  start: number;
  end: number;
}

/** Non-overlapping original-file spans that match `needle` ignoring wrap/indent. */
export function findAllCollapsedWhitespaceSpans(
  content: string,
  needle: string,
): CollapsedSpan[] {
  const hay = collapseWhitespace(content);
  const ned = collapseWhitespace(needle);
  if (ned.collapsed.length < MIN_COLLAPSED_MATCH) {
    return [];
  }
  const spans: CollapsedSpan[] = [];
  let from = 0;
  while (from + ned.collapsed.length <= hay.collapsed.length) {
    const idx = hay.collapsed.indexOf(ned.collapsed, from);
    if (idx === -1) {
      break;
    }
    const start = hay.indexMap[idx];
    const last = hay.indexMap[idx + ned.collapsed.length - 1];
    spans.push({ start, end: last + 1 });
    from = idx + ned.collapsed.length;
  }
  return spans;
}

export function findCollapsedWhitespaceSpan(
  content: string,
  needle: string,
): CollapsedSpan | undefined {
  const spans = findAllCollapsedWhitespaceSpans(content, needle);
  return spans.length === 1 ? spans[0] : undefined;
}

export interface FuzzyMatchResult {
  found: boolean;
  index: number;
  matchLength: number;
  usedFuzzyMatch: boolean;
  contentForReplacement: string;
}

export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
  if (fuzzyIndex === -1) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }
  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent,
  };
}

export function countFuzzyOccurrences(content: string, oldText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  if (!fuzzyOldText) {
    return 0;
  }
  return fuzzyContent.split(fuzzyOldText).length - 1;
}

export interface CoreEdit {
  oldText: string;
  newText: string;
}

interface TextReplacement {
  matchIndex: number;
  matchLength: number;
  newText: string;
}

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function getLineSpans(content: string): Array<{ start: number; end: number }> {
  let offset = 0;
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length };
    offset = span.end;
    return span;
  });
}

function applyReplacements(
  content: string,
  replacements: TextReplacement[],
  offset = 0,
): string {
  let result = content;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i];
    const matchIndex = replacement.matchIndex - offset;
    result =
      result.substring(0, matchIndex) +
      replacement.newText +
      result.substring(matchIndex + replacement.matchLength);
  }
  return result;
}

function getReplacementLineRange(
  lines: Array<{ start: number; end: number }>,
  replacement: TextReplacement,
): { startLine: number; endLine: number } {
  const replacementStart = replacement.matchIndex;
  const replacementEnd = replacement.matchIndex + replacement.matchLength;
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (replacementStart >= line.start && replacementStart < line.end) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) {
    throw new Error("Replacement range is outside the base content.");
  }
  let endLine = startLine;
  while (endLine < lines.length && lines[endLine].end < replacementEnd) {
    endLine++;
  }
  if (endLine >= lines.length) {
    throw new Error("Replacement range is outside the base content.");
  }
  return { startLine, endLine: endLine + 1 };
}

/**
 * Overlay replacements computed in a normalized view onto the original
 * bytes, copying untouched line blocks from the original.
 */
export function applyReplacementsPreservingUnchangedLines(
  originalContent: string,
  baseContent: string,
  replacements: TextReplacement[],
): string {
  const originalLines = splitLinesWithEndings(originalContent);
  const baseLines = getLineSpans(baseContent);
  if (originalLines.length !== baseLines.length) {
    throw new Error(
      "Cannot preserve unchanged lines because the base content has a different line count.",
    );
  }

  const groups: Array<{
    startLine: number;
    endLine: number;
    replacements: TextReplacement[];
  }> = [];
  const sorted = [...replacements].sort((a, b) => a.matchIndex - b.matchIndex);
  for (const replacement of sorted) {
    const range = getReplacementLineRange(baseLines, replacement);
    const current = groups[groups.length - 1];
    if (current && range.startLine < current.endLine) {
      current.endLine = Math.max(current.endLine, range.endLine);
      current.replacements.push(replacement);
      continue;
    }
    groups.push({ ...range, replacements: [replacement] });
  }

  let originalLineIndex = 0;
  let result = "";
  for (const group of groups) {
    result += originalLines.slice(originalLineIndex, group.startLine).join("");
    const groupStartOffset = baseLines[group.startLine].start;
    const groupEndOffset = baseLines[group.endLine - 1].end;
    result += applyReplacements(
      baseContent.slice(groupStartOffset, groupEndOffset),
      group.replacements,
      groupStartOffset,
    );
    originalLineIndex = group.endLine;
  }
  result += originalLines.slice(originalLineIndex).join("");
  return result;
}

export class FileEditMatchError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "not_unique" | "overlap" | "empty" | "no_change",
    readonly editIndex?: number,
  ) {
    super(message);
    this.name = "FileEditMatchError";
  }
}

export interface AppliedEditsResult {
  next: string;
  replaced: number;
  usedFuzzyMatch: boolean;
}

/**
 * Apply disjoint replacements against the original file (Pi semantics).
 * All oldText values are located in the pre-edit content, then applied
 * back-to-front so offsets stay stable.
 */
export function applyEditsAgainstOriginal(
  content: string,
  edits: CoreEdit[],
  path: string,
): AppliedEditsResult {
  const normalizedEdits = edits
    .map((edit) => ({
      oldText: normalizeToLF(edit.oldText),
      newText: normalizeToLF(edit.newText),
    }))
    .filter((edit) => edit.oldText !== edit.newText);

  if (normalizedEdits.length === 0) {
    throw new FileEditMatchError(
      `No changes made to ${path}. The replacements produced identical content.`,
      "no_change",
    );
  }

  for (let i = 0; i < normalizedEdits.length; i++) {
    if (normalizedEdits[i].oldText.length === 0) {
      throw new FileEditMatchError(
        normalizedEdits.length === 1
          ? `oldText must not be empty in ${path}.`
          : `edits[${i}].oldText must not be empty in ${path}.`,
        "empty",
        i,
      );
    }
  }

  const initialMatches = normalizedEdits.map((edit) =>
    fuzzyFindText(content, edit.oldText),
  );
  const usedFuzzyMatch = initialMatches.some((match) => match.usedFuzzyMatch);
  const replacementBase = usedFuzzyMatch
    ? normalizeForFuzzyMatch(content)
    : content;

  const matched: Array<TextReplacement & { editIndex: number }> = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const edit = normalizedEdits[i];
    const matchResult = fuzzyFindText(replacementBase, edit.oldText);
    if (!matchResult.found) {
      throw new FileEditMatchError(
        normalizedEdits.length === 1
          ? `Could not find the exact text in ${path}. The old text must match uniquely, including whitespace and newlines.`
          : `Could not find edits[${i}] in ${path}. The oldText must match uniquely, including whitespace and newlines.`,
        "not_found",
        i,
      );
    }
    const occurrences = countFuzzyOccurrences(replacementBase, edit.oldText);
    if (occurrences > 1) {
      throw new FileEditMatchError(
        normalizedEdits.length === 1
          ? `Found ${occurrences} occurrences of the text in ${path}. Provide more surrounding context to make it unique.`
          : `Found ${occurrences} occurrences of edits[${i}] in ${path}. Each oldText must be unique.`,
        "not_unique",
        i,
      );
    }
    matched.push({
      editIndex: i,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: edit.newText,
    });
  }

  matched.sort((a, b) => a.matchIndex - b.matchIndex);
  for (let i = 1; i < matched.length; i++) {
    const previous = matched[i - 1];
    const current = matched[i];
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new FileEditMatchError(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
        "overlap",
        current.editIndex,
      );
    }
  }

  const next = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines(content, replacementBase, matched)
    : applyReplacements(replacementBase, matched);

  if (next === content) {
    throw new FileEditMatchError(
      `No changes made to ${path}. The replacement produced identical content.`,
      "no_change",
    );
  }

  return { next, replaced: edits.length, usedFuzzyMatch };
}

/**
 * Up to `limit` lines of `content` most likely meant by the first line of
 * `needle` (whitespace-insensitive match, then same leading key). Helps the
 * model retry with exact text instead of guessing again.
 */
export function findClosestLines(
  content: string,
  needle: string,
  limit = 3,
): string[] {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  const firstLine = needle.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const target = squash(firstLine);
  if (!target) {
    return [];
  }
  const key = target.match(/^[\w.\-"]+/)?.[0];
  const lines = content.split(/\r?\n/);
  const exact: string[] = [];
  const sameKey: string[] = [];
  lines.forEach((line, i) => {
    const squashed = squash(line);
    if (!squashed) {
      return;
    }
    const entry = `${i + 1}: ${line}`;
    if (squashed.includes(target)) {
      exact.push(entry);
    } else if (key && key.length >= 3 && squashed.startsWith(key)) {
      sameKey.push(entry);
    }
  });
  const found = [...exact, ...sameKey];
  if (found.length > 0) {
    return found.slice(0, limit);
  }

  const hay = collapseWhitespace(content);
  const ned = collapseWhitespace(needle);
  const words = ned.collapsed.split(" ").filter(Boolean);
  for (let n = Math.min(words.length, 12); n >= 3; n--) {
    const probe = words.slice(0, n).join(" ");
    if (probe.length < MIN_COLLAPSED_MATCH) {
      continue;
    }
    const idx = hay.collapsed.indexOf(probe);
    if (idx === -1) {
      continue;
    }
    const start = hay.indexMap[idx];
    const lineNo = content.slice(0, start).split(/\r?\n/).length;
    const line = content.split(/\r?\n/)[lineNo - 1] ?? "";
    return [`${lineNo}: ${line}`];
  }
  return [];
}

/**
 * Find a unique line sequence: exact, then trailing-ws/quote/dash drift,
 * then indent-insensitive. Returns start indexes in `haystack`.
 */
export function findLineSequence(
  haystack: string[],
  needle: string[],
): number[] {
  if (needle.length === 0) {
    return [];
  }
  const exact = findExactSequence(haystack, needle);
  if (exact.length > 0) {
    return exact;
  }
  const fuzzyHay = haystack.map((line) => normalizeForFuzzyMatch(line));
  const fuzzyNeedle = needle.map((line) => normalizeForFuzzyMatch(line));
  const fuzzyChanged =
    fuzzyHay.some((line, i) => line !== haystack[i]) ||
    fuzzyNeedle.some((line, i) => line !== needle[i]);
  if (fuzzyChanged) {
    const fuzzy = findExactSequence(fuzzyHay, fuzzyNeedle);
    if (fuzzy.length > 0) {
      return fuzzy;
    }
  }
  const indentHay = haystack.map((line) => normalizeForFuzzyMatch(line).trim());
  const indentNeedle = needle.map((line) => normalizeForFuzzyMatch(line).trim());
  if (indentNeedle.every((line) => !line)) {
    return [];
  }
  if (
    indentHay.every((line, i) => line === haystack[i]) &&
    indentNeedle.every((line, i) => line === needle[i])
  ) {
    return [];
  }
  return findExactSequence(indentHay, indentNeedle);
}

function findExactSequence(haystack: string[], needle: string[]): number[] {
  const hits: number[] = [];
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      hits.push(i);
    }
  }
  return hits;
}
