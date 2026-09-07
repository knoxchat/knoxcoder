/**
 * AutonomousExecutor — one iteration of the local autonomous loop.
 *
 * With `toolRuntime` (HL-02) this runs the shared AgentLoop (real tools).
 * Without it, falls back to a text-only `complete()` (tests / no catalog).
 */

import type { ContextItem, ILLM, Tool, ToolExtras } from "../../../index.js";
import { waitForAutonomousToolApproval } from "../../../agent/autonomousApproval.js";
import { createAgentLoopCompactor, runAgentLoop } from "../../../agent/loop.js";
import {
  isHardPolicyDeny,
  isToolAutoApproved,
  type PermissionMode,
  type ToolSetting,
} from "../../../agent/permissions.js";
import { BuiltInToolNames } from "../../../tools/builtIn.js";
import { ToolCallError, ToolCallErrorCode } from "../../../tools/errors.js";
import type { AgentToolPolicy } from "../../../tools/toolPolicy.js";
import { formatPlanInject } from "../../../tools/planStore.js";
import { formatCodebaseCardInject } from "../../../context/codebaseCard.js";
import { formatSerialContextInject } from "../../../context/serialContext.js";
import { ResilientLlm } from "./LlmResilience.js";
import { TaskRouter } from "./TaskRouter.js";
import type { AutonomousStepResult } from "./LocalAutonomousLoop.js";
import {
  compactAutonomousArgs,
  compactAutonomousOutput,
  truncateAutonomousText,
} from "./autonomousEvents.js";
import type { MemoryEventType } from "./types.js";

export type ModelResolver = (modelId: string) => Promise<ILLM | null>;

export type AutonomousLoopEventSink = (
  type: MemoryEventType,
  data: Record<string, unknown>,
) => void;

/** Product-loop tools for one autonomous iteration (HL-02). */
export interface AutonomousToolRuntime {
  catalog: Tool[];
  extras: Omit<ToolExtras, "tool">;
  executeTool: (tool: Tool, args: unknown) => Promise<ContextItem[]>;
  /** Inner tool→continue cap per outer iteration. `null` / omit = unlimited. */
  maxStepsPerIteration?: number | null;
  /** Identical-tool / fail-streak cap. Default 3 (`null` disables). */
  doomLoopThreshold?: number | null;
  /** Live GUI tool cards (optional; Core wires BrainManager). */
  onEvent?: AutonomousLoopEventSink;
  sessionId?: string;
  /**
   * GUI permission overlay. Omit = YOLO (tests / no Ask bar).
   * When a tool is not auto-approved, wait for `brain/resolveAutonomousTool`.
   */
  permission?: {
    mode: PermissionMode;
    toolSettings: Record<string, ToolSetting>;
    sessionAllowlist: string[];
    policy?: AgentToolPolicy | null;
    policyFromRules?: AgentToolPolicy | null;
    workspaceDirs?: string[];
  };
}

export interface AutonomousStepContext {
  iteration: number;
  goal: string;
  memoryContext: string;
  maxIterations: number;
  sessionId: string;
  previousResults: string[];
}

const GOAL_COMPLETE_RE = /\[GOAL[_\s]?COMPLETE\]/i;
const CONFIDENCE_RE = /\[CONFIDENCE:\s*([\d.]+)\]/i;

function priorBlock(ctx: AutonomousStepContext): string {
  if (ctx.previousResults.length === 0) {
    return "";
  }
  return `\n\nPrior iteration results:\n${ctx.previousResults
    .map((r, i) => `--- Iteration ${i + 1} ---\n${r.slice(0, 1500)}`)
    .join("\n\n")}`;
}

/** `maxIterations` 0 = unlimited; do not tell the model it is at a cap. */
function iterationLabel(ctx: AutonomousStepContext): string {
  return ctx.maxIterations > 0
    ? `Iteration: ${ctx.iteration} of ${ctx.maxIterations}`
    : `Iteration: ${ctx.iteration}`;
}

function buildToolStepPrompt(ctx: AutonomousStepContext): string {
  const plan = formatPlanInject(ctx.sessionId);
  const planBlock = plan ? `\n\n${plan}\n` : "";
  const card = formatCodebaseCardInject();
  const cardBlock = card ? `\n\n${card}\n` : "";
  const serial = formatSerialContextInject();
  const serialBlock = serial ? `\n\n${serial}\n` : "";
  return `You are an autonomous coding agent. Use tools to make real progress — edit files, search, and run tests/builds. Do not only describe work.

Goal: ${ctx.goal}
${iterationLabel(ctx)}
${planBlock}${cardBlock}${serialBlock}
Relevant memory context:
${ctx.memoryContext.slice(0, 12000) || "(no prior memory)"}
${priorBlock(ctx)}

When the goal is fully achieved, end your response with [GOAL_COMPLETE].
If more iterations are needed, end with [GOAL_PARTIAL] and state what remains.
Optionally include [CONFIDENCE: 0.85] (0.0–1.0).`;
}

