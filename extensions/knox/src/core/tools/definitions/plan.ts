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
    description: `Create or update the durable task plan for this chat. The plan is injected every turn as protected "Task Execution Plan" content and survives context compaction.

Use this for multi-hour kernel/QEMU work instead of keeping a checklist only in assistant prose.
- create: replace the plan (title + steps)
- add: append step(s)
- update: change a step title or status
- complete / skip: mark a step done or skipped
- set_current: mark one step in_progress when you start it
- list: show the current plan
- clear: remove the plan

Call set_current before working a step and complete immediately after it succeeds (file written, test green, build finished). Do not leave every step pending while you implement.
Do not use this for a one-file edit. Keep steps concrete (explore mm/, reproduce panic, patch, rebuild).`,
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
          description:
            "create | add | update | complete | skip | set_current | list | clear",
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
