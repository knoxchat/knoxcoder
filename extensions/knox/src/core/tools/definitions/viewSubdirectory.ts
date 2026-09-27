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
    description: `List a directory tree with depth limits, ignore globs, and stable (sorted) formatting.

Defaults:
- Ignores node_modules, .git, dist, build, and other junk (excludePatterns)
- Honors \`.gitignore\` / \`.knoxignore\`
- Caps output at maxFiles (default 1000, or the Settings value)
- Sorts by name unless sortBy is set
- Tree format is stable and parseable; use outputFormat="flat" for a simple path list

Prefer builtin_glob when you only need files matching a pattern.

Examples:
- Shallow listing: directory_path="src", depth=1
- TypeScript only: directory_path="src", fileTypes=["ts", "tsx"], depth=3
- Config files: directory_path=".", pattern="*.config.*", depth=2`,
    parameters: {
      type: "object",
      required: ["directory_path"],
      properties: {
        directory_path: {
          type: "string",
          description:
            "The subdirectory path to view, relative to the workspace root directory. Use '.' for workspace root.",
        },
        depth: {
          type: "number",
          description:
            "Maximum depth of directory traversal. Use 1 for shallow listing (immediate children only), -1 for unlimited depth. Default: -1 (full recursive).",
        },
        fileTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by file extensions (e.g., ['ts', 'tsx', 'js']). Only files with these extensions will be included.",
        },
        pattern: {
          type: "string",
          description:
            "Glob pattern to match files (e.g., '*.test.*', 'index.*', '**/*.config.*'). Supports standard glob syntax.",
        },
        excludePatterns: {
          type: "array",
          items: { type: "string" },
          description:
            "Glob patterns to exclude (e.g., ['node_modules', 'dist', '.git', '*.min.js']). Default excludes common non-essential directories.",
        },
        includeHidden: {
          type: "boolean",
          description:
            "Include hidden files and directories (those starting with '.'). Default: false.",
        },
        includeStats: {
          type: "boolean",
          description:
            "Include file statistics (size, line count for text files, last modified time). Default: false.",
        },
        includeGitStatus: {
          type: "boolean",
          description:
            "Include git status for each file (modified, untracked, staged, etc.). Requires git repository. Default: false.",
        },
        sortBy: {
          type: "string",
          enum: ["name", "size", "modified", "type"],
          description:
            "Sort files by: 'name' (alphabetical), 'size' (largest first), 'modified' (newest first), 'type' (by extension). Default: 'name'.",
        },
        maxFiles: {
          type: "number",
          description:
            "Maximum number of files to return. Use to limit output for large directories. Default: 1000, or the Agent Settings value if configured.",
        },
        showSummary: {
          type: "boolean",
          description:
            "Include summary statistics: file count by type, total size, directory count, etc. Default: true.",
        },
        outputFormat: {
          type: "string",
          enum: ["tree", "flat", "detailed"],
          description:
            "Output format: 'tree' (visual tree structure), 'flat' (simple list), 'detailed' (table with metadata). Default: 'tree'.",
        },
      },
    },
  },
};
