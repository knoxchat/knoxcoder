import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const viewSubdirectoryTool: Tool = {
  type: "function",
  displayTitle: t("viewSubdirectory"),
  wouldLikeTo: t("wouldLikeToViewDir"),
  isCurrently: t("isGettingDir"),
  hasAlready: t("hasViewedDir"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ViewSubdirectory,
    description: `List a directory tree (sorted, depth-limited). Ignores node_modules, .git, dist, build and honors .gitignore/.knoxignore; capped at maxFiles (default 1000). Use builtin_glob when you only need files matching a pattern.
Examples: directory_path="src", depth=1; directory_path="src", fileTypes=["ts","tsx"], depth=3.`,
    parameters: {
      type: "object",
      required: [],
      properties: {
        directory_path: {
          type: "string",
          description: "Directory relative to the workspace root ('.' for the root; defaults to '.').",
        },
        depth: {
          type: "number",
          description: "Max depth; 1 = immediate children, -1 = unlimited (default).",
        },
        fileTypes: {
          type: "array",
          items: { type: "string" },
          description: "Only these extensions, e.g. ['ts','tsx'].",
        },
        pattern: { type: "string", description: "Glob for files to include." },
        excludePatterns: {
          type: "array",
          items: { type: "string" },
          description: "Globs to exclude (replaces the default junk list).",
        },
        includeHidden: { type: "boolean", description: "Include dotfiles." },
        includeStats: { type: "boolean", description: "Add size, line count, mtime." },
        includeGitStatus: { type: "boolean", description: "Add git status per file." },
        sortBy: {
          type: "string",
          enum: ["name", "size", "modified", "type"],
          description: "Sort order (default name).",
        },
        maxFiles: { type: "number", description: "Max files returned (default 1000)." },
        showSummary: { type: "boolean", description: "Add counts by type (default true)." },
        outputFormat: {
          type: "string",
          enum: ["tree", "flat", "detailed"],
          description: "tree (default), flat, or detailed table.",
        },
      },
    },
  },
};
