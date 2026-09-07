import { ChatHistoryItem, ToolCallState } from "core";
import {
  buildDoomLoopBlockedMessage,
  buildDoomLoopSummaryInstruction,
  canonicalizeToolArgs,
  detectDoomLoop as detectDoomLoopFromCalls,
  fingerprintToolCall as fingerprintToolCallCore,
  isFailedToolOutput,
  isRebuildToolName,
  REBUILD_TOOL_NAMES,
  type DoomLoopCall,
  type DoomLoopHit,
  type DoomLoopKind,
} from "core/agent/doomLoop";
import {
  DEFAULT_DOOM_LOOP_THRESHOLD,
  resolveAgentProfile,
  resolveDoomLoopThreshold as resolveFromProfile,
} from "core/config/agentProfile";

import { getHistoryToolStates } from "./index";

export {
  buildDoomLoopBlockedMessage,
  buildDoomLoopSummaryInstruction,
  canonicalizeToolArgs,
  DEFAULT_DOOM_LOOP_THRESHOLD,
  isRebuildToolName,
  REBUILD_TOOL_NAMES,
};
export type { DoomLoopHit, DoomLoopKind };

export function fingerprintToolCall(
  state: Pick<ToolCallState, "toolCall" | "parsedArgs">,
): string {
  return fingerprintToolCallCore(
    state.toolCall.function.name,
    state.parsedArgs ?? state.toolCall.function.arguments,
  );
}

export function isFailedToolCall(state: ToolCallState): boolean {
  return isFailedToolOutput(state.output);
}

function toolStateToCall(state: ToolCallState): DoomLoopCall {
  return {
    name: state.toolCall.function.name,
    args: state.parsedArgs ?? state.toolCall.function.arguments,
    output: (state.output ?? []).map((item) => item.content ?? "").join("\n"),
    items: state.output,
  };
}

type HistoryLike = Pick<ChatHistoryItem, "message" | "toolCallState"> & {
  toolCallStates?: ToolCallState[];
};

/**
 * Settled tool calls after the latest user message, in conversation order.
 */
export function collectTurnToolCalls(history: HistoryLike[]): ToolCallState[] {
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user") {
      lastUser = i;
      break;
    }
  }

  const settled: ToolCallState[] = [];
  for (let i = lastUser + 1; i < history.length; i++) {
    for (const state of getHistoryToolStates(history[i] as ChatHistoryItem)) {
      if (state.status === "done" || state.status === "canceled") {
        settled.push(state);
      }
    }
  }
  return settled;
}

export function resolveDoomLoopThreshold(
  raw: unknown,
  profile: unknown = "default",
): number | null {
  return resolveFromProfile(raw, resolveAgentProfile(profile));
}

export function detectDoomLoop(
  history: HistoryLike[],
  options?: {
    pending?: ToolCallState[];
    threshold?: number | null;
  },
): DoomLoopHit | null {
  const calls = [
    ...collectTurnToolCalls(history),
    ...(options?.pending ?? []),
  ].map(toolStateToCall);
  return detectDoomLoopFromCalls(calls, { threshold: options?.threshold });
}
