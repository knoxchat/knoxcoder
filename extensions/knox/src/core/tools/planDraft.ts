/**
 * Heal incomplete builtin_plan calls: parse sloppy step lists and, when the
 * model omitted steps, draft a work order from the user request.
 *
 * Lexical only — no embeddings, vector search, or neural rerank.
 */

const MAX_STEPS = 12;

const WAIT_FOR_USER =
  /\b(ask(?:\s+the)?\s+user|wait for (?:the )?user|prompt the user|let the user (?:choose|pick|select|confirm)|confirm with the user|say "?go"?)\b/i;

const PLAN_ACTIONS = [
  "create",
  "add",
  "update",
  "complete",
  "skip",
  "set_current",
  "list",
  "clear",
] as const;

export type PlanAction = (typeof PLAN_ACTIONS)[number];

const ACTION_ALIASES: Record<string, PlanAction> = {
  create: "create",
  start: "create",
  new: "create",
  draft: "create",
  make: "create",
  init: "create",
  add: "add",
  append: "add",
  insert: "add",
  update: "update",
  rename: "update",
  complete: "complete",
  done: "complete",
  finish: "complete",
  check: "complete",
  skip: "skip",
  set_current: "set_current",
  current: "set_current",
  focus: "set_current",
  list: "list",
  show: "list",
  get: "list",
  status: "list",
  clear: "clear",
  reset: "clear",
};

export function isPlanAction(value: string): value is PlanAction {
  return (PLAN_ACTIONS as readonly string[]).includes(value);
}

export function aliasPlanAction(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ACTION_ALIASES[key] ?? raw.trim();
}

export function inferPlanAction(input: {
  action?: string;
  existing: boolean;
  hasSteps: boolean;
  hasTitle: boolean;
  hasStepRef: boolean;
}): PlanAction {
  const aliased = aliasPlanAction(input.action);
  if (isPlanAction(aliased)) {
    return aliased;
  }
  if (input.hasStepRef) {
    return "complete";
  }
  if (input.hasSteps || input.hasTitle) {
    return input.existing ? "add" : "create";
  }
  if (input.existing) {
    return "list";
  }
  return "create";
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:[\w+-]+)?\n([\s\S]*?)\n```$/);
  if (fenced) {
    return fenced[1].trim();
  }
  return trimmed.replace(/^```(?:[\w+-]+)?\n/, "").replace(/\n```$/, "");
}

function firstJsonBlob(text: string): string | undefined {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  const start =
    startObj === -1
      ? startArr
      : startArr === -1
        ? startObj
        : Math.min(startObj, startArr);
  if (start < 0) {
    return undefined;
  }
  return text.slice(start);
}

function cleanStepTitle(raw: string): string {
  return raw
    .replace(/^\s*(?:#{1,6}\s+|(?:\d+[\).:-]|\*|-)\s+)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isWaitForUserStep(title: string): boolean {
  return WAIT_FOR_USER.test(title);
}

function uniqueSteps(titles: string[], filterWait: boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of titles) {
    const title = cleanStepTitle(raw);
    if (!title) {
      continue;
    }
    if (filterWait && isWaitForUserStep(title)) {
      continue;
    }
    const key = title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(title);
    if (out.length >= MAX_STEPS) {
      break;
    }
  }
  return out;
}

function titlesFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => titlesFromUnknown(item));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const rec = value as Record<string, unknown>;
  for (const key of ["title", "step", "text", "name", "label"] as const) {
    if (typeof rec[key] === "string" && rec[key].trim()) {
      return [rec[key].trim()];
    }
  }
  return [];
}

/** Split a checklist string (numbered, bullets, newlines, JSON array). */
export function coercePlanSteps(raw: unknown): unknown[] {
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    if (raw.length === 1) {
      const expanded = coercePlanSteps(raw[0]);
      return expanded.length ? expanded : raw;
    }
    return raw.flatMap((item) => {
      const expanded = coercePlanSteps(item);
      return expanded.length ? expanded : [item];
    });
  }
  if (typeof raw !== "string") {
    return [raw];
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  const json = tryParseJson(trimmed);
  if (Array.isArray(json)) {
    return coercePlanSteps(json);
  }
  const lines = trimmed
    .split(/\r?\n+/)
    .map((line) => cleanStepTitle(line))
    .filter(Boolean);
  if (lines.length > 1) {
    return lines;
  }
  const bullets = trimmed
    .split(/(?:^|\n)\s*(?:\d+[\).:-]|\*|-)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bullets.length > 1) {
    return bullets;
  }
  return [trimmed];
}

export function fallbackPlanFromGoal(goal: string): { title: string; steps: string[] } {
  const text = goal.trim().replace(/\s+/g, " ");
  const title = text ? text.slice(0, 80) : "Task plan";
  const steps = text ? [text.slice(0, 200)] : ["Complete the user's request"];
  return { title, steps };
}

export function parsePlanDraft(raw: string): { title?: string; steps: string[] } | undefined {
  const text = stripCodeFences(raw);
  const blob = firstJsonBlob(text) ?? text;
  const json = tryParseJson(blob);
  if (json && typeof json === "object") {
    const rec = json as Record<string, unknown>;
    const title =
      typeof rec.title === "string"
        ? rec.title.trim()
        : typeof rec.goal === "string"
          ? rec.goal.trim()
          : undefined;
    const steps = uniqueSteps(
      titlesFromUnknown(rec.steps ?? rec.items ?? rec.checklist ?? json),
      true,
    );
    if (steps.length) {
      return { title: title || undefined, steps };
    }
  }
  const lines = uniqueSteps(
    text.split(/\r?\n/).filter((line) => /^\s*(?:\d+[\).:-]|\*|-)\s+\S/.test(line)),
    true,
  );
  if (lines.length) {
    return { steps: lines };
  }
  return undefined;
}

function draftPrompt(goal: string): string {
  return `Draft a short task execution plan for this coding request.
Return ONLY JSON: {"title":"...","steps":["...","..."]}
Rules:
- 3 to 8 concrete, executable steps (files, tests, verify).
- Pick toolchain and version defaults yourself. Never ask the user, wait for confirmation, or include a "say go" step.
- No questions, no markdown, no commentary.

Request:
${goal.slice(0, 4000)}`;
}

export async function draftPlanFromGoal(input: {
  goal: string;
  llm?: {
    complete?: (
      prompt: string,
      signal: AbortSignal,
      options?: Record<string, unknown>,
    ) => Promise<string>;
  };
  signal?: AbortSignal;
}): Promise<{ title: string; steps: string[] }> {
  const fallback = fallbackPlanFromGoal(input.goal);
  const complete = input.llm?.complete;
  if (typeof complete !== "function" || !input.goal.trim()) {
    return fallback;
  }
  try {
    const raw = await complete(
      draftPrompt(input.goal),
      input.signal ?? new AbortController().signal,
      { maxTokens: 400, temperature: 0 },
    );
    const parsed = parsePlanDraft(raw);
    if (parsed?.steps.length) {
      return {
        title: parsed.title || fallback.title,
        steps: parsed.steps,
      };
    }
  } catch {
    // Fall through to a single-step plan so create never errors.
  }
  return fallback;
}
