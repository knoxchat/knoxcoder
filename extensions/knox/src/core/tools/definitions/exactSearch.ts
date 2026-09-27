import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const exactSearchTool: Tool = {
  type: "function",
  displayTitle: t("exactSearch"),
  wouldLikeTo: t("wouldLikeToSearch"),
  isCurrently: t("isSearching"),
  hasAlready: t("hasSearched"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ExactSearch,
    description: `Search file contents with bundled ripgrep 15.2.0 (Grep).

Output includes file paths and line numbers in content mode. Binary files are skipped. Common junk dirs (.git, node_modules) are ignored by ripgrep defaults. Long lines are truncated.

On large trees (Linux kernel, QEMU), ALWAYS pass path and fileType. A workspace-wide search for copy_to_user is a random slice. Prefer path: "mm/" and fileType: "c" (also asm, kconfig, make, dts). Default maxResults is 50 (200 on a systems/kernel workspace). If the result says truncated; pass maxResults/path/fileType.

Features:
- Literal substring match by default (ripgrep -F). Parentheses, dots, pipes, and other regex metacharacters are matched exactly — paste code snippets as-is
- Case-insensitive by default (set caseSensitive for exact case)
- Regular expressions only when you opt in: pcre2 for lookaround / backreferences, or fixedStrings=false for Rust regex
- Workspace-relative path (directory or file) — e.g. path="mm" not the whole tree
- Path globs (fileGlob) and excludes (excludeGlob)
- File types (fileType: c, asm, kconfig, make, ts, rust, py — tsx maps to ripgrep's ts type)
- Context lines (contextLines, or beforeContext / afterContext)
- Head limit (maxResults, default 50 / 200 systems) and offset for pagination
- outputMode: content (default) | files_with_matches | count
- multiline, hidden, follow

Examples:
- Simple: query="function handleClick"
- Code snippet: query="fn ui(&mut self,"
- Path: query="Game::new" path="src"
- Kernel: query="copy_to_user" path="mm" fileType="c"
- Glob: query="useState" fileGlob="src/**/*.tsx"
- Files only: query="TODO" outputMode="files_with_matches"
- More context: query="TODO" contextLines=3 maxResults=20
- Regex: query="copy_to_user|copy_from_user" pcre2=true`,
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "Literal substring to find (default). Metacharacters such as ( ) . * + ? | [ ] { } are matched exactly. Set pcre2 or fixedStrings=false only when you want a regular expression.",
        },
        path: {
          type: "string",
          description:
            "Directory or file to search, relative to the workspace root (e.g. 'mm', 'src', 'tetris/src/main.rs'). On kernel/QEMU trees prefer a subsystem path instead of the whole workspace.",
        },
        fileType: {
          type: "string",
          description:
            "Filter by ripgrep --type (e.g. 'c', 'asm', 'kconfig', 'make', 'ts', 'rust', 'py'). Unknown names become a *.ext glob. 'tsx'/'jsx' map to ts/js. Prefer fileType: c on kernel trees.",
        },
        fileGlob: {
          type: "string",
          description:
            "Filter by file glob pattern (e.g., '*.test.ts', 'src/**/*.tsx'). Uses ripgrep's --glob flag.",
        },
        excludeGlob: {
          type: "string",
          description:
            "Exclude glob (e.g. '*.lock', 'dist/**'). A leading ! is added if missing.",
        },
        contextLines: {
          type: "number",
          description:
            "Context lines before and after each match (content mode). Default is 2. Ignored when beforeContext or afterContext is set.",
        },
        beforeContext: {
          type: "number",
          description: "Context lines before each match (content mode).",
        },
        afterContext: {
          type: "number",
          description: "Context lines after each match (content mode).",
        },
        maxResults: {
          type: "number",
          description:
            "Maximum number of matches to return. Default is 50 (200 on systems/kernel workspaces). Use -1 for unlimited. Truncated results tell you to pass maxResults/path/fileType.",
        },
        offset: {
          type: "number",
          description:
            "Skip this many matches before applying maxResults (pagination).",
        },
        caseSensitive: {
          type: "boolean",
          description:
            "Enable case-sensitive search. Default is false (case-insensitive).",
        },
        wholeWord: {
          type: "boolean",
          description: "Match whole words only. Default is false.",
        },
        multiline: {
          type: "boolean",
          description:
            "Allow matches to span lines (ripgrep -U --multiline-dotall).",
        },
        hidden: {
          type: "boolean",
          description:
            "Search hidden files (still respects gitignore unless the pattern forces otherwise).",
        },
        follow: {
          type: "boolean",
          description: "Follow symlinks.",
        },
        fixedStrings: {
          type: "boolean",
          description:
            "Treat query as a literal string (-F). Default is true. Set false to use Rust regex (without PCRE2).",
        },
        pcre2: {
          type: "boolean",
          description:
            "Use PCRE2 regex (-P) instead of a literal match. For lookaround and backreferences. The bundled binary includes +pcre2.",
        },
        outputMode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description:
            "content: matching lines with context (default). files_with_matches: paths only. count: per-file match counts.",
        },
      },
    },
  },
};
