import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const editFileTool: Tool = {
  type: "function",
  displayTitle: t("editFile"),
  wouldLikeTo: t("wouldLikeToEditFile"),
  isCurrently: t("isEditingFile"),
  hasAlready: t("hasEditedFile"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.EditFile,
    description: `Surgically replace exact text in an existing file (Claude Edit / StrReplace semantics).

Rules:
- Read the file first so old_string matches exactly, including whitespace and indentation.
- old_string must uniquely identify the edit. If it matches 0 times the call fails. If it matches more than once the call fails unless replace_all is true.
- Prefer this over rewriting the whole file or using the terminal (no cat/echo/heredoc writes).
- For a brand-new file use builtin_create_new_file. For a full-file rewrite use builtin_write_file. For several files or hunks in one call use builtin_apply_patch.`,
    parameters: {
      type: "object",
      required: ["filepath", "old_string", "new_string"],
      properties: {
        filepath: {
          type: "string",
          description:
            "Workspace-relative path of the existing file to edit (e.g. 'src/app.ts').",
        },
        old_string: {
          type: "string",
          description:
            "Exact text to find. Must be unique in the file unless replace_all is true.",
        },
        new_string: {
          type: "string",
          description: "Replacement text. May be empty to delete old_string.",
        },
        replace_all: {
          type: "boolean",
          description:
            "If true, replace every occurrence of old_string. Default false (require a unique match).",
        },
      },
    },
  },
};
