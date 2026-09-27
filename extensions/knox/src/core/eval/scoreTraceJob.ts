/**
 * Offline Jev scoring of eval results / GUI session JSON.
 *
 * Never import this from golden CI tests. Flag off by default; needs
 * Knox Chat API key (knoxchat model or `jev.apiKey` in config.yaml).
 * Mock the client in unit tests.
 */

import type { ChatHistoryItem, ChatMessage } from "..";
import {
  scoreAgentTrace,
  type AgentTraceStep,
  type ScoreAgentTraceInput,
  type TraceScoreResult,
} from "../jev/traceScore";
import type { JevClient, JevRuntime } from "../jev/types";
import type { AgentEvalResult, EvalToolTrace } from "./harness";

function messageText(message: ChatMessage | undefined): string {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join(" ");
  }
  return "";
}

function stepsFromEvalTrace(trace: EvalToolTrace[]): AgentTraceStep[] {
  return trace.map((item) => ({
    name: item.name,
    args: item.args,
    ok: item.ok,
    output: item.output || item.error || "",
  }));
}

function stepsFromHistory(history: ChatHistoryItem[]): AgentTraceStep[] {
  const steps: AgentTraceStep[] = [];
  for (const item of history) {
    const states =
      item.toolCallStates ??
      (item.toolCallState ? [item.toolCallState] : []);
    for (const state of states) {
      const output = (state.output ?? [])
        .map((ctx) => ctx.content ?? "")
        .join("\n");
      steps.push({
        name: state.toolCall.function.name,
        args: state.parsedArgs,
        ok: state.status === "done",
        output,
      });
    }
  }
  return steps;
}

function firstUserMessage(history: ChatHistoryItem[]): string {
  for (const item of history) {
    if (item.message.role === "user") {
      return messageText(item.message);
    }
  }
  return "";
}

export function traceInputFromEvalResult(
  result: AgentEvalResult,
  userMessage: string,
): ScoreAgentTraceInput {
  return {
    userMessage,
    steps: stepsFromEvalTrace(result.toolTrace),
    stoppedReason: result.stoppedReason,
    summary: result.summary,
  };
}

export function traceInputFromSession(session: {
  history?: ChatHistoryItem[];
  title?: string;
}): ScoreAgentTraceInput {
  const history = session.history ?? [];
  return {
    userMessage: firstUserMessage(history) || session.title || "",
    steps: stepsFromHistory(history),
  };
}

export function traceInputFromUnknown(
  payload: unknown,
  userMessage = "",
): ScoreAgentTraceInput | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.toolTrace)) {
    return traceInputFromEvalResult(
      record as unknown as AgentEvalResult,
      userMessage ||
        (typeof record.prompt === "string" ? record.prompt : "") ||
        (typeof record.userMessage === "string" ? record.userMessage : ""),
    );
  }
  if (Array.isArray(record.history)) {
    return traceInputFromSession({
      history: record.history as ChatHistoryItem[],
      title: typeof record.title === "string" ? record.title : undefined,
    });
  }
  if (Array.isArray(record.steps) && typeof record.userMessage === "string") {
    return {
      userMessage: record.userMessage,
      steps: record.steps as AgentTraceStep[],
      stoppedReason:
        typeof record.stoppedReason === "string"
          ? record.stoppedReason
          : undefined,
      summary: typeof record.summary === "string" ? record.summary : undefined,
      oracleSummary:
        typeof record.oracleSummary === "string"
          ? record.oracleSummary
          : undefined,
    };
  }
  return undefined;
}

/** Score a live eval result or GUI session. Not for `npm test` goldens. */
export async function scoreEvalTrace(
  payload: unknown,
  options?: {
    userMessage?: string;
    runtime?: JevRuntime;
    client?: JevClient;
  },
): Promise<TraceScoreResult | undefined> {
  const input = traceInputFromUnknown(payload, options?.userMessage);
  if (!input) {
    return undefined;
  }
  return scoreAgentTrace({
    ...input,
    runtime: options?.runtime,
    client: options?.client,
  });
}

/** Read a session / eval JSON file and score it. Not for CI goldens. */
export async function scoreTraceFile(
  filePath: string,
  options?: {
    userMessage?: string;
    runtime?: JevRuntime;
    client?: JevClient;
  },
): Promise<TraceScoreResult | undefined> {
  const { readFile } = await import("node:fs/promises");
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
  return scoreEvalTrace(payload, options);
}
