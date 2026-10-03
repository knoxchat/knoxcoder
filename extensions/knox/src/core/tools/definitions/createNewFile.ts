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
    description: `Create a file that does not exist yet (parent directories are created; existing files are not overwritten unless overwrite=true). For changes to an existing file use builtin_edit_file; for a full rewrite builtin_write_file. Never write files through the terminal.
Emit filepath BEFORE contents. Keep contents under ~200 lines: create a skeleton first, then extend with builtin_edit_file or builtin_apply_patch (a very long call can be cut off and lose its arguments).`,
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
