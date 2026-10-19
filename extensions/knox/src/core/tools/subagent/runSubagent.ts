import {
  ChatMessage,
  ContextItem,
  Tool,
  ToolExtras,
} from "../..";

import {
  runAgentLoop,
  createAgentLoopCompactor,
  lastOracleErrorCount,
  lastOracleText,
  type AgentLoopStoppedReason,
} from "../../agent/loop";
import {
  DEFAULT_DOOM_LOOP_THRESHOLD,
  SYSTEMS_DOOM_LOOP_THRESHOLD,
} from "../../config/agentProfile";
import { BuiltInToolNames } from "../builtIn";
import { formatCodebaseCardInject } from "../../context/codebaseCard";
import { formatRustPolicyInject } from "../../context/rustPolicy";
import { formatSerialContextInject } from "../../context/serialContext";
import { formatPlanInject } from "../planStore";
import { getSkillManager } from "../implementations/skillSingleton";
import { evaluateAgentTurn } from "../../jev/turn";
import { formatGuardrailHint } from "../../jev/guardrail";
import { getActiveJevRuntime } from "../../jev/config";

import {
  startSubagentJob,
  finishSubagentJob,
} from "./jobs";
import {
  isReadonlySubagentProfile,
  resolveSubagentMaxSteps,
  resolveSubagentProfile,
  subagentSystemPrompt,
  toolsForSubagentProfile,
  type SubagentProfile,
} from "./profiles";

export interface SubagentRunInput {
  prompt: string;
  profile?: unknown;
  maxSteps?: unknown;
  extras: ToolExtras;
  catalog: Tool[];
  executeTool: (tool: Tool, args: unknown) => Promise<ContextItem[]>;
  systems?: boolean;
  jobTitle?: string;
  /** User-defined agent type (`.knoxcoder/agents/*.md`). Replaces the profile prompt/tools. */
  custom?: {
    name: string;
    prompt: string;
    tools?: string[];
    readonly?: boolean;
  };
  /** Called as the child works, for parent-UI progress. */
  onProgress?: (event: SubagentProgressEvent) => void;
}

export type SubagentProgressEvent =
  | { type: "start"; jobId: string }
  | { type: "tool"; jobId: string; tool: string; step: number }
  | { type: "end"; jobId: string; stoppedReason: AgentLoopStoppedReason };

export type SubagentOracle = "pass" | "fail" | "unverified" | "skipped";

export type SubagentFileStat =
  | { added: number; removed: number }
  | "touched";

export interface SubagentRunResult {
  /** Built-in profile, or the custom agent name. */
  profile: string;
  jobId?: string;
  steps: number;
  summary: string;
  filesTouched: string[];
  /** Path → line delta, or `"touched"` for reads / unknown mutations. */
  diffstat: Record<string, SubagentFileStat>;
  oracle: SubagentOracle;
  stoppedReason: AgentLoopStoppedReason;
}

export function emptySubagentResult(
  partial: Pick<SubagentRunResult, "profile" | "summary" | "stoppedReason"> &
    Partial<SubagentRunResult>,
): SubagentRunResult {
  return {
    steps: 0,
    filesTouched: [],
    diffstat: {},
    oracle: "skipped",
    ...partial,
  };
}

/**
 * Parent transcript stays isolated, but the child still needs the same
 * development-loop oracles as `/autonomous`: plan, kernel/QEMU card, serial
 * tail, and skill names for the assigned prompt.
 */
export async function buildSubagentContextBlock(input: {
  prompt: string;
  sessionId?: string;
}): Promise<string> {
  const parts: string[] = [];
  const plan = formatPlanInject(input.sessionId);
  if (plan) {
    parts.push(plan);
  }
  const card = formatCodebaseCardInject();
  if (card) {
    parts.push(card);
  }
  const rustPolicy = formatRustPolicyInject();
  if (rustPolicy) {
    parts.push(rustPolicy);
  }
  const serial = formatSerialContextInject();
  if (serial) {
    parts.push(serial);
  }
  try {
    const manager = getSkillManager();
    if (manager?.isLoaded) {
      const judgment = await evaluateAgentTurn({
        userMessage: input.prompt,
        skills: manager.visible(),
        openPaths: manager.getActivePaths(),
        hasViewRead: false,
        runtime: getActiveJevRuntime(),
      });
      if (judgment.skillHint) {
        parts.push(judgment.skillHint);
      }
      if (judgment.guardrail) {
        const hint = formatGuardrailHint(judgment.guardrail);
        if (hint) {
          parts.push(hint);
        }
      }
    }
  } catch {
    // Skills are optional for isolated unit tests.
  }
  return parts.length > 0 ? `\n\n${parts.join("\n\n")}` : "";
}

const FILE_PATH_KEYS = [
  "filepath",
  "path",
  "file_path",
  "directory_path",
  "target_directory",
];

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

