import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const taskTool: Tool = {
  type: "function",
  displayTitle: t("task"),
  wouldLikeTo: t("wouldLikeToRunTask"),
  isCurrently: t("isRunningTask"),
  hasAlready: t("hasRunTask"),
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.Task,
    description: `Run a bounded unit of work in an isolated child agent (fresh context) and get back its summary and files touched. Not for a single file read (use builtin_read_file / builtin_glob).
Profiles: explore (default, read-only Q&A/search), review (read-only, diff focus), general (full tools except task/ask_user), rust-review, rust-borrowck (read-only specialists), rust-architect (design first, no code until builtin_plan).
agent="name" uses a custom type from .knoxcoder/agents/<name>.md.
children=[{prompt, profile?, agent?, path?, isolate?}] (cap 8) runs several in parallel; with more than one child, writers run in isolated git worktrees and their patches are merged back in turn (overlaps show as a merge CONFLICT, patch kept on disk).
explores=[{prompt, path}] (cap 3) searches disjoint trees concurrently.`,
    parameters: {
      type: "object",
      required: [],
      properties: {
        prompt: {
          type: "string",
          description: "Complete instructions for the child agent.",
        },
        profile: {
          type: "string",
          enum: [
            "explore",
            "general",
            "review",
            "rust-review",
            "rust-borrowck",
            "rust-architect",
          ],
          description:
            "explore (default), review, general, or rust-review / rust-borrowck / rust-architect.",
        },
        max_steps: {
          type: "number",
          description:
            "Max child tool rounds (explore/review default 12, general 20, cap 40; systems: explore 40, general 80, cap 200).",
        },
        agent: {
          type: "string",
          description: "Name of a user-defined agent in .knoxcoder/agents/<name>.md.",
        },
        isolate: {
          type: "boolean",
          description: "Run in an isolated git worktree and merge the patch back.",
        },
        concurrency: {
          type: "number",
          description: "Max children in flight (default 3, cap 8).",
        },
        children: {
          type: "array",
          description:
            "Parallel children (cap 8). Each: { prompt, profile?, agent?, path?, isolate? }.",
          items: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              profile: { type: "string" },
              agent: { type: "string" },
              path: { type: "string" },
              isolate: { type: "boolean" },
            },
          },
        },
        explores: {
          type: "array",
          description:
            "Optional parallel explore children (cap 3). Each item is { prompt, path? } for a disjoint subtree.",
          items: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              path: { type: "string" },
            },
          },
        },
      },
    },
  },
};
