import { ToolImpl } from ".";
import {
  addPlanSteps,
  clearPlan,
  completePlanStep,
  createPlan,
  formatPlanText,
  getPlan,
  PLAN_CLEARED_TEXT,
  updatePlanStep,
  type PlanStepStatus,
  type TaskPlan,
} from "../planStore";

function sessionIdOf(extras: { soul?: { sessionId?: string } }): string {
  return extras.soul?.sessionId || "default";
}

function render(description: string, plan: TaskPlan) {
  return [
    {
      name: "Plan",
      description,
      content: formatPlanText(plan),
      // Shown in the attached input panel, not as a chat context peek.
      hidden: true,
    },
  ];
}

function asStatus(raw: unknown): PlanStepStatus | undefined {
  if (
    raw === "pending" ||
    raw === "in_progress" ||
    raw === "done" ||
    raw === "skipped"
  ) {
    return raw;
  }
  return undefined;
}

export const planImpl: ToolImpl = async (args, extras) => {
  const action = typeof args?.action === "string" ? args.action.trim() : "";
  const sessionId = sessionIdOf(extras);
  const stepId =
    typeof args?.step_id === "string"
      ? args.step_id
      : typeof args?.stepId === "string"
        ? args.stepId
        : undefined;
  const title = typeof args?.title === "string" ? args.title : undefined;
  const steps = Array.isArray(args?.steps) ? args.steps : undefined;
  const newTitle =
    typeof args?.new_title === "string"
      ? args.new_title
      : typeof args?.newTitle === "string"
        ? args.newTitle
        : undefined;

  try {
    switch (action) {
      case "create": {
        if (!steps?.length && !title) {
          return [
            {
              name: "Plan",
              description: "error",
              content:
                'create requires "steps" (array of titles) and optionally "title".',
            },
          ];
        }
        return render(
          "created",
          createPlan({ sessionId, title, steps: steps ?? [] }),
        );
      }
      case "add": {
        if (!steps?.length && !title) {
          return [
            {
              name: "Plan",
              description: "error",
              content: 'add requires "title" or "steps".',
            },
          ];
        }
        return render("updated", addPlanSteps({ sessionId, steps, title }));
      }
      case "list": {
        const plan = getPlan(sessionId);
        if (!plan) {
          return [
            {
              name: "Plan",
              description: "empty",
              content:
                "No task plan yet. Call builtin_plan with action=create.",
              hidden: true,
            },
          ];
        }
        return render("listed", plan);
      }
      case "clear": {
        clearPlan(sessionId);
        return [
          {
            name: "Plan",
            description: "cleared",
            content: PLAN_CLEARED_TEXT,
            hidden: true,
          },
        ];
      }
      case "complete":
        return render(
          "updated",
          completePlanStep({ sessionId, stepId, title, status: "done" }),
        );
      case "skip":
        return render(
          "updated",
          completePlanStep({
            sessionId,
            stepId,
            title,
            status: "skipped",
          }),
        );
      case "set_current":
        return render(
          "updated",
          completePlanStep({
            sessionId,
            stepId,
            title,
            status: "in_progress",
          }),
        );
      case "update":
        return render(
          "updated",
          updatePlanStep({
            sessionId,
            stepId,
            title,
            status: asStatus(args?.status),
            newTitle,
          }),
        );
      default:
        return [
          {
            name: "Plan",
            description: "error",
            content:
              "Unknown action. Use create, add, update, complete, skip, set_current, list, or clear.",
          },
        ];
    }
  } catch (error) {
    return [
      {
        name: "Plan",
        description: "error",
        content: error instanceof Error ? error.message : String(error),
      },
    ];
  }
};
