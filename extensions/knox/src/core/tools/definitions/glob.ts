import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const globTool: Tool = {
  type: "function",
  displayTitle: t("glob"),
  wouldLikeTo: t("wouldLikeToGlob"),
  isCurrently: t("isGlobbing"),
  hasAlready: t("hasGlobbed"),
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Glob,
    description: `Find files by glob pattern (Claude/OpenCode Glob).

Returns a sorted list of workspace-relative paths. Skips node_modules, .git, and other junk. Honors \`.gitignore\` / \`.knoxignore\`. Skips \`build/\` unless it looks like an in-tree QEMU/CMake build (Makefile / config-host.mak). Object files (\`*.o\` / \`*.ko\`) and vmlinux are omitted unless the pattern asks for them.

On huge trees the result is truncated explicitly (result cap or walk cap) — pass \`path\` via target_directory (e.g. \`mm/\`) or raise max_results. Walk cap is 100k entries.

Examples:
- All TypeScript files: pattern="**/*.ts"
- Kernel C under mm: pattern="**/*.c", target_directory="mm"
- Tests under src: pattern="src/**/*.test.ts"
- Bare "*.json" matches at any depth

Prefer this over listing a whole tree when you know the filename pattern. Use builtin_view_subdirectory for a directory tree, builtin_exact_search to search file contents.`,
    parameters: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob to match, e.g. '**/*.ts', 'src/**/*.tsx', '*.md'. Bare filename globs match at any depth.",
        },
        target_directory: {
          type: "string",
          description:
            "Workspace-relative directory to search from. Default: workspace root ('.').",
        },
        max_results: {
          type: "number",
          description: "Maximum paths to return. Default: 200.",
        },
      },
    },
  },
};
