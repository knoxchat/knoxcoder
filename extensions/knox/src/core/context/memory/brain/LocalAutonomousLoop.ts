/**
 * LocalAutonomousLoop — Multi-step agent loop with memory integration (IMP-24).
 *
 * Local-only: plan → execute → evaluate → update memory each iteration.
 * Checkpoints via CheckpointManager. No Knox /api/knox-ms/autonomous/* calls.
 */

import { CheckpointManager } from "./CheckpointManager.js";
import { MemoryPipeline } from "./MemoryPipeline.js";
import { getMemoryConfig } from "./memoryConfigAccess.js";
import { PrefrontalCortex } from "./regions/PrefrontalCortex.js";
import type { ModelResolver, AutonomousToolRuntime } from "./AutonomousExecutor.js";
import { rejectAutonomousApprovals } from "../../../agent/autonomousApproval.js";

let _BrainManager: any = null;
async function getBrainManager() {
  if (!_BrainManager) {
    const mod = await import("./BrainManager.js");
    _BrainManager = mod.BrainManager;
  }
  return _BrainManager;
}

export interface AutonomousStepResult {
  done: boolean;
  result: string;
  /** Optional updated goal for next iteration */
  goal?: string;
  /** Goal completion confidence 0.0–1.0 */
  goalConfidence?: number;
}

export type AutonomousStepExecutor = (params: {
  iteration: number;
  goal: string;
  context: string;
  maxIterations: number;
  abortSignal?: AbortSignal;
}) => Promise<AutonomousStepResult>;

export interface AutonomousLoopInput {
  session_id: string;
  goal: string;
  max_iterations?: number;
  /** Called each iteration with assembled memory context. Must return done=true to stop. */
  executeStep?: AutonomousStepExecutor;
  /** Resolve easy/medium/hard model IDs from MemoryConfig (IMP-17). */
  resolveModel?: ModelResolver;
  /** Optional callback for live status (used by GUI bridge). */
  onStatus?: (status: AutonomousLoopStatus) => void;
  /** Workspace file checkpoint after each iteration (VS Code host). */
  ensureWorkspaceCheckpoint?: (
    iteration: number,
  ) => Promise<string | undefined>;
  /** When set, the default executor runs the shared AgentLoop with real tools (HL-02). */
  toolRuntime?: AutonomousToolRuntime;
}

export interface AutonomousLoopStatus {
  session_id: string;
  goal: string;
  iteration: number;
  max_iterations: number;
  running: boolean;
  last_result?: string;
  checkpoints_created: number;
  started_at: string;
}

export interface AutonomousLoopResult {
  success: boolean;
  iterations: number;
  final_result: string;
  cancelled: boolean;
  checkpoints_created: number;
}

interface ActiveLoop {
  abort: AbortController;
  status: AutonomousLoopStatus;
  previousResults: string[];
}

