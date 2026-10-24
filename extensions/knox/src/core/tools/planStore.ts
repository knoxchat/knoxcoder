/**
 * Session-scoped task plan (HL-17). Survives compaction because the
 * formatted block uses the protected "Task Execution Plan" marker.
 * K-060: also survives Core restart via `sessions/<id>.plan.json` when
 * that session file already exists.
 */

import {
  readPersistedPlan,
  removePersistedPlan,
  writePersistedPlan,
} from "./planPersist";

export const TASK_EXECUTION_PLAN_MARKER = "Task Execution Plan";

export type PlanStepStatus = "pending" | "in_progress" | "done" | "skipped";

export interface PlanStep {
  id: string;
  title: string;
  status: PlanStepStatus;
}

export interface TaskPlan {
  title: string;
  steps: PlanStep[];
  updatedAt: number;
}

const plans = new Map<string, TaskPlan>();

export function planSessionKey(sessionId?: string | null): string {
  const trimmed = sessionId?.trim();
  return trimmed || "default";
}

function remember(sessionId: string | null | undefined, plan: TaskPlan): void {
  const key = planSessionKey(sessionId);
  plans.set(key, plan);
  writePersistedPlan(key, plan);
}

export function getPlan(sessionId?: string | null): TaskPlan | undefined {
  const key = planSessionKey(sessionId);
  const live = plans.get(key);
  if (live) {
    return live;
  }
  const persisted = readPersistedPlan(key);
  if (persisted) {
    plans.set(key, persisted);
    return persisted;
  }
  return undefined;
}

export function clearPlan(sessionId?: string | null): boolean {
  const key = planSessionKey(sessionId);
  const existed = plans.delete(key);
  writePersistedPlan(key, null);
  return existed;
}

/** Test helper — wipe the in-memory store. Disk sidecars stay (tmp dirs). */
export function resetPlansForTests(): void {
  plans.clear();
}

/** Load a persisted plan into memory (history/load). */
export function hydratePersistedPlan(sessionId?: string | null): TaskPlan | undefined {
  return getPlan(sessionId);
}

export { removePersistedPlan };

function slugId(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug ? `${index + 1}-${slug}` : `step-${index + 1}`;
}

function clonePlan(plan: TaskPlan): TaskPlan {
  return {
    title: plan.title,
    updatedAt: plan.updatedAt,
    steps: plan.steps.map((step) => ({ ...step })),
  };
}

function parseStatus(raw: unknown): PlanStepStatus | undefined {
  if (
    raw === "pending" ||
    raw === "in_progress" ||
    raw === "done" ||
    raw === "skipped"
  ) {
    return raw;
  }
  if (raw === "complete" || raw === "completed") {
    return "done";
  }
  if (raw === "skip") {
    return "skipped";
  }
  if (raw === "current" || raw === "active") {
    return "in_progress";
  }
  return undefined;
}

function normalizeStep(
  raw: unknown,
  index: number,
  fallbackStatus: PlanStepStatus = "pending",
): PlanStep | undefined {
  if (typeof raw === "string" && raw.trim()) {
    return {
      id: slugId(raw.trim(), index),
      title: raw.trim(),
      status: fallbackStatus,
    };
  }
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const title =
    typeof record.title === "string"
      ? record.title.trim()
      : typeof record.step === "string"
        ? record.step.trim()
        : "";
  if (!title) {
    return undefined;
  }
  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : slugId(title, index);
  return {
    id,
    title,
    status: parseStatus(record.status) ?? fallbackStatus,
  };
}

export function createPlan(input: {
  sessionId?: string | null;
  title?: string;
  steps?: unknown[];
}): TaskPlan {
  const steps = (input.steps ?? [])
    .map((step, index) => normalizeStep(step, index))
    .filter((step): step is PlanStep => Boolean(step));
  const plan: TaskPlan = {
    title: input.title?.trim() || "Task plan",
    steps,
    updatedAt: Date.now(),
  };
  promoteNextPending(plan);
  remember(input.sessionId, plan);
  return clonePlan(plan);
}

/** If nothing is in progress, the next pending step becomes current. */
function promoteNextPending(plan: TaskPlan): void {
  if (plan.steps.some((step) => step.status === "in_progress")) {
    return;
  }
  const next = plan.steps.find((step) => step.status === "pending");
  if (next) {
    next.status = "in_progress";
  }
}

function requirePlan(sessionId?: string | null): TaskPlan {
  const existing = getPlan(sessionId);
  if (existing) {
    return existing;
  }
  return createPlan({ sessionId, title: "Task plan", steps: [] });
}

function findStep(plan: TaskPlan, stepId?: string, title?: string): PlanStep | undefined {
  if (stepId?.trim()) {
    const id = stepId.trim();
    const exact = plan.steps.find((step) => step.id === id);
    if (exact) {
      return exact;
    }
    const byIndex = Number(id);
    if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= plan.steps.length) {
      return plan.steps[byIndex - 1];
    }
  }
  if (title?.trim()) {
    const needle = title.trim().toLowerCase();
    return plan.steps.find((step) => step.title.toLowerCase() === needle);
  }
  return undefined;
}

