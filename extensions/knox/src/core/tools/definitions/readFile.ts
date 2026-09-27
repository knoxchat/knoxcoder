import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const readFileTool: Tool = {
  type: "function",
  displayTitle: t("readFile"),
  wouldLikeTo: t("wouldLikeToReadFile"),
  isCurrently: t("isReadingFile"),
  hasAlready: t("hasReadFile"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ReadFile,
    description: "Read an existing file. For a line range, pass startLine and endLine (1-based, inclusive) on this tool — there is no read_file_line tool. filepath is workspace-relative (src/main.rs). Large files return line count plus the first and last 40 lines; pass startLine/endLine for a range. Refuses binaries (*.o, vmlinux, ELF).",
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description:
            "The file path to read, relative to the workspace root (not a URI or absolute path)",
        },
        startLine: {
          type: "number",
          description: "Optional starting line number (1-based, inclusive) to read from. Use for partial file reads. If not provided, reads from the beginning.",
        },
        endLine: {
          type: "number",
          description: "Optional ending line number (1-based, inclusive) to read to. Use for partial file reads. If not provided, reads to the end.",
        },
        includeMetadata: {
          type: "boolean",
          description: "Whether to include file metadata (size, line count, language, encoding, last modified). Default: false. Set to true when you need comprehensive file information.",
        },
        includeLineNumbers: {
          type: "boolean",
          description: "Whether to prepend line numbers to each line in the output. Default: false. Useful for referencing specific lines in discussions.",
        },
        encoding: {
          type: "string",
          description: "Optional encoding to use when reading the file (e.g., 'utf8', 'ascii', 'base64'). Auto-detected if not provided.",
        },
        maxBytes: {
          type: "number",
          description: "Maximum bytes to read from the file. Default: 100000. Over-budget reads return first/last 40 lines plus startLine/endLine instructions instead of a truncated middle.",
        },
        showSyntaxInfo: {
          type: "boolean",
          description: "Whether to include syntax/language information and file statistics. Default: false. Useful for understanding file structure.",
        },
      },
    },
  },
};