export function buildStepPrompt(ctx: AutonomousStepContext): string {
  return `You are an autonomous coding agent executing a multi-step plan.

Goal: ${ctx.goal}
${iterationLabel(ctx)}

Relevant memory context:
${ctx.memoryContext.slice(0, 12000) || "(no prior memory)"}
${priorBlock(ctx)}

Execute ONE focused step toward the goal. Be concrete and actionable.

When the goal is fully achieved, end your response with [GOAL_COMPLETE].
If more iterations are needed, end with [GOAL_PARTIAL] and state what remains.
Optionally include [CONFIDENCE: 0.85] (0.0–1.0) for goal completion confidence.

Respond with:
1. What you did this iteration
2. Result / findings
3. Whether the goal is complete ([GOAL_COMPLETE] or [GOAL_PARTIAL])`;
}

/** Parse LLM response into step result. */
export function parseStepResponse(
  response: string,
  ctx: AutonomousStepContext,
): AutonomousStepResult & { goalConfidence: number } {
  const trimmed = response.trim();
  const confidenceMatch = trimmed.match(CONFIDENCE_RE);
  let goalConfidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;

  const atIterationCap =
    ctx.maxIterations > 0 && ctx.iteration >= ctx.maxIterations;
  const done = GOAL_COMPLETE_RE.test(trimmed) || atIterationCap;

  if (done && !GOAL_COMPLETE_RE.test(trimmed)) {
    goalConfidence = Math.min(goalConfidence, 0.6);
  }
  if (GOAL_COMPLETE_RE.test(trimmed)) {
    goalConfidence = Math.max(goalConfidence, 0.85);
  }

  const goalLine = trimmed
    .split("\n")
    .find((l) => /^(next|remaining|sub-goal|focus):/i.test(l.trim()));
  const goal = goalLine?.replace(/^[^:]+:\s*/i, "").trim();

  return {
    done,
    result: trimmed,
    goal: goal || undefined,
    goalConfidence,
  };
}

function cancelledResult(
  llm: ILLM,
): AutonomousStepResult & { goalConfidence: number; modelUsed: string } {
  return {
    done: true,
    result: "Cancelled by user",
    goalConfidence: 0,
    modelUsed: llm.model,
  };
}

export function filterAutonomousCatalog(catalog: Tool[]): Tool[] {
  return catalog.filter(
    (tool) => tool.function.name !== BuiltInToolNames.AskUser,
  );
}

