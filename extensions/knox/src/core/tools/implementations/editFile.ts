import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { t } from "../../i18n/index.js";
import { getUriPathBasename } from "../../util/uri";
import { ToolCallError, ToolCallErrorCode } from "../errors";
import {
  applyEditsAgainstOriginal,
  FileEditMatchError,
  findAllCollapsedWhitespaceSpans,
  findClosestLines,
  normalizeToLF,
  restoreLineEndings,
  detectLineEnding,
  splitBom,
} from "../fileEditCore";
import {
  asEditsArray,
  coerceEditText,
  EDIT_NEW_KEYS,
  EDIT_OLD_KEYS,
  pickEditText,
} from "../editArgs";

import { ToolImpl } from ".";
import { evaluateRustEditGuard } from "../rustEditGuard";
import { evaluateTestEditWarnings } from "../testEditGuard";
import { alignRustPinsInSnippet } from "../../context/rustDefaults";

/** Count non-overlapping exact occurrences of needle in haystack. */
export function countExactOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let pos = 0;
  while (pos <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) {
      break;
    }
    count++;
    pos = idx + needle.length;
  }
  return count;
}

/** Replace every non-overlapping occurrence (literal, not regex). */
export function replaceAllExact(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  return haystack.split(needle).join(replacement);
}

/** Replace the first occurrence only. */
export function replaceFirstExact(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) {
    return haystack;
  }
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

export { findClosestLines };

/**
 * Models often copy `read_file` output with its `  34 | ` gutter. Strip it only
 * when every non-empty line carries one, so real code like `1 | 2` is untouched.
 */
export function stripLineNumberGutter(text: string): string {
  const lines = text.split("\n");
  const gutter = /^\s*\d+\s*\|\s?/;
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0 || !nonEmpty.every((l) => gutter.test(l))) {
    return text;
  }
  return lines.map((l) => l.replace(gutter, "")).join("\n");
}

const leadingWs = (s: string) => s.match(/^[ \t]*/)?.[0] ?? "";

/**
 * Whole-line match that ignores leading/trailing whitespace per line (wrong
 * indent, tabs vs spaces, trailing spaces). Only succeeds on a single unique
 * block; returns the file's actual text plus `newString` re-indented to it.
 */
export function findWhitespaceInsensitiveBlock(
  content: string,
  oldString: string,
  newString: string,
): { old: string; next: string } | undefined {
  const endsWithNewline = /\r?\n$/.test(oldString);
  if (endsWithNewline !== /\r?\n$/.test(newString)) {
    return undefined;
  }
  const trimEnd = (s: string) => s.replace(/(\r?\n)+$/, "");
  const oldLines = trimEnd(oldString).split(/\r?\n/);
  if (oldLines.length === 0 || oldLines.every((l) => !l.trim())) {
    return undefined;
  }
  const norm = (l: string) => l.replace(/\r$/, "").trim();
  const wanted = oldLines.map(norm);
  const fileLines = content.split("\n");
  const fileNorm = fileLines.map(norm);

  let hit = -1;
  for (let i = 0; i + wanted.length <= fileLines.length; i++) {
    if (wanted.every((w, j) => fileNorm[i + j] === w)) {
      if (hit !== -1) {
        return undefined; // ambiguous
      }
      hit = i;
    }
  }
  if (hit === -1) {
    return undefined;
  }

  const block = fileLines.slice(hit, hit + wanted.length);
  const usesCrlf = block.some((l) => l.endsWith("\r"));
  const actualOld = block
    .map((l, i) => (i === block.length - 1 ? l.replace(/\r$/, "") : l))
    .join("\n");

  // Re-indent: swap the model's first-line indent for the file's.
  const modelIndent = leadingWs(oldLines.find((l) => l.trim()) ?? "");
  const fileIndent = leadingWs(block[wanted.findIndex((w) => w)] ?? "");
  let next = trimEnd(newString);
  if (modelIndent !== fileIndent) {
    next = next
      .split(/\r?\n/)
      .map((l) => (l.startsWith(modelIndent) ? fileIndent + l.slice(modelIndent.length) : l))
      .join("\n");
  }
  if (usesCrlf) {
    next = next.replace(/\r?\n/g, "\r\n");
  }
  const trailing = endsWithNewline ? (usesCrlf ? "\r\n" : "\n") : "";
  return { old: actualOld + trailing, next: next + trailing };
}