function firstPath(args: Record<string, unknown>): string | undefined {
  for (const key of FILE_PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function recordTouched(
  into: Map<string, SubagentFileStat>,
  file: string,
): void {
  if (!into.has(file)) {
    into.set(file, "touched");
  }
}

function recordDelta(
  into: Map<string, SubagentFileStat>,
  file: string,
  added: number,
  removed: number,
): void {
  const prev = into.get(file);
  if (!prev || prev === "touched") {
    into.set(file, { added, removed });
    return;
  }
  into.set(file, {
    added: prev.added + added,
    removed: prev.removed + removed,
  });
}

function editPairs(
  args: Record<string, unknown>,
): Array<{ old: string; next: string }> {
  const pairs: Array<{ old: string; next: string }> = [];
  const listed = args.edits;
  if (Array.isArray(listed)) {
    for (const item of listed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const rec = item as Record<string, unknown>;
      const old =
        rec.old_string ?? rec.oldString ?? rec.old_str ?? rec.search ?? rec.oldText;
      const next =
        rec.new_string ?? rec.newString ?? rec.new_str ?? rec.replace ?? rec.newText;
      if (typeof old === "string") {
        pairs.push({ old, next: typeof next === "string" ? next : "" });
      }
    }
  }
  const old =
    args.old_string ?? args.oldString ?? args.old_str ?? args.search ?? args.oldText;
  const next =
    args.new_string ??
    args.newString ??
    args.new_str ??
    args.replace ??
    args.newText ??
    args.content ??
    args.contents;
  if (typeof old === "string") {
    pairs.push({ old, next: typeof next === "string" ? next : "" });
  }
  return pairs;
}

function patchDelta(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("***")
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  }
  return { added, removed };
}

function applyPatchStats(
  patch: string,
): Array<{ file: string; added: number; removed: number }> {
  const chunks = patch.split(/^\*\*\* (?:Update|Add|Delete) File:\s*/m);
  const out: Array<{ file: string; added: number; removed: number }> = [];
  for (const chunk of chunks) {
    const nl = chunk.indexOf("\n");
    const file = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    if (!file || file.startsWith("***")) {
      continue;
    }
    const body = nl < 0 ? "" : chunk.slice(nl + 1);
    out.push({ file, ...patchDelta(body) });
  }
  return out;
}

/** Record a child tool's path and, for writes, a line delta (K-065). */
export function recordSubagentFileOp(
  toolName: string,
  args: unknown,
  into: Map<string, SubagentFileStat>,
): void {
  if (!args || typeof args !== "object") {
    return;
  }
  const rec = args as Record<string, unknown>;
  if (toolName === BuiltInToolNames.ApplyPatch && typeof rec.patch === "string") {
    const stats = applyPatchStats(rec.patch);
    if (stats.length === 0) {
      return;
    }
    for (const item of stats) {
      recordDelta(into, item.file, item.added, item.removed);
    }
    return;
  }
  const file = firstPath(rec);
  if (!file) {
    return;
  }
  if (
    toolName === BuiltInToolNames.WriteFile ||
    toolName === BuiltInToolNames.CreateNewFile
  ) {
    const content =
      typeof rec.contents === "string"
        ? rec.contents
        : typeof rec.content === "string"
          ? rec.content
          : "";
    recordDelta(into, file, countLines(content), 0);
    return;
  }
  if (toolName === BuiltInToolNames.EditFile) {
    const pairs = editPairs(rec);
    if (pairs.length === 0) {
      recordTouched(into, file);
      return;
    }
    let added = 0;
    let removed = 0;
    for (const pair of pairs) {
      added += countLines(pair.next);
      removed += countLines(pair.old);
    }
    recordDelta(into, file, added, removed);
    return;
  }
  recordTouched(into, file);
}

export function formatSubagentFileLine(
  file: string,
  stat: SubagentFileStat,
): string {
  if (stat === "touched") {
    return `  - ${file}`;
  }
  return `  - ${file} (+${stat.added}/−${stat.removed})`;
}

function snapshotDiffstat(
  into: Map<string, SubagentFileStat>,
  readonly: boolean,
): { filesTouched: string[]; diffstat: Record<string, SubagentFileStat> } {
  const filesTouched = [...into.keys()].sort();
  const diffstat: Record<string, SubagentFileStat> = {};
  for (const file of filesTouched) {
    const stat = into.get(file) ?? "touched";
    diffstat[file] = readonly ? "touched" : stat;
  }
  return { filesTouched, diffstat };
}

function resolveSubagentOracle(
  messages: ChatMessage[] | undefined,
  stoppedReason: AgentLoopStoppedReason,
): SubagentOracle {
  if (!messages?.length) {
    return stoppedReason === "completed" ? "unverified" : "skipped";
  }
  const text = lastOracleText(messages);
  if (!text) {
    return "unverified";
  }
  return lastOracleErrorCount(messages) > 0 ? "fail" : "pass";
}

export function formatSubagentResult(result: SubagentRunResult): string {
  const entries = Object.entries(result.diffstat);
  const files =
    entries.length > 0
      ? entries.map(([file, stat]) => formatSubagentFileLine(file, stat))
      : ["  - (none)"];
  return [
    `profile: ${result.profile}`,
    `steps: ${result.steps}`,
    `oracle: ${result.oracle}`,
    "files:",
    ...files,
    `summary: ${result.summary.trim() || "(no summary)"}`,
  ].join("\n");
}

export async function runSubagent(
  input: SubagentRunInput,
): Promise<SubagentRunResult> {
  const baseProfile: SubagentProfile = input.custom
    ? input.custom.readonly
      ? "explore"
      : "general"
    : resolveSubagentProfile(input.profile);
  const profile: string = input.custom?.name ?? baseProfile;
  const maxSteps = resolveSubagentMaxSteps(baseProfile, input.maxSteps, {
    systems: input.systems,
  });
  let tools = toolsForSubagentProfile(baseProfile, input.catalog);
  const allow = input.custom?.tools;
  if (allow) {
    tools = tools.filter((tool) => allow.includes(tool.function.name));
  }
  const fileStats = new Map<string, SubagentFileStat>();
  const readonly = isReadonlySubagentProfile(baseProfile);
  const prompt = input.prompt.trim();

  if (!prompt) {
    return emptySubagentResult({
      profile,
      summary: "Subagent prompt was empty.",
      stoppedReason: "error",
    });
  }

  const job = startSubagentJob({
    title: input.jobTitle ?? prompt,
    profile,
  });
  const parentAbort = input.extras.abortSignal;
  const onParentAbort = () => job.abort.abort();
  parentAbort?.addEventListener("abort", onParentAbort);

  const extras: ToolExtras = {
    ...input.extras,
    abortSignal: job.abort.signal,
  };

  input.onProgress?.({ type: "start", jobId: job.id });
  let toolRounds = 0;
  try {
    let memoryBlock = "";
    let sessionId = extras.soul?.sessionId;
    try {
      const { BrainManager } = await import(
        "../../context/memory/brain/BrainManager.js"
      );
      const active = BrainManager.getActiveSessionId();
      if (!sessionId && active) {
        sessionId = active;
      }
      if (sessionId) {
        const built = await BrainManager.buildContextDetailed(
          prompt,
          sessionId,
          2000,
        );
        if (
          built.context &&
          built.context !== "No relevant memories found."
        ) {
          memoryBlock = `\n\n## Parent memory\n${built.context}`;
        }
      }
    } catch {
      // Isolation still works if the brain is unavailable.
    }

    const loopState = await buildSubagentContextBlock({
      prompt,
      sessionId,
    });
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `${
          input.custom
            ? `You are a child agent (${input.custom.name}). Complete only the assigned task. Return a concise summary. Do not spawn further subagents.\n\n${input.custom.prompt}`
            : subagentSystemPrompt(baseProfile)
        }${memoryBlock}${loopState}`,
      },
      { role: "user", content: prompt },
    ];

    const loop = await runAgentLoop({
      extras,
      messages,
      tools,
      maxSteps,
      doomLoopThreshold: input.systems
        ? SYSTEMS_DOOM_LOOP_THRESHOLD
        : DEFAULT_DOOM_LOOP_THRESHOLD,
      compact: createAgentLoopCompactor(extras.llm),
      abortOnCancelled: true,
      // Parent plan is context for the child, not its work order.
      holdCompletionWhilePlanOpen: false,
      missingToolMessage: (name) =>
        `Tool "${name}" is not available to this ${profile} subagent.`,
      executeTool: async (tool, args) => {
        recordSubagentFileOp(tool.function.name, args, fileStats);
        toolRounds += 1;
        input.onProgress?.({
          type: "tool",
          jobId: job.id,
          tool: tool.function.name,
          step: toolRounds,
        });
        return input.executeTool(tool, args);
      },
    });

    const stoppedReason =
      job.abort.signal.aborted
        ? "aborted"
        : loop.stoppedReason;

    const snapshot = snapshotDiffstat(fileStats, readonly);
    const result: SubagentRunResult = {
      profile,
      steps: loop.steps,
      summary: loop.summary,
      jobId: job.id,
      filesTouched: snapshot.filesTouched,
      diffstat: snapshot.diffstat,
      oracle: resolveSubagentOracle(loop.messages, stoppedReason),
      stoppedReason,
    };
    input.onProgress?.({ type: "end", jobId: job.id, stoppedReason });
    finishSubagentJob(
      job.id,
      stoppedReason === "aborted" ? "killed" : "exited",
      result.summary,
      { oracle: result.oracle, files: result.filesTouched },
    );
    return result;
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    const stoppedReason: AgentLoopStoppedReason = job.abort.signal.aborted
      ? "aborted"
      : "error";
    const snapshot = snapshotDiffstat(fileStats, readonly);
    finishSubagentJob(
      job.id,
      job.abort.signal.aborted ? "killed" : "exited",
      summary,
      { oracle: "skipped", files: snapshot.filesTouched },
    );
    input.onProgress?.({
      type: "end",
      jobId: job.id,
      stoppedReason,
    });
    return emptySubagentResult({
      profile,
      jobId: job.id,
      summary,
      filesTouched: snapshot.filesTouched,
      diffstat: snapshot.diffstat,
      oracle: "skipped",
      stoppedReason,
    });
  } finally {
    parentAbort?.removeEventListener("abort", onParentAbort);
  }
}
