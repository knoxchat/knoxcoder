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
    description: `Spawn an isolated child agent and get a summary back (Claude Agent / OpenCode Task).

Use for a bounded unit of work you can describe in one prompt — codebase Q&A, a review, or a parallel slice of implementation. The child starts with a fresh message list (no parent transcript). You receive only the final summary and files touched.

Profiles:
- explore (default): read-only tools, fast Q&A / search.
- review: read-only + diff focus.
- general: full tools except nested task / ask_user.
- rust-review: read-only adversarial Rust review (unwrap, clones, SAFETY, tests, semver).
- rust-borrowck: read-only ownership/borrowck specialist (no sprinkle-clone).
- rust-architect: ADR first (data layout, ownership, error type) — no code until builtin_plan.

Do not use for a single file read — call builtin_read_file / builtin_glob instead.

Fan-out: pass explores=[{prompt, path}, ...] (cap 3, explore profile) to search disjoint trees concurrently (mm/ vs fs/). Jobs panel lists in-flight children.`,
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