/** Retry candidates for a missed `old_string`, most specific first. */
function fallbackOldStrings(
  filepath: string,
  content: string,
  oldString: string,
  newString: string,
): Array<{ old: string; next: string }> {
  const out: Array<{ old: string; next: string }> = [];
  const push = (old: string, next: string) => {
    if (old && !out.some((c) => c.old === old && c.next === next)) {
      out.push({ old, next });
    }
  };
  const toCrlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

  if (content.includes("\r\n") && !oldString.includes("\r\n")) {
    push(toCrlf(oldString), toCrlf(newString));
  }
  // Knox rewrites new Cargo.toml pins (edition 2024 / rust 1.98.1) on write.
  const aligned = alignRustPinsInSnippet(filepath, oldString);
  if (aligned !== oldString) {
    // Keep the new text on the same pins so the edit cannot reintroduce 2021.
    const alignedNew = alignRustPinsInSnippet(filepath, newString);
    push(aligned, alignedNew);
    if (content.includes("\r\n") && !aligned.includes("\r\n")) {
      push(toCrlf(aligned), toCrlf(alignedNew));
    }
  }
  // Copied read_file gutter ("  34 | code").
  const ungutteredOld = stripLineNumberGutter(oldString);
  const ungutteredNew = stripLineNumberGutter(newString);
  if (ungutteredOld !== oldString) {
    push(ungutteredOld, ungutteredNew);
    if (content.includes("\r\n")) {
      push(toCrlf(ungutteredOld), toCrlf(ungutteredNew));
    }
  }
  // Last resort: whole-line match ignoring indentation / trailing whitespace.
  const fuzzy = findWhitespaceInsensitiveBlock(
    content,
    ungutteredOld,
    ungutteredNew,
  );
  if (fuzzy) {
    push(fuzzy.old, fuzzy.next);
  }
  return out;
}

