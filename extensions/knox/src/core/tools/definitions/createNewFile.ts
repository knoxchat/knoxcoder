import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const createNewFileTool: Tool = {
  type: "function",
  displayTitle: t("createNewFile"),
  wouldLikeTo: t("wouldLikeToCreateFile"),
  isCurrently: t("isCreatingFile"),
  hasAlready: t("hasCreatedFile"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.CreateNewFile,
    description: `Create or overwrite a file (same as builtin_write_file). Prefer builtin_write_file for new files and full rewrites, builtin_edit_file for targeted changes. Never write files through the terminal.
Emit filepath BEFORE contents. Keep contents under ~200 lines: create a skeleton first, then extend with builtin_edit_file.`,
    parameters: {
      type: "object",
      required: ["filepath", "contents"],
      properties: {
        filepath: {
          type: "string",
          description: "New file path, workspace-relative (e.g. 'src/components/Button.tsx').",
        },
        contents: { type: "string", description: "File contents (may be empty)." },
        template: {
          type: "string",
          description:
            "Optional boilerplate name (e.g. rust-module, python-class, markdown); omit to use contents.",
        },
        openAfterCreate: { type: "boolean", description: "Open in the editor (default true)." },
        createDirectories: { type: "boolean", description: "Create parent dirs (default true)." },
        overwrite: { type: "boolean", description: "Replace an existing file (default false)." },
        encoding: {
          type: "string",
          enum: ["utf8", "utf-8", "ascii", "base64", "binary"],
          description: "Default utf-8.",
        },
        language: { type: "string", description: "Language id; auto-detected from the extension." },
      },
    },
  },
};
