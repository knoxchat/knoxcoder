/**
 * Optional offline scoring of agent traces (eval live jobs / session JSON).
 *
 * Never call this from CI goldens. Fail-open to an empty heuristic.
 */

import { createKnoxLogger } from "../util/knoxLog";
import { asChoice, asNoul } from "./answers";
import { resolveJevClient } from "./client";
import { getActiveJevRuntime } from "./config";
import {
  DOOM_ARGS_MAX_CHARS,
  DOOM_OUTPUT_HEAD_CHARS,
  testTamperQuestion,
  toolCallsMatchRequestQuestion,
  traceOutcomeQuestion,
  oracleIgnoredQuestion,
  type JevTraceOutcome,
} from "./questions";
import type { JevClient, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

export interface AgentTraceStep {
  name: string;
  args?: unknown;
  ok?: boolean;
  output?: string;
}

export interface TraceScoreResult {
  source: "jev" | "heuristic";
  toolCallsMatchRequest: number;
  oracleIgnored: number;
  testTamper: number;
  outcome?: JevTraceOutcome;
  confidence: number;
  reason: string;
}

export interface ScoreAgentTraceInput {
  userMessage: string;
  steps: AgentTraceStep[];
  stoppedReason?: string;
  summary?: string;
  oracleSummary?: string;
  runtime?: JevRuntime;
  client?: JevClient;
  abortSignal?: AbortSignal;
}

const SKIPPED: TraceScoreResult = {
  source: "heuristic",
  toolCallsMatchRequest: 0,
  oracleIgnored: 0,
  testTamper: 0,
  confidence: 0,
  reason: "Jev trace scoring skipped",
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function argsPreview(args: unknown): string {
  try {
    return truncate(JSON.stringify(args ?? {}), DOOM_ARGS_MAX_CHARS);
  } catch {
    return "{}";
  }
}

export async function scoreAgentTrace(
  input: ScoreAgentTraceInput,
): Promise<TraceScoreResult> {
  const runtime = input.runtime ?? getActiveJevRuntime();
  const client = resolveJevClient(runtime, input.client);
  if (!runtime.enabled || !client) {
    return SKIPPED;
  }

  try {
    const result = await client.systemOne(
      {
        model: runtime.model,
        state: {
          user_message: input.userMessage.slice(0, 4_000),
          stopped_reason: input.stoppedReason ?? "",
          summary: (input.summary ?? "").slice(0, 2_000),
          oracle_summary: (input.oracleSummary ?? "").slice(0, 1_500),
          steps: input.steps.slice(0, 24).map((step) => ({
            name: step.name,
            args: argsPreview(step.args),
            ok: step.ok !== false,
            output_head: truncate(step.output ?? "", DOOM_OUTPUT_HEAD_CHARS),
          })),
        },
        questions: {
          tool_calls_match_request: toolCallsMatchRequestQuestion(),
          oracle_ignored: oracleIgnoredQuestion(),
          test_tamper: testTamperQuestion(),
          outcome: traceOutcomeQuestion(),
        },
      },
      { signal: input.abortSignal, timeoutMs: runtime.timeoutMs },
    );

    const match = asNoul(result.answers, "tool_calls_match_request")?.noul ?? 0;
    const oracle = asNoul(result.answers, "oracle_ignored")?.noul ?? 0;
    const tamper = asNoul(result.answers, "test_tamper")?.noul ?? 0;
    const outcome = asChoice(result.answers, "outcome");
    const scored: TraceScoreResult = {
      source: "jev",
      toolCallsMatchRequest: match,
      oracleIgnored: oracle,
      testTamper: tamper,
      outcome: outcome?.choice as JevTraceOutcome | undefined,
      confidence: outcome?.confidence ?? 0,
      reason: `outcome=${outcome?.choice ?? "?"} match=${match.toFixed(2)} oracle_ignored=${oracle.toFixed(2)} test_tamper=${tamper.toFixed(2)}`,
    };
    log.info(`trace ${scored.reason}`);
    return scored;
  } catch (error) {
    if (!runtime.failOpen) {
      throw error;
    }
    log.warn(
      `trace score failed open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return SKIPPED;
  }
}