export interface EditSpec {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

function specFromPair(
  oldString: unknown,
  newString: unknown,
  replaceAll: unknown,
  index?: number,
): EditSpec {
  const oldText = coerceEditText(oldString);
  // Omit new_string to delete old_string (documented Edit / StrReplace behavior).
  const next = newString === undefined ? "" : coerceEditText(newString);
  if (typeof oldText !== "string") {
    throw new Error(
      index === undefined
        ? t("missingRequiredParam", { param: "old_string" })
        : `edits[${index}] needs string old_string/oldText`,
    );
  }
  if (typeof next !== "string") {
    throw new Error(
      index === undefined
        ? t("missingRequiredParam", { param: "new_string" })
        : `edits[${index}] needs string new_string/newText (omit it to delete old_string)`,
    );
  }
  return {
    old_string: oldText,
    new_string: next,
    replace_all: replaceAll === true,
  };
}

type ParsedEntry =
  | { kind: "ok"; spec: EditSpec; omittedNew?: boolean }
  | { kind: "empty" }
  | { kind: "bad"; message: string };

function tryEditEntry(entry: unknown, index: number): ParsedEntry {
  if (entry == null) {
    return { kind: "empty" };
  }
  if (typeof entry === "string") {
    return entry.trim()
      ? { kind: "bad", message: `edits[${index}] needs string old_string/oldText` }
      : { kind: "empty" };
  }
  if (typeof entry !== "object" || Array.isArray(entry)) {
    return {
      kind: "bad",
      message: `edits[${index}] needs string old_string/oldText`,
    };
  }
  const row = entry as Record<string, unknown>;
  const oldText = pickEditText(row, EDIT_OLD_KEYS);
  const next = pickEditText(row, EDIT_NEW_KEYS);
  if (oldText === undefined && next === undefined) {
    return { kind: "empty" };
  }
  const keys = Object.keys(row).join(", ") || "none";
  if (typeof oldText !== "string") {
    return {
      kind: "bad",
      message: `edits[${index}] needs string old_string/oldText (got keys: ${keys})`,
    };
  }
  if (next === undefined) {
    return {
      kind: "ok",
      spec: specFromPair(oldText, undefined, row.replace_all ?? row.replaceAll, index),
      omittedNew: true,
    };
  }
  return {
    kind: "ok",
    spec: specFromPair(oldText, next, row.replace_all ?? row.replaceAll, index),
  };
}

export interface CollectedEdits {
  specs: EditSpec[];
  note: string;
}

/**
 * Normalize the single-edit and `edits: [...]` call shapes to one list.
 * Trailing incomplete entries (typical truncated JSON) are skipped.
 */
export function collectEditsDetailed(args: any): CollectedEdits {
  const listed = asEditsArray(args.edits);
  const specs: EditSpec[] = [];
  const notes: string[] = [];
  if (listed && listed.length > 0) {
    const parsed = listed.map((entry, i) => tryEditEntry(entry, i));
    const lastComplete = parsed.reduce(
      (acc, item, i) => (item.kind === "ok" && !item.omittedNew ? i : acc),
      -1,
    );
    const lastOk = parsed.reduce((acc, item, i) => (item.kind === "ok" ? i : acc), -1);
    let skippedTrailing = 0;
    parsed.forEach((item, i) => {
      if (item.kind === "empty") {
        return;
      }
      if (item.kind === "bad") {
        if (i > lastOk) {
          skippedTrailing++;
          return;
        }
        throw new Error(item.message);
      }
      // A trailing old_string-only row after complete pairs is almost always a
      // cut-off JSON object, not a delete. A lone old_string-only call is a delete.
      if (item.omittedNew && lastComplete >= 0 && i > lastComplete) {
        skippedTrailing++;
        return;
      }
      specs.push(item.spec);
    });
    if (skippedTrailing > 0) {
      notes.push(
        skippedTrailing === 1
          ? "Skipped 1 trailing incomplete edit (call was likely cut off)."
          : `Skipped ${skippedTrailing} trailing incomplete edits (call was likely cut off).`,
      );
    }
  }
  const legacyOld = pickEditText(args, EDIT_OLD_KEYS);
  const legacyNew = pickEditText(args, EDIT_NEW_KEYS);
  if (typeof legacyOld === "string") {
    const omittedNew = legacyNew === undefined;
    if (!omittedNew || specs.length === 0) {
      specs.push(specFromPair(legacyOld, omittedNew ? undefined : legacyNew, args.replace_all ?? args.replaceAll));
    }
  }
  if (specs.length === 0) {
    throw new Error(t("missingRequiredParam", { param: "old_string" }));
  }
  return { specs, note: notes.join("\n") };
}

/** Normalize the single-edit and `edits: [...]` call shapes to one list. */
export function collectEdits(args: any): EditSpec[] {
  return collectEditsDetailed(args).specs;
}

/** True when every line break in the file is CRLF. */
function isCrlfFile(content: string): boolean {
  return content.includes("\r\n") && !/(^|[^\r])\n/.test(content);
}

/**
 * Apply one edit in memory. Throws the same errors a single edit would.
 * `index` / `total` only decorate the message for multi-edit calls.
 */
export function applyEditToContent(
  filepath: string,
  content: string,
  edit: EditSpec,
  label = "",
): { next: string; replaced: number; note: string } {
  let oldString = edit.old_string;
  let newString = edit.new_string;
  if (!oldString) {
    throw new Error(label + t("editOldStringEmpty"));
  }
  if (oldString === newString) {
    // Models often include a "change" that is already the desired text.
    // Failing the whole atomic batch is what sent them shopping other tools.
    return {
      next: content,
      replaced: 0,
      note: "skipped identical old_string/new_string (already correct).",
    };
  }

  let matches = countExactOccurrences(content, oldString);
  let note = "";
  if (matches === 0) {
    for (const candidate of fallbackOldStrings(filepath, content, oldString, newString)) {
      const count = countExactOccurrences(content, candidate.old);
      if (count > 0) {
        oldString = candidate.old;
        newString = candidate.next;
        matches = count;
        note =
          "old_string did not match exactly; it matched after aligning " +
          "line endings, Rust pins, copied line numbers, or indentation/trailing " +
          "whitespace with the file on disk.";
        break;
      }
    }
  }
  if (matches === 0) {
    const spans = findAllCollapsedWhitespaceSpans(
      content,
      stripLineNumberGutter(edit.old_string),
    );
    if (spans.length > 1 && !edit.replace_all) {
      throw new Error(
        label + t("editOldStringNotUnique", { filepath, count: String(spans.length) }),
      );
    }
    if (spans.length > 0) {
      const use = edit.replace_all ? spans : spans.slice(0, 1);
      if (isCrlfFile(content) && /(^|[^\r])\n/.test(newString)) {
        newString = newString.replace(/\r?\n/g, "\r\n");
      }
      let next = content;
      for (let i = use.length - 1; i >= 0; i--) {
        const span = use[i];
        next = next.slice(0, span.start) + newString + next.slice(span.end);
      }
      return {
        next,
        replaced: use.length,
        note:
          "old_string did not match exactly; it matched after ignoring line wrapping and extra whitespace.",
      };
    }
    const closest = findClosestLines(content, edit.old_string);
    const hint = closest.length
      ? `\n${t("editClosestLines", { lines: closest.join("\n") })}`
      : "";
    throw new Error(label + t("editOldStringNotFound", { filepath }) + hint);
  }
  if (matches > 1 && !edit.replace_all) {
    throw new Error(
      label + t("editOldStringNotUnique", { filepath, count: String(matches) }),
    );
  }
  // A CRLF file must stay CRLF even when the model sent bare LF in new_string.
  if (isCrlfFile(content) && /(^|[^\r])\n/.test(newString)) {
    newString = newString.replace(/\r?\n/g, "\r\n");
  }
  const next = edit.replace_all
    ? replaceAllExact(content, oldString, newString)
    : replaceFirstExact(content, oldString, newString);
  return { next, replaced: edit.replace_all ? matches : 1, note };
}

function applySequentialEdits(
  filepath: string,
  content: string,
  edits: EditSpec[],
): { next: string; replaced: number; note: string } {
  let next = content;
  let replaced = 0;
  const notes: string[] = [];
  edits.forEach((edit, i) => {
    const label =
      edits.length > 1
        ? `Edit ${i + 1} of ${edits.length} failed (no changes written): `
        : "";
    const r = applyEditToContent(filepath, next, edit, label);
    next = r.next;
    replaced += r.replaced;
    if (r.note) {
      notes.push(r.note);
    }
  });
  return { next, replaced, note: notes.join("\n") };
}

/**
 * Prefer Pi original-file matching (disjoint edits, fuzzy unicode/quotes).
 * Fall back to sequential Knox matching so chained edits in one call still apply.
 */
function isNoOpEdit(edit: EditSpec): boolean {
  return edit.old_string.length > 0 && edit.old_string === edit.new_string;
}

function withSkipNote(result: { next: string; replaced: number; note: string }, skipped: number) {
  if (skipped === 0) {
    return result;
  }
  const skip =
    skipped === 1
      ? "Skipped 1 no-op replacement (old_string === new_string)."
      : `Skipped ${skipped} no-op replacements (old_string === new_string).`;
  return {
    ...result,
    note: result.note ? `${skip}\n${result.note}` : skip,
  };
}

export function applyCollectedEdits(
  filepath: string,
  content: string,
  edits: EditSpec[],
): { next: string; replaced: number; note: string } {
  const changing = edits.filter((edit) => !isNoOpEdit(edit));
  const skipped = edits.length - changing.length;
  if (changing.length === 0) {
    return withSkipNote({ next: content, replaced: 0, note: "" }, skipped);
  }

  if (changing.some((edit) => edit.replace_all)) {
    return withSkipNote(applySequentialEdits(filepath, content, changing), skipped);
  }

  const { bom, text } = splitBom(content);
  const ending = detectLineEnding(text);
  const normalized = normalizeToLF(text);
  try {
    const original = applyEditsAgainstOriginal(
      normalized,
      changing.map((edit) => ({ oldText: edit.old_string, newText: edit.new_string })),
      filepath,
    );
    return withSkipNote(
      {
        next: bom + restoreLineEndings(original.next, ending),
        replaced: original.replaced,
        note: original.usedFuzzyMatch
          ? "old_string did not match exactly; it matched after normalizing quotes, dashes, or trailing whitespace."
          : "",
      },
      skipped,
    );
  } catch (error) {
    if (!(error instanceof FileEditMatchError) || error.kind === "empty" || error.kind === "overlap") {
      throw error;
    }
    if (error.kind === "no_change") {
      return withSkipNote({ next: content, replaced: 0, note: "" }, skipped);
    }
    return withSkipNote(applySequentialEdits(filepath, content, changing), skipped);
  }
}

/** Compact unified-style diff of the changed region (common head/tail trimmed). */
export function compactDiff(before: string, after: string, maxLines = 40): string {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const removed = a.slice(head, a.length - tail);
  const added = b.slice(head, b.length - tail);
  const lines = [
    `@@ line ${head + 1}: -${removed.length} +${added.length} @@`,
    ...removed.map((l) => `-${l.replace(/\r$/, "")}`),
    ...added.map((l) => `+${l.replace(/\r$/, "")}`),
  ];
  if (lines.length > maxLines) {
    const hidden = lines.length - maxLines;
    return [...lines.slice(0, maxLines), `... (${hidden} more diff lines)`].join("\n");
  }
  return lines.join("\n");
}

// --- Stale-read detection ------------------------------------------------
// Remembers a content hash for files the agent has read or written. If the
// file differs on disk when it is edited later, someone else changed it.

const knownHashes = new Map<string, string>();
const MAX_TRACKED = 500;

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return `${text.length}:${h}`;
}

