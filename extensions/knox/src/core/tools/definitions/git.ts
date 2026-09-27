import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const gitStatusTool: Tool = {
  type: "function",
  displayTitle: t("gitStatus"),
  wouldLikeTo: t("wouldLikeToGitStatus"),
  isCurrently: t("isGettingGitStatus"),
  hasAlready: t("hasGotGitStatus"),
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  function: {
    name: BuiltInToolNames.GitStatus,
    description:
      "Show git status (branch + porcelain). Prefer this over shell `git status`.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const gitDiffTool: Tool = {
  type: "function",
  displayTitle: t("gitDiff"),
  wouldLikeTo: t("wouldLikeToGitDiff"),
  isCurrently: t("isGettingGitDiff"),
  hasAlready: t("hasGotGitDiff"),
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  function: {
    name: BuiltInToolNames.GitDiff,
    description:
      "Show git diff. staged=true for index only; omit for unstaged (or both if both=true). Prefer this over shell `git diff`.",
    parameters: {
      type: "object",
      properties: {
        staged: {
          type: "boolean",
          description: "If true, only `git diff --cached`.",
        },
        both: {
          type: "boolean",
          description: "If true, include unstaged and staged diffs.",
        },
        path: {
          type: "string",
          description: "Optional pathspec to limit the diff.",
        },
      },
    },
  },
};

export const gitLogTool: Tool = {
  type: "function",
  displayTitle: t("gitLog"),
  wouldLikeTo: t("wouldLikeToGitLog"),
  isCurrently: t("isGettingGitLog"),
  hasAlready: t("hasGotGitLog"),
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  function: {
    name: BuiltInToolNames.GitLog,
    description:
      "Show recent git commits (oneline). search= pickaxe `git log -S` (commits that added/removed that string). regex= `git log -G`. Prefer this over shell `git log`.",
    parameters: {
      type: "object",
      properties: {
        max_count: {
          type: "number",
          description: "Number of commits (default 20, max 50).",
        },
        path: {
          type: "string",
          description: "Optional pathspec.",
        },
        search: {
          type: "string",
          description: "Pickaxe string (`git log -S`). Commits that changed the number of occurrences of this string.",
        },
        regex: {
          type: "string",
          description: "Pickaxe regex (`git log -G`).",
        },
        all: {
          type: "boolean",
          description: "If true, pass `--all`.",
        },
      },
    },
  },
};

export const gitBlameTool: Tool = {
  type: "function",
  displayTitle: t("gitBlame"),
  wouldLikeTo: t("wouldLikeToGitBlame"),
  isCurrently: t("isGettingGitBlame"),
  hasAlready: t("hasGotGitBlame"),
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  function: {
    name: BuiltInToolNames.GitBlame,
    description:
      "Show git blame for a file (who last touched each line). Pass start_line/end_line on large files (default cap 200 lines). Prefer this over shell `git blame`.",
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description: "File to blame (workspace-relative).",
        },
        start_line: {
          type: "number",
          description: "1-based start line (`git blame -L`).",
        },
        end_line: {
          type: "number",
          description: "1-based end line.",
        },
        max_lines: {
          type: "number",
          description: "Cap blame lines in the tool result (default 200, max 1000).",
        },
        rev: {
          type: "string",
          description: "Optional revision to blame (default working tree / HEAD).",
        },
      },
    },
  },
};

export const gitCommitTool: Tool = {
  type: "function",
  displayTitle: t("gitCommit"),
  wouldLikeTo: t("wouldLikeToGitCommit"),
  isCurrently: t("isGitCommitting"),
  hasAlready: t("hasGitCommitted"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.GitCommit,
    description: `Create a git commit from the current index (staged files).

Does not push, force, amend, or rebase. Prefer this over shell \`git commit\`.
If nothing is staged, set add_all=true to \`git add -A\` first, or add specific paths.`,
    parameters: {
      type: "object",
      required: ["message"],
      properties: {
        message: {
          type: "string",
          description: "Commit message.",
        },
        add_all: {
          type: "boolean",
          description: "If true, run `git add -A` before commit.",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional paths to `git add` before commit.",
        },
      },
    },
  },
};

export const gitBisectTool: Tool = {
  type: "function",
  displayTitle: t("gitBisect"),
  wouldLikeTo: t("wouldLikeToGitBisect"),
  isCurrently: t("isGitBisecting"),
  hasAlready: t("hasGitBisected"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.GitBisect,
    description: `Git bisect loop for regressions. Prefer this over shell \`git bisect\` — it always \`git bisect reset\` on abort and never force-pushes.

Actions:
- start: begin (optional bad + good revs; default bad=HEAD).
- good / bad / skip: mark the current checkout (optional rev).
- run: execute command as the oracle (exit 0 = good, else bad). loop=true (default) continues until first bad or max_rounds. Use the workspace verifyCommand when it is the compile oracle.
- status: bisect log + visualize.
- reset: leave bisect (always do this when done).`,
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["start", "good", "bad", "skip", "run", "status", "reset"],
          description: "Bisect step.",
        },
        good: {
          type: "string",
          description: "Known-good rev for start.",
        },
        bad: {
          type: "string",
          description: "Known-bad rev for start (default HEAD).",
        },
        rev: {
          type: "string",
          description: "Rev to mark for good/bad/skip.",
        },
        command: {
          type: "string",
          description: "Oracle for action=run. Exit 0 = good. Not git push / force / reset --hard.",
        },
        loop: {
          type: "boolean",
          description: "If true (default), keep marking until first bad or max_rounds.",
        },
        max_rounds: {
          type: "number",
          description: "Cap for loop (default 32).",
        },
      },
    },
  },
};
