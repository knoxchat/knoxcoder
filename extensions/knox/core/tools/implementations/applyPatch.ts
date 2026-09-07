import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { t } from "../../i18n/index.js";
import { ToolCallError, ToolCallErrorCode } from "../errors";
import {
  applyHunksToContent,
  formatOpsSummary,
  formatUnifiedDiffPreview,
  parseApplyPatch,
  type PatchOp,
} from "../applyPatchFormat";

import { ToolImpl } from ".";
import { evaluateRustEditGuard } from "../rustEditGuard";

interface PlannedChange {
  path: string;
  uri: string;
  kind: "add" | "delete" | "update" | "rename";
  existed: boolean;
  before: string | null;
  after: string | null;
  moveTo?: string;
  moveToUri?: string;
}

async function resolvePath(
  filepath: string,
  ide: Parameters<ToolImpl>[1]["ide"],
): Promise<string> {
  return inferResolvedUriFromRelativePath(filepath, ide);
}

async function planOps(
  ops: PatchOp[],
  ide: Parameters<ToolImpl>[1]["ide"],
): Promise<PlannedChange[]> {
  const planned: PlannedChange[] = [];

  for (const op of ops) {
    const uri = await resolvePath(op.path, ide);
    const existed = await ide.fileExists(uri);

    if (op.type === "add") {
      if (existed) {
        throw new Error(t("patchAddFileExists", { filepath: op.path }));
      }
      planned.push({
        path: op.path,
        uri,
        kind: "add",
        existed: false,
        before: null,
        after: op.content,
      });
      continue;
    }

    if (op.type === "delete") {
      if (!existed) {
        throw new Error(t("fileDoesNotExist", { filepath: op.path }));
      }
      const before = await ide.readFile(uri);
      planned.push({
        path: op.path,
        uri,
        kind: "delete",
        existed: true,
        before,
        after: null,
      });
      continue;
    }

    if (!existed) {
      throw new Error(t("fileDoesNotExist", { filepath: op.path }));
    }
    const before = await ide.readFile(uri);
    const after = applyHunksToContent(before, op.hunks, op.path);

    if (op.moveTo) {
      const moveToUri = await resolvePath(op.moveTo, ide);
      const destExists = await ide.fileExists(moveToUri);
      if (destExists) {
        throw new Error(t("patchMoveTargetExists", { filepath: op.moveTo }));
      }
      planned.push({
        path: op.path,
        uri,
        kind: "rename",
        existed: true,
        before,
        after,
        moveTo: op.moveTo,
        moveToUri,
      });
    } else {
      if (before === after) {
        throw new Error(t("patchNoChange", { filepath: op.path }));
      }
      planned.push({
        path: op.path,
        uri,
        kind: "update",
        existed: true,
        before,
        after,
      });
    }
  }

  return planned;
}

async function rollbackWritten(
  written: PlannedChange[],
  ide: Parameters<ToolImpl>[1]["ide"],
): Promise<void> {
  for (const change of [...written].reverse()) {
    try {
      if (change.kind === "add" && typeof ide.removeFile === "function") {
        await ide.removeFile(change.uri);
      } else if (change.kind === "rename") {
        if (change.moveToUri && typeof ide.removeFile === "function") {
          try {
            await ide.removeFile(change.moveToUri);
          } catch {
            // dest may not have been written
          }
        }
        if (change.before != null) {
          await ide.writeFile(change.uri, change.before);
        }
      } else if (change.before != null) {
        await ide.writeFile(change.uri, change.before);
      }
    } catch {
      // Best-effort rollback
    }
  }
}

export const applyPatchImpl: ToolImpl = async (args, extras) => {
  const raw =
    typeof args.patch === "string"
      ? args.patch
      : typeof args.diff === "string"
        ? args.diff
        : "";
  if (!raw.trim()) {
    throw new Error(t("missingRequiredParam", { param: "patch" }));
  }

  const ops = parseApplyPatch(raw);
  const planned = await planOps(ops, extras.ide);
  const rustWarnings: Awaited<ReturnType<ToolImpl>> = [];
  for (const change of planned) {
    const guard = evaluateRustEditGuard({
      filePath: change.moveTo ?? change.path,
      oldText: change.before ?? "",
      newText: change.after ?? "",
    });
    if (guard.block) {
      return [guard.block];
    }
    rustWarnings.push(...guard.warnings);
  }

  if (extras.abortSignal?.aborted) {
    throw new ToolCallError({
      code: ToolCallErrorCode.CANCELLED,
      message: "Apply patch cancelled",
      toolName: extras.tool.function.name,
      retryable: false,
    });
  }

  const written: PlannedChange[] = [];
  try {
    for (const change of planned) {
      if (extras.abortSignal?.aborted) {
        throw new ToolCallError({
          code: ToolCallErrorCode.CANCELLED,
          message: "Apply patch cancelled",
          toolName: extras.tool.function.name,
          retryable: false,
        });
      }

      if (change.kind === "delete") {
        if (typeof extras.ide.removeFile !== "function") {
          throw new Error(t("patchDeleteUnsupported", { filepath: change.path }));
        }
        await extras.ide.removeFile(change.uri);
      } else if (change.kind === "rename") {
        if (change.after == null || !change.moveToUri) {
          throw new Error(t("patchNoChange", { filepath: change.path }));
        }
        await extras.ide.writeFile(change.moveToUri, change.after);
        if (typeof extras.ide.removeFile === "function") {
          await extras.ide.removeFile(change.uri);
        }
      } else if (change.after != null) {
        await extras.ide.writeFile(change.uri, change.after);
      }
      written.push(change);
    }
  } catch (error) {
    await rollbackWritten(written, extras.ide);
    throw error;
  }

  const summary = formatOpsSummary(ops);
  const diff = formatUnifiedDiffPreview(planned);
  const files = planned
    .map((c) => (c.moveTo ? `${c.path} -> ${c.moveTo}` : c.path))
    .join(", ");

  return [
    {
      name: "apply_patch",
      description: `Applied patch (${planned.length} file${planned.length === 1 ? "" : "s"}): ${files}`,
      content: `Applied patch atomically.\n\n${summary}\n\n${diff}`,
    },
    ...rustWarnings,
  ];
};