/** Call after the agent reads or writes a file. */
export function noteFileContent(uri: string, content: string): void {
  if (knownHashes.size >= MAX_TRACKED && !knownHashes.has(uri)) {
    knownHashes.delete(knownHashes.keys().next().value as string);
  }
  knownHashes.set(uri, hashText(content));
}

export function isStaleSinceKnown(uri: string, content: string): boolean {
  const known = knownHashes.get(uri);
  return known !== undefined && known !== hashText(content);
}

export function resetFileTracking(): void {
  knownHashes.clear();
}

export const editFileImpl: ToolImpl = async (args, extras) => {
  const rawPath =
    typeof args.filepath === "string"
      ? args.filepath
      : typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
          ? args.file_path
          : "";
  if (!rawPath) {
    throw new Error(t("missingRequiredParam", { param: "filepath" }));
  }
  const collected = collectEditsDetailed(args);
  const edits = collected.specs;

  const filepath = rawPath.trim();
  if (!filepath) {
    throw new Error(t("filepathCannotBeEmpty"));
  }

  let resolvedFileUri: string;
  try {
    resolvedFileUri = await inferResolvedUriFromRelativePath(
      filepath,
      extras.ide,
    );
  } catch (error) {
    throw new Error(
      t("failedToResolveFilePath", {
        filepath,
        error: (error as Error).message,
      }),
    );
  }

  const fileExists = await extras.ide.fileExists(resolvedFileUri);
  if (!fileExists) {
    throw new Error(t("fileDoesNotExist", { filepath }));
  }

  let content: string;
  try {
    content = await extras.ide.readFile(resolvedFileUri);
  } catch (error) {
    throw new Error(
      t("failedToReadFile", { filepath, error: (error as Error).message }),
    );
  }

  const stale = isStaleSinceKnown(resolvedFileUri, content);

  // All edits apply in memory first; one failure leaves the file untouched.
  let next = content;
  let replaced = 0;
  const notes: string[] = [];
  if (collected.note) {
    notes.push(collected.note);
  }
  const applied = applyCollectedEdits(filepath, content, edits);
  next = applied.next;
  replaced = applied.replaced;
  if (applied.note) {
    notes.push(applied.note);
  }
  const recoveredNote = notes.join("\n");

  if (extras.abortSignal?.aborted) {
    throw new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message: "Edit file cancelled",
      toolName: extras.tool.function.name,
      retryable: false,
    });
  }

  if (next === content) {
    // The file already holds the requested text (e.g. Knox pinned edition 2024
    // on write and the model asked for 2024). Nothing to write.
    return [
      {
        name: getUriPathBasename(filepath),
        description: `Already up to date: ${filepath}`,
        content:
          `No change needed in "${filepath}": it already contains the requested text.` +
          (recoveredNote ? `\n${recoveredNote}` : "") +
          `\nPath: ${resolvedFileUri}`,
        uri: { type: "file", value: resolvedFileUri },
      },
    ];
  }

  const rustGuard = evaluateRustEditGuard({
    filePath: filepath,
    oldText: content,
    newText: next,
  });
  if (rustGuard.block) {
    return [rustGuard.block];
  }

  try {
    await extras.ide.writeFile(resolvedFileUri, next);
  } catch (error) {
    throw new Error(
      t("failedToWriteFile", { filepath, error: (error as Error).message }),
    );
  }
  noteFileContent(resolvedFileUri, next);

  const basename = getUriPathBasename(filepath);
  const staleNote = stale
    ? "\nWarning: this file changed on disk since you last read it. Re-read it to confirm the result."
    : "";
  return [
    {
      name: basename,
      description: `Edited file: ${filepath}`,
      content: `Updated "${filepath}" (${replaced} replacement${replaced === 1 ? "" : "s"}${edits.length > 1 ? ` in ${edits.length} edits` : ""}).${recoveredNote ? `\n${recoveredNote}` : ""}${staleNote}\n${compactDiff(content, next)}\nPath: ${resolvedFileUri}`,
      uri: {
        type: "file",
        value: resolvedFileUri,
      },
    },
    ...rustGuard.warnings,
    ...evaluateTestEditWarnings({
      filePath: filepath,
      oldText: content,
      newText: next,
    }),
  ];
};
