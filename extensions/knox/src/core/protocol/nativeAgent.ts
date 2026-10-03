import type { ChatHistoryItem, ChatMessage, Tool, ToolCallDelta } from "../";

/** Settled or pending tool call, as the native pane knows it. */
export interface NativeDoomLoopCall {
  name: string;
  args?: unknown;
  output?: string;
  ok?: boolean;
}

export interface NativeAgentRequestInput {
  history: ChatHistoryItem[];
  sessionId: string;
  /** Memory / restore inject cached for this turn; merged into the leading system message. */
  injectedContext?: string;
  /** Agent mode and the selected model supports tools. */
  includeTools: boolean;
  toolSettings?: Record<string, string>;
  excludedGroups?: string[];
  /** Native web search is on, or no realTimeSearch model: drop builtin_search_web. */
  dropSearchWeb?: boolean;
  /** K-021: send a core tool set plus `builtin_tool_search` instead of every tool. */
  deferTools?: boolean;
  /** Completed tool→continue rounds this turn. */
  toolLoopSteps?: number;
  /** Settled calls after the latest user message. */
  turnToolCalls?: NativeDoomLoopCall[];
}

export interface NativeAgentRequestOutput {
  messages: ChatMessage[];
  tools: Tool[];
  /** K-021: tools reachable through `builtin_tool_search` (not in `tools`). */
  deferredTools?: Tool[];
  maxSteps: number | null;
  /** Tools were withheld because the max-steps budget is spent. */
  atMaxSteps: boolean;
  /** Tools were withheld because the settled calls already form a doom loop. */
  doomLoop?: { kind: string; toolName?: string; count: number };
}

export interface NativeDoomLoopInput {
  turnToolCalls: NativeDoomLoopCall[];
  pending: NativeDoomLoopCall;
}

export interface NativeDoomLoopOutput {
  /** Tool output to write instead of running the call, when it would loop. */
  blockedMessage?: string;
  kind?: string;
  toolName?: string;
}

export interface NativeToolPolicyInput {
  toolName: string;
  args?: unknown;
  permissionMode: string;
  toolSettings?: Record<string, string>;
  sessionAllowlist?: string[];
}

export interface NativeToolPolicyOutput {
  /** Config/rule policy denies this call outright, even in fullAuto. */
  hardDeny: boolean;
  /** Runs without the approval UI (`isToolAutoApproved`). */
  autoApproved: boolean;
  /** Policy reason when `hardDeny`. */
  reason?: string;
}

export interface NativeStartTurnInput {
  sessionId: string;
  title: string;
  userMessage: string;
}

export interface NativeStartTurnOutput {
  memoryBuildTimeoutMs: number;
}

export interface NativeTurnTool {
  name: string;
  status: string;
  args?: unknown;
}

export interface NativeHydrateAssistantInput {
  content: string;
  toolCalls?: ToolCallDelta[];
}

export interface NativeHydrateAssistantOutput {
  /** Content with DSML/XML tool markup removed. */
  content: string;
  /** Streamed calls when present, else calls parsed from the text. */
  toolCalls: ToolCallDelta[];
}

export interface NativeFinishTurnInput {
  sessionId: string;
  title: string;
  userMessage: string;
  assistantMessage: string;
  turnTools: NativeTurnTool[];
}

/** `knox/runChatTurn` payload: what the GUI used to spread over several round trips. */
export interface SharedChatTurnInput
  extends Pick<
    NativeAgentRequestInput,
    | "history"
    | "sessionId"
    | "injectedContext"
    | "includeTools"
    | "toolSettings"
    | "excludedGroups"
    | "dropSearchWeb"
  > {
  modelTitle: string;
  viewReadModelTitle?: string | null;
  realTimeSearchModelTitle?: string | null;
  permissionMode?: string;
  sessionAllowlist?: string[];
  /** Per-request model options the GUI sets (`llm/streamChat` completionOptions). */
  completionOptions?: { reasoningEffort?: string; webSearch?: boolean };
  /** Id of the user message that started the turn (checkpoint / soul grouping). */
  turnId?: string;
  /** Settled calls already made this turn: seeds doom-loop detection on resume. */
  turnToolCalls?: NativeDoomLoopCall[];
  /** Rounds already used this turn (before an ask_user answer); counts against `maxSteps`. */
  priorSteps?: number;
}

export interface SharedChatTurnOutput {
  stoppedReason: string;
  steps: number;
  summary: string;
}
