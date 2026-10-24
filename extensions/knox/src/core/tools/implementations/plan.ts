import { ToolImpl } from ".";
import { getJevUserMessage } from "../../jev/config";
import {
  coercePlanSteps,
  draftPlanFromGoal,
  inferPlanAction,
  type PlanAction,
} from "../planDraft";
import {
  addPlanSteps,
  clearPlan,
  completePlanStep,
  countPlanRemaining,
  createPlan,
  currentPlanStep,
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
  const remaining = countPlanRemaining(plan);
  const current = currentPlanStep(plan);
  const summary =
    remaining === 0
      ? `Plan complete. 0 remaining / ${plan.steps.length} total.`
      : `Plan ${description}. ${remaining} remaining / ${plan.steps.length} total.${
          current ? ` Current: ${current.title} (${current.id}).` : ""
        }`;
  return [
    {
      name: "Plan",
      description,
      content: `${summary}\n\n${formatPlanText(plan)}`,
      // Shown in the attached input panel, not as a chat context peek.
      hidden: true,
    },
  ];
}

function empty(description: string, content: string) {
  return [
    {
      name: "Plan",
      description,
      content,
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

function asText(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function requestGoal(args: Record<string, unknown> | undefined, title?: string): string {
  return (
    title ||
    asText(args?.goal) ||
    asText(args?.task) ||
    getJevUserMessage().trim() ||
    ""
  );
}

async function resolveCreateSteps(
  args: Record<string, unknown> | undefined,
  extras: Parameters<ToolImpl>[1],
  title: string | undefined,
  steps: unknown[] | undefined,
): Promise<{ title?: string; steps: unknown[] }> {
  if (steps?.length) {
    return { title, steps };
  }
  const drafted = await draftPlanFromGoal({
    goal: requestGoal(args, title),
    llm: extras.llm,
    signal: extras.abortSignal,
  });
  return {
    title: title || drafted.title,
    steps: drafted.steps,
  };
}

function mutateCurrent(
  sessionId: string,
  args: {
    stepId?: string;
    title?: string;
    status?: PlanStepStatus | unknown;
    newTitle?: string;
  },
): TaskPlan {
  const plan = getPlan(sessionId);
  if (!plan) {
    return createPlan({ sessionId, title: "Task plan", steps: [] });
  }
  try {
    return updatePlanStep({ sessionId, ...args });
  } catch {
    const current = currentPlanStep(plan);
    if (current) {
      try {
        return updatePlanStep({
          sessionId,
          stepId: current.id,
          status: args.status,
          newTitle: args.newTitle,
        });
      } catch {
        return plan;
      }
    }
    return plan;
  }
}

export const planImpl: ToolImpl = async (args, extras) => {
  const sessionId = sessionIdOf(extras);
  const existing = getPlan(sessionId);
  const stepId =
    asText(args?.step_id) ?? asText(args?.stepId) ?? undefined;
  const title = asText(args?.title);
  const rawSteps = args?.steps ?? args?.items ?? args?.checklist;
  const steps = Array.isArray(rawSteps) || typeof rawSteps === "string"
    ? coercePlanSteps(rawSteps)
    : undefined;
  const newTitle = asText(args?.new_title) ?? asText(args?.newTitle);
  const hasSteps = Boolean(steps?.length);
  const action: PlanAction = inferPlanAction({
    action: typeof args?.action === "string" ? args.action : "",
    existing: Boolean(existing?.steps.length),
    hasSteps,
    hasTitle: Boolean(title),
    hasStepRef: Boolean(stepId),
  });

  try {
    switch (action) {
      case "create": {
        if (!hasSteps && existing?.steps.length) {
          if (title && title !== existing.title) {
            return render(
              "updated",
              createPlan({
                sessionId,
                title,
                steps: existing.steps.map((step) => ({ ...step })),
              }),
            );
          }
          return render("listed", existing);
        }
        const resolved = await resolveCreateSteps(args, extras, title, steps);
        return render(
          "created",
          createPlan({
            sessionId,
            title: resolved.title,
            steps: resolved.steps,
          }),
        );
      }
      case "add": {
        if (!existing?.steps.length) {
          const resolved = await resolveCreateSteps(args, extras, title, steps);
          return render(
            "created",
            createPlan({
              sessionId,
              title: resolved.title,
              steps: resolved.steps,
            }),
          );
        }
        if (!hasSteps && !title) {
          return render("listed", existing);
        }
        return render("updated", addPlanSteps({ sessionId, steps, title }));
      }
      case "list": {
        if (!existing) {
          return empty("empty", "No task plan yet.");
        }
        return render("listed", existing);
      }
      case "clear": {
        clearPlan(sessionId);
        return empty("cleared", PLAN_CLEARED_TEXT);
      }
      case "complete":
        return render(
          "updated",
          completePlanStep({ sessionId, stepId, title }),
        );
      case "skip":
        return render(
          "updated",
          mutateCurrent(sessionId, { stepId, title, status: "skipped" }),
        );
      case "set_current":
        return render(
          "updated",
          mutateCurrent(sessionId, {
            stepId,
            title,
            status: "in_progress",
          }),
        );
      case "update":
        return render(
          "updated",
          mutateCurrent(sessionId, {
            stepId,
            title,
            status: asStatus(args?.status),
            newTitle,
          }),
        );
      default:
        if (existing) {
          return render("listed", existing);
        }
        return empty("empty", "No task plan yet.");
    }
  } catch (error) {
    const live = getPlan(sessionId);
    if (live) {
      return render("listed", live);
    }
    return empty(
      "empty",
      error instanceof Error ? error.message : String(error),
    );
  }
};