async function executeToolIteration(
  stepLlm: ILLM,
  ctx: AutonomousStepContext,
  toolRuntime: AutonomousToolRuntime,
  abortSignal?: AbortSignal,
): Promise<AutonomousStepResult & { goalConfidence: number; modelUsed: string }> {
  const toolNames: string[] = [];
  const catalog = filterAutonomousCatalog(toolRuntime.catalog);
  const sessionId = toolRuntime.sessionId ?? ctx.sessionId;
  const emit = toolRuntime.onEvent;
  const loop = await runAgentLoop({
    extras: {
      llm: stepLlm,
      abortSignal,
    },
    messages: [
      { role: "system", content: buildToolStepPrompt(ctx) },
      {
        role: "user",
        content: `Iteration ${ctx.iteration}: work toward the goal using tools.`,
      },
    ],
    tools: catalog,
    maxSteps: toolRuntime.maxStepsPerIteration,
    doomLoopThreshold: toolRuntime.doomLoopThreshold,
    holdCompletionWhileOracleRed: true,
    compact: createAgentLoopCompactor(stepLlm),
    approveTool: async (tool, args, call) => {
      const permission = toolRuntime.permission;
      if (!permission) {
        return "allow";
      }
      const callId = call.id ?? `${tool.function.name}-${toolNames.length + 1}`;
      if (
        isHardPolicyDeny({
          toolName: tool.function.name,
          args,
          policy: permission.policy,
          policyFromRules: permission.policyFromRules,
          workspaceDirs: permission.workspaceDirs,
        })
      ) {
        return "deny";
      }
      if (
        isToolAutoApproved({
          toolName: tool.function.name,
          toolSettings: permission.toolSettings,
          permissionMode: permission.mode,
          sessionAllowlist: permission.sessionAllowlist,
          args,
          policy: permission.policy,
          policyFromRules: permission.policyFromRules,
          workspaceDirs: permission.workspaceDirs,
        })
      ) {
        return "allow";
      }
      emit?.("autonomous:tool_ask", {
        session_id: sessionId,
        call_id: callId,
        name: tool.function.name,
        args: compactAutonomousArgs(args),
      });
      const decision = await waitForAutonomousToolApproval({
        sessionId,
        callId,
        abortSignal,
      });
      if (abortSignal?.aborted) {
        throw new ToolCallError({
          code: ToolCallErrorCode.CANCELLED,
          message: "cancelled",
          toolName: tool.function.name,
          retryable: false,
        });
      }
      if (decision.always) {
        const name = tool.function.name;
        if (!permission.sessionAllowlist.some((item) => item === name)) {
          permission.sessionAllowlist.push(name);
        }
      }
      if (!decision.allow) {
        emit?.("autonomous:tool_end", {
          session_id: sessionId,
          call_id: callId,
          name: tool.function.name,
          ok: false,
          output: compactAutonomousOutput([
            {
              name: "Agent",
              description: "permission-denied",
              content: "The user denied this tool call.",
            },
          ]),
        });
        return "deny";
      }
      return "allow";
    },
    executeTool: async (tool, args, call) => {
      toolNames.push(tool.function.name);
      const callId = call.id ?? `${tool.function.name}-${toolNames.length}`;
      emit?.("autonomous:tool_start", {
        session_id: sessionId,
        call_id: callId,
        name: tool.function.name,
        args: compactAutonomousArgs(args),
      });
      try {
        const output = await toolRuntime.executeTool(tool, args);
        emit?.("autonomous:tool_end", {
          session_id: sessionId,
          call_id: callId,
          name: tool.function.name,
          ok: true,
          output: compactAutonomousOutput(output),
        });
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit?.("autonomous:tool_end", {
          session_id: sessionId,
          call_id: callId,
          name: tool.function.name,
          ok: false,
          output: compactAutonomousOutput([
            {
              name: "Tool Call Error",
              description: "failed",
              content: message,
            },
          ]),
        });
        throw error;
      }
    },
    onStep: async (step) => {
      const text = truncateAutonomousText(
        typeof step.assistant.content === "string" ? step.assistant.content : "",
      );
      if (text.trim()) {
        emit?.("autonomous:assistant", {
          session_id: sessionId,
          content: text,
        });
      }
    },
  });

  if (loop.stoppedReason === "aborted" || abortSignal?.aborted) {
    return cancelledResult(stepLlm);
  }

  if (loop.stoppedReason === "doom_loop") {
    const summary = truncateAutonomousText(loop.summary);
    emit?.("autonomous:assistant", {
      session_id: sessionId,
      content: summary,
    });
    return {
      done: false,
      result: `${summary}\n\n[GOAL_PARTIAL] Stopped: doom-loop.`,
      goalConfidence: 0.4,
      modelUsed: stepLlm.model,
    };
  }

  const summary = truncateAutonomousText(loop.summary);
  if (summary.trim()) {
    emit?.("autonomous:assistant", {
      session_id: sessionId,
      content: summary,
    });
  }

  const trace =
    toolNames.length > 0 ? `\n\nTools used: ${toolNames.join(", ")}` : "";
  const parsed = parseStepResponse(`${loop.summary}${trace}`, ctx);
  if (loop.stoppedReason !== "completed") {
    return {
      ...parsed,
      done: false,
      result: `${parsed.result}\n\n[GOAL_PARTIAL] Stopped: ${loop.stoppedReason}. Oracle may still be red.`,
      modelUsed: stepLlm.model,
    };
  }
  return {
    ...parsed,
    modelUsed: stepLlm.model,
  };
}

/** Run one autonomous iteration via tools (preferred) or text-only complete. */
export async function executeAutonomousStep(
  llm: ILLM,
  ctx: AutonomousStepContext,
  resolveModel?: ModelResolver,
  abortSignal?: AbortSignal,
  toolRuntime?: AutonomousToolRuntime,
): Promise<AutonomousStepResult & { goalConfidence: number; modelUsed: string }> {
  if (abortSignal?.aborted) {
    return cancelledResult(llm);
  }

  const route = TaskRouter.scoreAndRoute({
    message: ctx.goal + "\n" + ctx.memoryContext,
    toolCount: toolRuntime?.catalog.length ?? 0,
  });

  let stepLlm = llm;
  if (route.modelId && resolveModel) {
    const resolved = await resolveModel(route.modelId);
    if (resolved) {
      stepLlm = resolved;
    }
  }

  if (toolRuntime?.catalog.length) {
    return executeToolIteration(stepLlm, ctx, toolRuntime, abortSignal);
  }

  const prompt = buildStepPrompt(ctx);
  let response: string;
  try {
    response = await ResilientLlm.complete(stepLlm, prompt, {
      maxTokens: 4096,
      abortSignal,
    });
  } catch (err) {
    if (
      abortSignal?.aborted ||
      (err instanceof DOMException && err.name === "AbortError")
    ) {
      return cancelledResult(stepLlm);
    }
    throw err;
  }

  return {
    ...parseStepResponse(response, ctx),
    modelUsed: stepLlm.model,
  };
}

export const AutonomousExecutor = {
  executeAutonomousStep,
  parseStepResponse,
  buildStepPrompt,
  filterAutonomousCatalog,
};
