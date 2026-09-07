import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { t } from "../../i18n/index.js";
import { getUriPathBasename } from "../../util/uri";
import { ToolCallError, ToolCallErrorCode } from "../errors";

import { ToolImpl } from ".";
import { evaluateRustEditGuard } from "../rustEditGuard";

export const writeFileImpl: ToolImpl = async (args, extras) => {
  if (!args.filepath || typeof args.filepath !== "string") {
    throw new Error(t("missingRequiredParam", { param: "filepath" }));
  }
  if (typeof args.contents !== "string") {
    throw new Error(t("invalidContentsMustBeString"));
  }

  const filepath = args.filepath.trim();
  if (!filepath) {
    throw new Error(t("filepathCannotBeEmpty"));
  }

  const openAfterWrite = args.openAfterWrite !== false;
  const contents: string = args.contents;

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
  let previous = "";
  if (fileExists) {
    try {
      previous = await extras.ide.readFile(resolvedFileUri);
    } catch {
      previous = "";
    }
  }
  const rustGuard = evaluateRustEditGuard({
    filePath: filepath,
    oldText: previous,
    newText: contents,
  });
  if (rustGuard.block) {
    return [rustGuard.block];
  }

  if (extras.abortSignal?.aborted) {
    throw new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message: "Write file cancelled",
      toolName: extras.tool.function.name,
      retryable: false,
    });
  }

  try {
    await extras.ide.writeFile(resolvedFileUri, contents);
  } catch (error) {
    const errorMessage = (error as Error).message;
    if (
      errorMessage.includes("ENOENT") ||
      errorMessage.includes("no such file or directory")
    ) {
      throw new Error(t("failedToCreateFileParentDir", { filepath }));
    }
    throw new Error(t("failedToWriteFile", { filepath, error: errorMessage }));
  }

  if (openAfterWrite) {
    try {
      await extras.ide.openFile(resolvedFileUri);
    } catch (error) {
      console.warn(
        t("createdButFailedToOpen", {
          filepath,
          error: (error as Error).message,
        }),
      );
    }
  }

  const basename = getUriPathBasename(filepath);
  const action = fileExists ? "Overwrote" : "Created";
  return [
    {
      name: basename,
      description: `${action} file: ${filepath}`,
      content: `File "${filepath}" has been ${action.toLowerCase()} successfully.\n\nPath: ${resolvedFileUri}\nSize: ${contents.length} bytes`,
      uri: {
        type: "file",
        value: resolvedFileUri,
      },
    },
    ...rustGuard.warnings,
  ];
};
