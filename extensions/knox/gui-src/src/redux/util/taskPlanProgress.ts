import { ChatHistoryItem, ToolCallState } from "core";
import { isFailedToolOutput } from "core/agent/doomLoop";
import { BuiltInToolNames } from "core/tools/builtIn";
import type { PlanStep, PlanStepStatus, TaskPlan } from "core/tools/planStore";
import { countPlanRemaining, currentPlanStep } from "core/tools/planStore";

import {
  classifyToolKind,
  toolStepDetail,
  type AgentActivityKind,
} from "./agentActivity";
import { getHistoryToolStates } from "./index";
import {
  collectLatestTaskPlanSnapshot,
  isTaskPlanUpdating,
} from "./taskPlan";

const WRITE_TOOLS = new Set<string>([
  BuiltInToolNames.EditFile,
  BuiltInToolNames.WriteFile,
  BuiltInToolNames.ApplyPatch,
  BuiltInToolNames.CreateNewFile,
  "composite_smart_edit",
]);

const SHELL_TOOLS = new Set<string>([
  BuiltInToolNames.RunTerminalCommand,
  BuiltInToolNames.AwaitShell,
  BuiltInToolNames.PtyStart,
  BuiltInToolNames.Build,
  BuiltInToolNames.Qemu,
]);

const TEST_TOOLS = new Set<string>([BuiltInToolNames.GenerateTests]);

const READ_TOOLS = new Set<string>([
  BuiltInToolNames.ReadFile,
  BuiltInToolNames.ReadCurrentlyOpenFile,
  BuiltInToolNames.ViewSubdirectory,
  BuiltInToolNames.Glob,
  BuiltInToolNames.ExactSearch,
  BuiltInToolNames.EnhancedSearch,
]);

const PATH_HINT_RE = /[A-Za-z0-9_./+-]+\.[A-Za-z][A-Za-z0-9]{0,7}/g;
const MATCH_THRESHOLD = 8;

export type StepIntent = "write" | "shell" | "test" | "read" | "any";

export interface LivePlanStep extends PlanStep {
  /** Tool detail inferred after the last stored snapshot (e.g. Cargo.toml). */
  activity?: string;
  /** True when status came from later tool activity, not builtin_plan. */
  live?: boolean;
}

export interface LiveTaskPlan extends TaskPlan {
  steps: LivePlanStep[];
  remaining: number;
  doneCount: number;
  current?: LivePlanStep;
  updating: boolean;
}

type ToolEvent = {
  kind: AgentActivityKind;
  toolName: string;
  path?: string;
  command?: string;
  running: boolean;
  failed: boolean;
  activity?: string;
};

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export function extractPathHints(title: string): string[] {
  const matches = title.match(PATH_HINT_RE) ?? [];
  return matches.filter(
    (hint) => !/^\d/.test(hint) && !/alpha|beta|rc\d/i.test(hint),
  );
}

export function stepIntent(title: string): StepIntent {
  if (
    /\bcargo\s+(check|build|test|clippy|nextest|bench|doc|miri)\b/i.test(
      title,
    ) ||
    /\b(npm|pnpm|yarn|bun)\s+(test|run|build)\b/i.test(title) ||
    /\bmake\s+\S+/i.test(title) ||
    /\b(qemu|cargo check|cargo build)\b/i.test(title)
  ) {
    return "shell";
  }
  if (/\b(unit tests?|add tests?|generate tests?|kselftest)\b/i.test(title)) {
    return "test";
  }
  if (
    extractPathHints(title).length > 0 ||
    /\b(create|write|add|edit|patch|implement|fix)\b/i.test(title)
  ) {
    return "write";
  }
  if (/\b(read|explore|inspect|look|parse)\b/i.test(title)) {
    return "read";
  }
  return "any";
}

function eventFitsIntent(intent: StepIntent, event: ToolEvent): boolean {
  if (event.running) {
    if (intent === "write") {
      return WRITE_TOOLS.has(event.toolName) || event.kind === "edit";
    }
    if (intent === "shell") {
      return SHELL_TOOLS.has(event.toolName) || event.kind === "shell";
    }
    if (intent === "test") {
      return (
        TEST_TOOLS.has(event.toolName) ||
        event.kind === "test" ||
        SHELL_TOOLS.has(event.toolName)
      );
    }
    if (intent === "read") {
      return READ_TOOLS.has(event.toolName) || event.kind === "read";
    }
    return event.kind !== "thinking" && event.kind !== "reply";
  }
  if (intent === "write") {
    return WRITE_TOOLS.has(event.toolName) || event.kind === "edit";
  }
  if (intent === "shell") {
    return (
      SHELL_TOOLS.has(event.toolName) ||
      event.kind === "shell" ||
      event.kind === "test"
    );
  }
  if (intent === "test") {
    return TEST_TOOLS.has(event.toolName) || event.kind === "test";
  }
  if (intent === "read") {
    return (
      READ_TOOLS.has(event.toolName) ||
      event.kind === "read" ||
      event.kind === "search"
    );
  }
  return true;
}

