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
    description: `Surgically replace exact text in an existing file (Claude Edit / Pi edit / StrReplace semantics).

Rules:
- Read the file first. old_string/oldText should uniquely identify the edit.
- Matching is against the original file. Trailing whitespace, smart quotes, unicode dashes, indent, and markdown line-wrapping mismatches are recovered when the block is still unique. oldText/old_str/search aliases and a line-array old_string are accepted. A truncated trailing edits[] entry is skipped.
- If it matches 0 times the call fails. If it matches more than once the call fails unless replace_all is true.
- Several disjoint replacements in one file: edits:[{old_string,new_string}]. Do not emit overlapping or nested edits; merge nearby changes into one edit.
- Prefer this over rewriting the whole file or using the terminal (no cat/echo/heredoc writes).
- For a new file or a full rewrite use builtin_write_file. For several files in one call use builtin_apply_patch.`,
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description:
            "Workspace-relative path of the existing file to edit (e.g. 'src/app.ts').",
        },
        old_string: {
          type: "string",
          description:
            "Exact text to find (alias: oldText). Must be unique in the file unless replace_all is true.",
        },
        new_string: {
          type: "string",
          description: "Replacement text (alias: newText). Empty or omitted deletes old_string.",
        },
        replace_all: {
          type: "boolean",
          description:
            "If true, replace every occurrence of old_string. Default false (require a unique match).",
        },
        edits: {
          type: "array",
          description:
            "Several edits to one file, applied in order and atomically. Use instead of old_string/new_string.",
          items: {
            type: "object",
            required: ["old_string", "new_string"],
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" },
            },
          },
        },
      },
    },
  },
};