export function addPlanSteps(input: {
  sessionId?: string | null;
  steps?: unknown[];
  title?: string;
}): TaskPlan {
  const plan = requirePlan(input.sessionId);
  const extras = [...(input.steps ?? [])];
  if (input.title?.trim()) {
    extras.push(input.title.trim());
  }
  const start = plan.steps.length;
  for (const [offset, raw] of extras.entries()) {
    const step = normalizeStep(raw, start + offset);
    if (step) {
      plan.steps.push(step);
    }
  }
  plan.updatedAt = Date.now();
  promoteNextPending(plan);
  remember(input.sessionId, plan);
  return clonePlan(plan);
}

export function updatePlanStep(input: {
  sessionId?: string | null;
  stepId?: string;
  title?: string;
  status?: unknown;
  newTitle?: string;
}): TaskPlan {
  const plan = requirePlan(input.sessionId);
  const step = findStep(plan, input.stepId, input.title);
  if (!step) {
    throw new Error(
      `No plan step matching ${input.stepId || input.title || "(missing step_id)"}.`,
    );
  }
  const status = parseStatus(input.status);
  if (status) {
    if (status === "in_progress") {
      for (const other of plan.steps) {
        if (other !== step && other.status === "in_progress") {
          other.status = "pending";
        }
      }
    }
    step.status = status;
  }
  if (input.newTitle?.trim()) {
    step.title = input.newTitle.trim();
  }
  if (step.status === "done" || step.status === "skipped") {
    promoteNextPending(plan);
  }
  plan.updatedAt = Date.now();
  remember(input.sessionId, plan);
  return clonePlan(plan);
}

function resolveCompleteTarget(
  plan: TaskPlan,
  stepId?: string,
  title?: string,
): PlanStep | undefined {
  const requested = findStep(plan, stepId, title);
  const current = currentPlanStep(plan);
  if (!requested) {
    return current;
  }
  if (requested.status === "done" || requested.status === "skipped") {
    return current ?? requested;
  }
  return requested;
}

export function completePlanStep(input: {
  sessionId?: string | null;
  stepId?: string;
  title?: string;
  status?: PlanStepStatus;
}): TaskPlan {
  const plan = getPlan(input.sessionId);
  if (!plan) {
    return updatePlanStep({
      ...input,
      status: input.status ?? "done",
    });
  }
  const target = resolveCompleteTarget(plan, input.stepId, input.title);
  return updatePlanStep({
    ...input,
    stepId: target?.id,
    title: target ? undefined : input.title,
    status: input.status ?? "done",
  });
}

export const PLAN_CLEARED_TEXT = "Task Execution Plan cleared.";

function statusMark(status: PlanStepStatus): string {
  switch (status) {
    case "done":
      return "x";
    case "in_progress":
      return "*";
    case "skipped":
      return "-";
    default:
      return " ";
  }
}

function markToStatus(mark: string): PlanStepStatus {
  switch (mark) {
    case "x":
      return "done";
    case "*":
      return "in_progress";
    case "-":
      return "skipped";
    default:
      return "pending";
  }
}

export function countPlanRemaining(plan: TaskPlan): number {
  return plan.steps.filter(
    (step) => step.status === "pending" || step.status === "in_progress",
  ).length;
}

/** Authoritative Execute handoff line (K-066): store remaining, not GUI snapshot. */
export function formatPlanRemainingLine(plan: TaskPlan): string {
  const remaining = countPlanRemaining(plan);
  const open = plan.steps
    .filter(
      (step) => step.status === "pending" || step.status === "in_progress",
    )
    .map((step) => step.title);
  if (remaining === 0) {
    return "Remaining 0: plan is complete.";
  }
  return `Remaining ${remaining}: ${open.join("; ")}`;
}

export function currentPlanStep(plan: TaskPlan): PlanStep | undefined {
  return plan.steps.find((step) => step.status === "in_progress");
}

/** Parse the markdown block produced by formatPlanText, or undefined if it is not a plan. */
export function parsePlanText(text: string): TaskPlan | undefined {
  if (!text.includes(TASK_EXECUTION_PLAN_MARKER)) {
    return undefined;
  }
  let title = "Task plan";
  const steps: PlanStep[] = [];
  for (const line of text.split(/\r?\n/)) {
    const titleMatch = /^Title:\s*(.*)$/.exec(line);
    if (titleMatch) {
      title = titleMatch[1].trim() || title;
      continue;
    }
    const stepMatch = /^\d+\. \[([ x*\-])\] (.*) \(([^)]+)\)\s*$/.exec(line);
    if (stepMatch) {
      steps.push({
        id: stepMatch[3],
        title: stepMatch[2],
        status: markToStatus(stepMatch[1]),
      });
    }
  }
  return { title, steps, updatedAt: 0 };
}

