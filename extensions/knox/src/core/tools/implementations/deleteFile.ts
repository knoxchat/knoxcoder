import { t } from "../../i18n/index.js";
import { isSensitiveSecretFile } from "../../util/redactSecrets.js";
import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { getUriPathBasename } from "../../util/uri";
import { ToolCallError, ToolCallErrorCode } from "../errors";
import { toolFilesystem } from "../toolPorts";

import { ToolImpl } from ".";

/** Same rules as recipe `isSafeRelPath`: workspace-relative, no `..`, no abs, no NUL. */
function isWorkspaceRelPath(p: string): boolean {
  if (!p || p.length > 400 || p.includes("\0") || p.includes("\\")) return false;
  if (p.startsWith("/") || p.startsWith("~") || /^[A-Za-z]:/.test(p)) return false;
  return !p.split("/").some((seg) => seg === "..");
}

export const deleteFileImpl: ToolImpl = async (args, extras) => {
  if (!args.filepath || typeof args.filepath !== "string") {
    throw new Error(t("missingRequiredParam", { param: "filepath" }));
  }
  const filepath = args.filepath.trim().replace(/\\/g, "/");
  if (!filepath) {
    throw new Error(t("filepathCannotBeEmpty"));
  }
  if (filepath.endsWith("/")) {
    throw new Error(t("cannotDeleteDirectory", { filepath }));
  }
  if (!isWorkspaceRelPath(filepath)) {
    throw new ToolCallError({
      code: ToolCallErrorCode.PERMISSION_DENIED,
      message: t("unsafeDeletePath", { filepath }),
      toolName: extras.tool.function.name,
      retryable: false,
    });
  }
  if (isSensitiveSecretFile(filepath)) {
    throw new ToolCallError({
      code: ToolCallErrorCode.PERMISSION_DENIED,
      message: t("refusedDeleteSecretFile", { filepath }),
      toolName: extras.tool.function.name,
      retryable: false,
    });
  }

  const fs = toolFilesystem(extras);
  let resolvedFileUri: string;
  try {
    resolvedFileUri = await inferResolvedUriFromRelativePath(filepath, fs);
  } catch (error) {
    throw new Error(
      t("failedToResolveFilePath", {
        filepath,
        error: (error as Error).message,
      }),
    );
  }
  if (isSensitiveSecretFile(resolvedFileUri)) {
    throw new ToolCallError({
      code: ToolCallErrorCode.PERMISSION_DENIED,
      message: t("refusedDeleteSecretFile", { filepath }),
      toolName: extras.tool.function.name,
      retryable: false,
    });
  }

  if (extras.abortSignal?.aborted) {
    throw new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message: "Delete file cancelled",
      toolName: extras.tool.function.name,
      retryable: false,
    });
  }

  const exists = await fs.fileExists(resolvedFileUri);
  if (!exists) {
    return [
      {
        name: getUriPathBasename(filepath),
        description: `Already absent: ${filepath}`,
        content: `File "${filepath}" was already absent.\n\nPath: ${resolvedFileUri}`,
        uri: { type: "file", value: resolvedFileUri },
      },
    ];
  }

  let isDirectory = false;
  try {
    const entries = await fs.listDir(resolvedFileUri);
    isDirectory = Array.isArray(entries);
  } catch {
    // listDir on a file throws (ENOTDIR) — that is the expected file case.
  }
  if (isDirectory) {
    throw new Error(t("cannotDeleteDirectory", { filepath }));
  }

  if (typeof fs.removeFile !== "function") {
    throw new Error(t("patchDeleteUnsupported", { filepath }));
  }

  try {
    await fs.removeFile(resolvedFileUri);
  } catch (error) {
    throw new Error(
      t("failedToDeleteFile", {
        filepath,
        error: (error as Error).message,
      }),
    );
  }

  return [
    {
      name: getUriPathBasename(filepath),
      description: `Deleted file: ${filepath}`,
      content: `File "${filepath}" has been deleted.\n\nPath: ${resolvedFileUri}`,
      uri: { type: "file", value: resolvedFileUri },
    },
  ];
};
