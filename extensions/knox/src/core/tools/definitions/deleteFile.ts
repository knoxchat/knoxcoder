import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const deleteFileTool: Tool = {
  type: "function",
  displayTitle: t("deleteFile"),
  wouldLikeTo: t("wouldLikeToDeleteFile"),
  isCurrently: t("isDeletingFile"),
  hasAlready: t("hasDeletedFile"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.DeleteFile,
    description: `Delete one workspace file.

File only: never a directory, never recursive. Workspace-relative path. Secret files (.env, keys, certs) are refused. Prefer this over rm/unlink in the terminal so permissions, review mode, and the turn checkpoint still apply.

Already-missing files succeed (idempotent).`,
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description:
            "Workspace-relative file to delete (e.g. 'src/old.ts'). Directories, '..', and absolute paths are refused.",
        },
      },
    },
  },
};
