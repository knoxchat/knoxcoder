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
  return out;
}

export const editFileImpl: ToolImpl = async (args, extras) => {
  if (!args.filepath || typeof args.filepath !== "string") {
    throw new Error(t("missingRequiredParam", { param: "filepath" }));
  }
  if (typeof args.old_string !== "string") {
    throw new Error(t("missingRequiredParam", { param: "old_string" }));
  }
  if (typeof args.new_string !== "string") {
    throw new Error(t("missingRequiredParam", { param: "new_string" }));
  }

  const filepath = args.filepath.trim();
  if (!filepath) {
    throw new Error(t("filepathCannotBeEmpty"));
  }

  let oldString: string = args.old_string;
  let newString: string = args.new_string;
  const replaceAll = args.replace_all === true;

  if (!oldString) {
    throw new Error(t("editOldStringEmpty"));
  }
  if (oldString === newString) {
    throw new Error(t("editOldStringUnchanged"));
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

  let matches = countExactOccurrences(content, oldString);
  let recoveredNote = "";
  if (matches === 0) {
    for (const candidate of fallbackOldStrings(
      filepath,
      content,
      oldString,
      newString,
    )) {
      const count = countExactOccurrences(content, candidate.old);
      if (count > 0) {
        oldString = candidate.old;
        newString = candidate.next;
        matches = count;
        recoveredNote =
          "old_string did not match exactly; it matched after aligning " +
          "line endings / Rust pins (edition, rust-version) with the file on disk.";
        break;
      }
    }
  }
  if (matches === 0) {
    const closest = findClosestLines(content, args.old_string);
    const hint = closest.length
      ? `\n${t("editClosestLines", { lines: closest.join("\n") })}`
      : "";
    throw new Error(t("editOldStringNotFound", { filepath }) + hint);
  }
  if (matches > 1 && !replaceAll) {
    throw new Error(
      t("editOldStringNotUnique", { filepath, count: String(matches) }),
    );
  }

  if (extras.abortSignal?.aborted) {
    throw new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message: "Edit file cancelled",
      toolName: extras.tool.function.name,
      retryable: false,
    });
  }

  const next = replaceAll
    ? replaceAllExact(content, oldString, newString)
    : replaceFirstExact(content, oldString, newString);

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

  const basename = getUriPathBasename(filepath);
  const replaced = replaceAll ? matches : 1;
  return [
    {
      name: basename,
      description: `Edited file: ${filepath}`,
      content: `Updated "${filepath}" (${replaced} replacement${replaced === 1 ? "" : "s"}).${recoveredNote ? `\n${recoveredNote}` : ""}\nPath: ${resolvedFileUri}`,
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
