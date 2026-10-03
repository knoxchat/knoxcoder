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
    description: `Durable task plan for this chat; re-injected every turn and kept through context compaction. Actions: create (title + steps), add, update, complete, skip, set_current, list, clear.
Call set_current when you start a step and complete as soon as it succeeds. Keep steps concrete. Not for a one-file edit.`,
    parameters: {
      type: "object",
      required: ["action"],
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
          description: "Plan operation.",
        },
        title: {
          type: "string",
          description:
            "[create] Plan title. [add] Title of a single new step when steps is omitted.",
        },
        steps: {
          type: "array",
          description:
            "[create | add] Step titles (strings). Keep them concrete.",
          items: {
            type: "string",
          },
        },
        step_id: {
          type: "string",
          description:
            "[update | complete | skip | set_current] Step id from list, or 1-based index.",
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
