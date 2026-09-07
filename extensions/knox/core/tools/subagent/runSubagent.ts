import {
  ChatMessage,
  ContextItem,
  Tool,
  ToolExtras,
} from "../..";

import { runAgentLoop, createAgentLoopCompactor } from "../../agent/loop";
import {
  DEFAULT_DOOM_LOOP_THRESHOLD,
  SYSTEMS_DOOM_LOOP_THRESHOLD,
} from "../../config/agentProfile";
import { formatCodebaseCardInject } from "../../context/codebaseCard";
import { formatRustPolicyInject } from "../../context/rustPolicy";
import { formatSerialContextInject } from "../../context/serialContext";
import {
  formatMatchedSkillsHint,
  matchSkillsByIntent,
} from "../../skills/skillMatcher";
import { formatPlanInject } from "../planStore";
import { getSkillManager } from "../implementations/skillSingleton";

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
}

export interface SubagentRunResult {
  profile: SubagentProfile;
  steps: number;
  summary: string;
  filesTouched: string[];
  stoppedReason: "completed" | "max_steps" | "aborted" | "error" | "doom_loop";
}

/**
 * Parent transcript stays isolated, but the child still needs the same
 * development-loop oracles as `/autonomous`: plan, kernel/QEMU card, serial
 * tail, and skill names for the assigned prompt.
 */
export function buildSubagentContextBlock(input: {
  prompt: string;
  sessionId?: string;
}): string {
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
      const hint = formatMatchedSkillsHint(
        matchSkillsByIntent(input.prompt, manager.all(), {
          limit: 2,
          minScore: 0.18,
        }),
      );
      if (hint) {
        parts.push(hint);
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
  const profile = resolveSubagentProfile(input.profile);
  const maxSteps = resolveSubagentMaxSteps(profile, input.maxSteps, {
    systems: input.systems,
  });
  const tools = toolsForSubagentProfile(profile, input.catalog);
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

    const loopState = buildSubagentContextBlock({
      prompt,
      sessionId,
    });
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `${subagentSystemPrompt(profile)}${memoryBlock}${loopState}`,
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
      filesTouched: [...filesTouched],
      stoppedReason,
    };
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
    return {
      profile,
      steps: 0,
      summary,
      filesTouched: [...filesTouched],
      stoppedReason: job.abort.signal.aborted ? "aborted" : "error",
    };
  } finally {
    parentAbort?.removeEventListener("abort", onParentAbort);
  }
}