export function formatPlanText(plan: TaskPlan): string {
  const lines = [
    `## ${TASK_EXECUTION_PLAN_MARKER}`,
    "[pinned]",
    `Title: ${plan.title}`,
  ];
  if (plan.steps.length === 0) {
    lines.push("(no steps yet)");
  } else {
    plan.steps.forEach((step, index) => {
      lines.push(
        `${index + 1}. [${statusMark(step.status)}] ${step.title} (${step.id})`,
      );
    });
  }
  lines.push(formatPlanRemainingLine(plan));
  lines.push(
    `${countPlanRemaining(plan)} remaining / ${plan.steps.length} total`,
  );
  if (countPlanRemaining(plan) > 0) {
    const current = currentPlanStep(plan);
    lines.push(
      current
        ? `Do this step now: ${current.title} (${current.id}). complete it when finished, then the next pending step becomes current.`
        : "set_current the next pending step and do that work.",
    );
    lines.push(
      "Remaining > 0 means you are not done. complete or skip leftovers before you stop.",
    );
  }
  return lines.join("\n");
}

function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join("\n");
  }
  return "";
}

/** Live store first, then the latest plan markdown in the transcript. */
export function resolveOpenPlan(opts: {
  sessionId?: string | null;
  messages?: Array<{ role?: string; content?: unknown }>;
}): TaskPlan | undefined {
  const live = getPlan(opts.sessionId);
  if (live) {
    return live.steps.length > 0 ? live : undefined;
  }
  const messages = opts.messages;
  if (!messages) {
    return undefined;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messageText(messages[i]?.content);
    if (text.includes(PLAN_CLEARED_TEXT)) {
      return undefined;
    }
    const parsed = parsePlanText(text);
    if (parsed?.steps.length) {
      return parsed;
    }
  }
  return undefined;
}

export const PLAN_HOLD_MARKER = "[Task plan]";

/** Instruction injected when the model tries to stop with open plan steps. */
export function buildPlanHoldInstruction(plan: TaskPlan): string {
  const open = plan.steps.filter(
    (step) => step.status === "pending" || step.status === "in_progress",
  );
  const current = currentPlanStep(plan);
  const lines = [
    `${PLAN_HOLD_MARKER} ${countPlanRemaining(plan)} of ${plan.steps.length} steps still open. You are not done.`,
    "Open steps:",
    ...open.map(
      (step) =>
        `- ${step.status === "in_progress" ? "(current) " : ""}${step.title} (${step.id})`,
    ),
    current
      ? `Keep working "${current.title}". When it is actually finished, builtin_plan action=complete step_id="${current.id}".`
      : "builtin_plan action=set_current on the next pending step, then do that work.",
    "For every open step you already finished, builtin_plan action=complete. If a step is obsolete, action=skip. Do not send a final summary until remaining is 0.",
  ];
  return lines.join("\n");
}

/** Protected inject block, or empty string when this session has no plan. */
export function formatPlanInject(sessionId?: string | null): string {
  const plan = getPlan(sessionId);
  return plan ? formatPlanText(plan) : "";
}

function historyItemContent(item: {
  message?: { content?: unknown };
}): string {
  const content = item.message?.content;
  return typeof content === "string" ? content : "";
}

/** Put a recovered plan back in the live store so complete/skip/hold still work. */
function adoptRecoveredPlan(
  sessionId: string | null | undefined,
  parsed: TaskPlan,
): string {
  if (sessionId && !plans.get(planSessionKey(sessionId)) && parsed.steps.length > 0) {
    promoteNextPending(parsed);
    parsed.updatedAt = Date.now();
    remember(sessionId, parsed);
  }
  return formatPlanText(parsed);
}

/**
 * Recover the latest plan markdown from chat history when the in-memory
 * store is empty (GUI webview, or after a reload).
 */
export function formatPlanInjectFromHistory(
  history: Array<{
    message?: { content?: unknown };
    contextItems?: Array<{
      content?: string;
      name?: string;
      description?: string;
    }>;
  }>,
  sessionId?: string | null,
): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    for (const ctx of item.contextItems ?? []) {
      const content = ctx.content ?? "";
      if (
        (ctx.name === "Plan" && ctx.description === "cleared") ||
        content.includes(PLAN_CLEARED_TEXT)
      ) {
        return "";
      }
      const parsed = parsePlanText(content);
      if (parsed) {
        return adoptRecoveredPlan(sessionId, parsed);
      }
    }
    const content = historyItemContent(item);
    if (content.includes(PLAN_CLEARED_TEXT)) {
      return "";
    }
    const parsed = parsePlanText(content);
    if (parsed) {
      return adoptRecoveredPlan(sessionId, parsed);
    }
  }
  return "";
}
