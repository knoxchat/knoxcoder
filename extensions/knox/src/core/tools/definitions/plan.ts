import { Tool } from "../..";
import { t } from "../../i18n/index.js";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const planTool: Tool = {
  type: "function",
  displayTitle: t("plan"),
  wouldLikeTo: t("wouldLikeToPlan"),
  isCurrently: t("isUpdatingPlan"),
  hasAlready: t("hasUpdatedPlan"),
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Plan,
    description: `Durable task plan for this chat — the work order. Re-injected every turn and kept through compaction.
If no plan exists, call create (steps optional: omit them and the tool drafts concrete steps from the user request). If a plan already exists, keep working it (complete/skip/add); create without new steps returns the current plan instead of wiping it. create with new steps replaces the work order.
complete/skip without step_id targets the current [*] step. Never ask the user to pick steps, toolchain versions, or to "say go" — pick defaults and execute.
Not for a one-file edit.`,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "create",
            "add",
            "update",
            "complete",
            "skip",
            "set_current",
            "list",
            "clear",
          ],
          description:
            "Optional. Omit to infer: no plan → create; existing plan + steps → add; existing plan + step_id → complete; else list.",
        },
        title: {
          type: "string",
          description:
            "Plan title on create, or a single new step title on add. Also used to match a step for complete/skip/update.",
        },
        goal: {
          type: "string",
          description:
            "User request to draft steps from when steps are omitted. Defaults to the current user message.",
        },
        steps: {
          type: "array",
          description:
            "Step titles. Optional on create — omit to auto-draft. Strings, numbered text, or {title} objects.",
          items: {
            type: "string",
          },
        },
        step_id: {
          type: "string",
          description:
            "Step id from list, or 1-based index. Optional: complete/skip/set_current default to the current [*] step.",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "done", "skipped"],
          description: "[update] New status for the step.",
        },
        new_title: {
          type: "string",
          description: "[update] Rename the step.",
        },
      },
    },
  },
};