export function scoreStepEvent(step: PlanStep, event: ToolEvent): number {
  if (!eventFitsIntent(stepIntent(step.title), event)) {
    return 0;
  }
  let score = 0;
  const title = step.title.toLowerCase();
  const path = event.path ? normalizePath(event.path) : "";
  const base = path ? basename(path) : "";
  for (const hint of extractPathHints(step.title)) {
    const normalized = normalizePath(hint);
    const hintBase = basename(normalized);
    if (path && (path === normalized || path.endsWith(`/${normalized}`))) {
      score += 14;
    } else if (base && hintBase && base === hintBase) {
      score += 12;
    } else if (path && path.includes(normalized)) {
      score += 8;
    }
  }
  if (base && title.includes(base)) {
    score += 8;
  }
  const command = event.command?.toLowerCase() ?? "";
  if (command) {
    if (
      /\bcargo\s+check\b/i.test(step.title) &&
      /\bcargo\s+check\b/.test(command)
    ) {
      score += 14;
    }
    if (
      /\bcargo\s+build\b/i.test(step.title) &&
      /\bcargo\s+build\b/.test(command)
    ) {
      score += 14;
    }
    if (/\bcargo\b/i.test(step.title) && /\bcargo\s+check\b/.test(command)) {
      score += 10;
    }
    if (/\bcargo\b/i.test(step.title) && /\bcargo\s+build\b/.test(command)) {
      score += 10;
    }
    if (
      (/\btest\b/i.test(step.title) || stepIntent(step.title) === "test") &&
      (/\btest\b/.test(command) || event.kind === "test")
    ) {
      score += 10;
    }
  } else if (event.kind === "test" && stepIntent(step.title) === "test") {
    score += 10;
  }
  return score;
}

function argString(
  args: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!args) {
    return undefined;
  }
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function patchPath(patch: string): string | undefined {
  const match = patch.match(/\*\*\* (?:Add|Update|Delete|Move) File: (.+)/);
  return match?.[1]?.trim();
}

function eventFromTool(state: ToolCallState): ToolEvent | undefined {
  const toolName = state.toolCall?.function?.name;
  if (!toolName || toolName === BuiltInToolNames.Plan) {
    return undefined;
  }
  const args =
    state.parsedArgs && typeof state.parsedArgs === "object"
      ? (state.parsedArgs as Record<string, unknown>)
      : undefined;
  const path =
    argString(args, [
      "filepath",
      "path",
      "file_path",
      "target_file",
      "filename",
    ]) ??
    (typeof args?.patch === "string" ? patchPath(args.patch) : undefined);
  const command = argString(args, ["command"]);
  const failed =
    state.status === "canceled" || isFailedToolOutput(state.output);
  const running =
    !failed &&
    (state.status === "generating" ||
      state.status === "generated" ||
      state.status === "calling");
  return {
    kind: classifyToolKind(toolName, state.parsedArgs),
    toolName,
    path,
    command,
    running,
    failed,
    activity: toolStepDetail(toolName, state.parsedArgs),
  };
}

function collectEventsAfter(
  history: ChatHistoryItem[],
  afterIndex: number,
): ToolEvent[] {
  const events: ToolEvent[] = [];
  for (let i = afterIndex + 1; i < history.length; i++) {
    for (const state of getHistoryToolStates(history[i])) {
      const event = eventFromTool(state);
      if (event) {
        events.push(event);
      }
    }
  }
  return events;
}

function bestMatch(
  steps: LivePlanStep[],
  event: ToolEvent,
): LivePlanStep | undefined {
  let best: LivePlanStep | undefined;
  let bestScore = 0;
  for (const step of steps) {
    if (step.status === "skipped") {
      continue;
    }
    const score = scoreStepEvent(step, event);
    if (score > bestScore) {
      bestScore = score;
      best = step;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : undefined;
}

function applyEvent(steps: LivePlanStep[], event: ToolEvent): void {
  const match = bestMatch(steps, event);
  if (!match) {
    return;
  }
  if (match.status === "done" && !event.running) {
    if (event.activity) {
      match.activity = event.activity;
    }
    return;
  }
  if (event.failed) {
    if (match.status === "in_progress") {
      match.status = "pending";
      match.live = true;
    }
    return;
  }
  const next: PlanStepStatus = event.running ? "in_progress" : "done";
  if (next === "in_progress") {
    for (const step of steps) {
      if (step !== match && step.status === "in_progress") {
        step.status = "pending";
        step.live = true;
      }
    }
  }
  if (match.status === "done" && next === "in_progress") {
    return;
  }
  match.status = next;
  match.live = true;
  if (event.activity) {
    match.activity = event.activity;
  }
}

/** Overlay tool activity after the last stored plan snapshot. */
export function applyLivePlanProgress(
  plan: TaskPlan,
  history: ChatHistoryItem[],
  snapshotIndex: number,
): LiveTaskPlan {
  const steps: LivePlanStep[] = plan.steps.map((step) => ({ ...step }));
  for (const event of collectEventsAfter(history, snapshotIndex)) {
    applyEvent(steps, event);
  }
  const live: LiveTaskPlan = {
    ...plan,
    steps,
    remaining: countPlanRemaining({ ...plan, steps }),
    doneCount: steps.filter((step) => step.status === "done").length,
    current: currentPlanStep({ ...plan, steps }) as LivePlanStep | undefined,
    updating: isTaskPlanUpdating(history) || steps.some((s) => s.status === "in_progress"),
  };
  return live;
}

export function collectLiveTaskPlan(
  history: ChatHistoryItem[],
): LiveTaskPlan | undefined {
  const snapshot = collectLatestTaskPlanSnapshot(history);
  if (!snapshot) {
    return undefined;
  }
  return applyLivePlanProgress(snapshot.plan, history, snapshot.historyIndex);
}

export function taskPlanFillPercent(plan: LiveTaskPlan): number {
  if (plan.steps.length === 0) {
    return 0;
  }
  const currentBoost = plan.current ? 0.4 : 0;
  return Math.min(
    100,
    ((plan.doneCount + currentBoost) / plan.steps.length) * 100,
  );
}
