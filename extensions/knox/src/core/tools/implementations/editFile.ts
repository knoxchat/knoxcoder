import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { t } from "../../i18n/index.js";
import { getUriPathBasename } from "../../util/uri";
import { ToolCallError, ToolCallErrorCode } from "../errors";

import { ToolImpl } from ".";
import { evaluateRustEditGuard } from "../rustEditGuard";

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

  const oldString: string = args.old_string;
  const newString: string = args.new_string;
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

  const matches = countExactOccurrences(content, oldString);
  if (matches === 0) {
    throw new Error(t("editOldStringNotFound", { filepath }));
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
      content: `Updated "${filepath}" (${replaced} replacement${replaced === 1 ? "" : "s"}).\nPath: ${resolvedFileUri}`,
      uri: {
        type: "file",
        value: resolvedFileUri,
      },
    },
    ...rustGuard.warnings,
  ];
};
