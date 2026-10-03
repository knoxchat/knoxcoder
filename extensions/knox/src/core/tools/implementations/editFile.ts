import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { t } from "../../i18n/index.js";
import { getUriPathBasename } from "../../util/uri";
import { ToolCallError, ToolCallErrorCode } from "../errors";

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
  return [...exact, ...sameKey].slice(0, limit);
}

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

/** Normalize the single-edit and `edits: [...]` call shapes to one list. */
export function collectEdits(args: any): EditSpec[] {
  if (Array.isArray(args.edits) && args.edits.length > 0) {
    return args.edits.map((e: any, i: number) => {
      if (!e || typeof e.old_string !== "string" || typeof e.new_string !== "string") {
        throw new Error(`edits[${i}] needs string old_string and new_string`);
      }
      return {
        old_string: e.old_string,
        new_string: e.new_string,
        replace_all: e.replace_all === true,
      };
    });
  }
  if (typeof args.old_string !== "string") {
    throw new Error(t("missingRequiredParam", { param: "old_string" }));
  }
  if (typeof args.new_string !== "string") {
    throw new Error(t("missingRequiredParam", { param: "new_string" }));
  }
  return [
    {
      old_string: args.old_string,
      new_string: args.new_string,
      replace_all: args.replace_all === true,
    },
  ];
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
    throw new Error(label + t("editOldStringUnchanged"));
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

// ─── Stale-read detection ────────────────────────────────────────────────
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
  if (!args.filepath || typeof args.filepath !== "string") {
    throw new Error(t("missingRequiredParam", { param: "filepath" }));
  }
  const edits = collectEdits(args);

  const filepath = args.filepath.trim();
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
  edits.forEach((edit, i) => {
    const label = edits.length > 1 ? `Edit ${i + 1} of ${edits.length} failed (no changes written): ` : "";
    const r = applyEditToContent(filepath, next, edit, label);
    next = r.next;
    replaced += r.replaced;
    if (r.note) {
      notes.push(r.note);
    }
  });
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