/** 0 / unset = unlimited. Stop with Cancel. */
export function resolveAutonomousMaxIterations(raw: unknown): number | null {
  if (raw === 0) {
    return null;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return null;
}

export class LocalAutonomousLoop {
  private static activeLoops = new Map<string, ActiveLoop>();

  static isRunning(sessionId: string): boolean {
    return LocalAutonomousLoop.activeLoops.has(sessionId);
  }

  static getStatus(sessionId: string): AutonomousLoopStatus | null {
    return LocalAutonomousLoop.activeLoops.get(sessionId)?.status ?? null;
  }

  static cancel(sessionId: string): boolean {
    const loop = LocalAutonomousLoop.activeLoops.get(sessionId);
    if (!loop) return false;
    rejectAutonomousApprovals(sessionId);
    loop.abort.abort();
    return true;
  }

  /**
   * Run the autonomous loop until done, max iterations, or cancelled.
   * `max_iterations` 0 / unset = unlimited; stop with Cancel.
   */
  static async run(input: AutonomousLoopInput): Promise<AutonomousLoopResult> {
    const cfg = getMemoryConfig();
    const maxIterations = resolveAutonomousMaxIterations(
      input.max_iterations ?? cfg.autonomous_max_iterations,
    );
    const BrainManager = await getBrainManager();

    if (LocalAutonomousLoop.activeLoops.has(input.session_id)) {
      throw new Error(`Autonomous loop already running for session ${input.session_id}`);
    }

    // Build default LLM executor when none provided
    let executeStep = input.executeStep;
    if (!executeStep) {
      const llm = input.toolRuntime?.extras.llm ?? BrainManager.getLlm();
      if (!llm) {
        throw new Error("No LLM configured — set a chat model before running autonomous loop");
      }
      const { executeAutonomousStep } = await import("./AutonomousExecutor.js");
      executeStep = async ({ iteration, goal, context, maxIterations: max, abortSignal }) => {
        const loop = LocalAutonomousLoop.activeLoops.get(input.session_id);
        if (abortSignal?.aborted) {
          return { done: true, result: "Cancelled by user" };
        }
        if (input.toolRuntime) {
          input.toolRuntime.extras.abortSignal = abortSignal;
        }
        const step = await executeAutonomousStep(
          llm,
          {
            iteration,
            goal,
            memoryContext: context,
            maxIterations: max,
            sessionId: input.session_id,
            previousResults: loop?.previousResults ?? [],
          },
          input.resolveModel,
          abortSignal,
          input.toolRuntime,
        );
        return step;
      };
    }

    const abort = new AbortController();
    const statusCap = maxIterations ?? 0;
    const status: AutonomousLoopStatus = {
      session_id: input.session_id,
      goal: input.goal,
      iteration: 0,
      max_iterations: statusCap,
      running: true,
      checkpoints_created: 0,
      started_at: new Date().toISOString(),
    };
    LocalAutonomousLoop.activeLoops.set(input.session_id, {
      abort,
      status,
      previousResults: [],
    });

    const notify = () => input.onStatus?.({ ...status });

    PrefrontalCortex.switchSession(input.session_id);
    PrefrontalCortex.setGoal(input.goal, input.session_id);
    BrainManager.publishEvent("autonomous:started", {
      session_id: input.session_id,
      goal: input.goal,
      max_iterations: statusCap,
    });

    let finalResult = "";
    let cancelled = false;
    let checkpointsCreated = 0;

    try {
      for (let i = 1; maxIterations === null || i <= maxIterations; i++) {
        if (abort.signal.aborted) {
          cancelled = true;
          break;
        }

        status.iteration = i;
        notify();
        BrainManager.publishEvent("autonomous:iteration", {
          session_id: input.session_id,
          iteration: i,
          max_iterations: statusCap,
        });

        // Pre-turn memory pipeline (φ₁–φ₃, φ₆, φ₈)
        const preTurn = await MemoryPipeline.runPreTurn({
          message: input.goal,
          session_id: input.session_id,
          goal: PrefrontalCortex.getGoal(input.session_id) ?? input.goal,
        });

        if (abort.signal.aborted) {
          cancelled = true;
          break;
        }

        const context = preTurn.context?.context ?? "";

        // Execute one agent step (caller-provided)
        const step = await executeStep({
          iteration: i,
          goal: PrefrontalCortex.getGoal(input.session_id) ?? input.goal,
          context,
          maxIterations: statusCap,
          abortSignal: abort.signal,
        });

        if (abort.signal.aborted) {
          cancelled = true;
          break;
        }

        finalResult = step.result;
        status.last_result = step.result;
        LocalAutonomousLoop.activeLoops.get(input.session_id)?.previousResults.push(step.result);
        notify();

        if (step.goal) {
          PrefrontalCortex.setGoal(step.goal, input.session_id);
          status.goal = step.goal;
        }

        // Post-turn memory pipeline (φ₄–φ₅)
        await MemoryPipeline.runPostTurn({
          message: step.result,
          session_id: input.session_id,
          role: "assistant",
          turn_content: `${input.goal}\n${step.result}`,
        });

        // Memory snapshot (adaptive) plus a workspace file CP when the host can.
        const cp = await CheckpointManager.recordChange();
        if (cp) {
          checkpointsCreated++;
          status.checkpoints_created = checkpointsCreated;
        }
        if (input.ensureWorkspaceCheckpoint) {
          try {
            const workspaceCp = await input.ensureWorkspaceCheckpoint(i);
            if (workspaceCp) {
              checkpointsCreated++;
              status.checkpoints_created = checkpointsCreated;
            }
          } catch {
            // Memory checkpoint already recorded; file CP is best-effort.
          }
        }

        if (step.done) break;
      }
    } finally {
      status.running = false;
      LocalAutonomousLoop.activeLoops.delete(input.session_id);

      if (cancelled) {
        BrainManager.publishEvent("autonomous:cancelled", {
          session_id: input.session_id,
          iteration: status.iteration,
        });
      } else {
        BrainManager.publishEvent("autonomous:completed", {
          session_id: input.session_id,
          iterations: status.iteration,
          final_result: finalResult.slice(0, 500),
        });
      }
    }

    return {
      success: !cancelled && status.iteration > 0,
      iterations: status.iteration,
      final_result: finalResult,
      cancelled,
      checkpoints_created: checkpointsCreated,
    };
  }
}
