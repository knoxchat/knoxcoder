import {
  ChatMessage,
  ContextItem,
  Tool,
  ToolExtras,
} from "../..";

import {
  runAgentLoop,
  createAgentLoopCompactor,
  type AgentLoopStoppedReason,
} from "../../agent/loop";
import {
  DEFAULT_DOOM_LOOP_THRESHOLD,
  SYSTEMS_DOOM_LOOP_THRESHOLD,
} from "../../config/agentProfile";
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

export interface SubagentRunResult {
  /** Built-in profile, or the custom agent name. */
  profile: string;
  jobId?: string;
  steps: number;
  summary: string;
  filesTouched: string[];
  stoppedReason: AgentLoopStoppedReason;
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

function collectTouchedPaths(args: unknown, into: Set<string>): void {
  if (!args || typeof args !== "object") {
    return;
  }
  const record = args as Record<string, unknown>;
  for (const key of ["filepath", "path", "directory_path", "target_directory"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      into.add(value.trim());
    }
  }
}

export function formatSubagentResult(result: SubagentRunResult): string {
  const files =
    result.filesTouched.length > 0
      ? result.filesTouched.join(", ")
      : "(none recorded)";
  return [
    `## Subagent (${result.profile})`,
    `Steps: ${result.steps}`,
    `Stopped: ${result.stoppedReason}`,
    `Files touched: ${files}`,
    "",
    result.summary.trim() || "(no summary)",
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
  const filesTouched = new Set<string>();
  const prompt = input.prompt.trim();

  if (!prompt) {
    return {
      profile,
      steps: 0,
      summary: "Subagent prompt was empty.",
      filesTouched: [],
      stoppedReason: "error",
    };
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
      missingToolMessage: (name) =>
        `Tool "${name}" is not available to this ${profile} subagent.`,
      executeTool: async (tool, args) => {
        collectTouchedPaths(args, filesTouched);
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

    const result: SubagentRunResult = {
      profile,
      steps: loop.steps,
      summary: loop.summary,
      jobId: job.id,
      filesTouched: [...filesTouched],
      stoppedReason,
    };
    input.onProgress?.({ type: "end", jobId: job.id, stoppedReason });
    finishSubagentJob(
      job.id,
      stoppedReason === "aborted" ? "killed" : "exited",
      result.summary,
    );
    return result;
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    finishSubagentJob(
      job.id,
      job.abort.signal.aborted ? "killed" : "exited",
      summary,
    );
    input.onProgress?.({
      type: "end",
      jobId: job.id,
      stoppedReason: job.abort.signal.aborted ? "aborted" : "error",
    });
    return {
      profile,
      jobId: job.id,
      steps: 0,
      summary,
      filesTouched: [...filesTouched],
      stoppedReason: job.abort.signal.aborted ? "aborted" : "error",
    };
  } finally {
    parentAbort?.removeEventListener("abort", onParentAbort);
  }
}
