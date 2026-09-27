import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const writeFileTool: Tool = {
  type: "function",
  displayTitle: t("writeFile"),
  wouldLikeTo: t("wouldLikeToWriteFile"),
  isCurrently: t("isWritingFile"),
  hasAlready: t("hasWrittenFile"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.WriteFile,
    description: `Create a file or overwrite it with the full new contents.

Use this for a complete rewrite of an existing file, or to create a file when you already have the entire contents.
Prefer builtin_edit_file for small, targeted changes.
Prefer builtin_apply_patch for multi-file or multi-hunk edits.
Prefer builtin_create_new_file when the file must not already exist.
Never use the terminal (cat, echo, heredoc) to write files.`,
    parameters: {
      type: "object",
      required: ["filepath", "contents"],
      properties: {
        filepath: {
          type: "string",
          description:
            "Workspace-relative path to create or overwrite (e.g. 'src/app.ts'). Parent directories are created as needed.",
        },
        contents: {
          type: "string",
          description: "Full file contents to write. Use an empty string for a blank file.",
        },
        openAfterWrite: {
          type: "boolean",
          description: "Open the file in the editor after writing. Default: true.",
        },
      },
    },
  },
};
