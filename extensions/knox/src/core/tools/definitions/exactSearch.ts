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
    description: `Search file contents with ripgrep. Literal, case-insensitive match by default (code snippets can be pasted as-is); set pcre2=true or fixedStrings=false for regex. Output is grouped by file with line numbers; binary and ignored files are skipped, long lines truncated. Honors \`.gitignore\` and \`.knoxignore\` (including nested \`.knoxignore\`).
On large trees (kernel, QEMU) always pass path and fileType (e.g. path="mm", fileType="c"). Default maxResults is 50 (200 on systems workspaces); if truncated, narrow with path/fileType or page with offset.
Examples: query="Game::new" path="src"; query="useState" fileGlob="src/**/*.tsx"; query="TODO" outputMode="files_with_matches"; query="a|b" pcre2=true.`,
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Text to find. Literal unless pcre2 or fixedStrings=false.",
        },
        path: {
          type: "string",
          description: "Directory or file to search, workspace-relative (e.g. 'mm', 'src').",
        },
        fileType: {
          type: "string",
          description: "ripgrep type (c, asm, kconfig, make, ts, rust, py). Unknown names become *.ext.",
        },
        fileGlob: { type: "string", description: "Only files matching this glob." },
        excludeGlob: { type: "string", description: "Skip files matching this glob." },
        contextLines: {
          type: "number",
          description: "Lines of context around each match (default 2).",
        },
        beforeContext: { type: "number", description: "Context lines before a match." },
        afterContext: { type: "number", description: "Context lines after a match." },
        maxResults: {
          type: "number",
          description: "Max matches (default 50, 200 on systems; -1 unlimited).",
        },
        offset: { type: "number", description: "Skip this many matches (paging)." },
        caseSensitive: { type: "boolean", description: "Default false." },
        wholeWord: { type: "boolean", description: "Whole words only." },
        multiline: { type: "boolean", description: "Let matches span lines." },
        hidden: { type: "boolean", description: "Search hidden files." },
        follow: { type: "boolean", description: "Follow symlinks." },
        fixedStrings: {
          type: "boolean",
          description: "Literal match (default true). False = Rust regex.",
        },
        pcre2: {
          type: "boolean",
          description: "PCRE2 regex (lookaround, backreferences).",
        },
        outputMode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description: "content (default), files_with_matches, or count.",
        },
      },
    },
  },
};
