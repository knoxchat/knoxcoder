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
  /** Alt-submit / noContext: skip the Turn Context editor-state block. */
  skipTurnContext?: boolean;
  /** Plan mode: read-only catalog plus builtin_plan / ask_user / explore task. */
  planMode?: boolean;
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
  /** Chat permission bar (`Ask` forces recipe confirmation). */
  permissionMode?: "default" | "acceptEdits" | "fullAuto";
}

export interface NativeStartTurnOutput {
  memoryBuildTimeoutMs: number;
  /** Present only when `knoxchat.recipes.enabled` (MC-24). */
  recipeDecision?: import("../agent/recipeDecisionTurn").RecipeDecisionEvent;
  /** Worked example for the prompt when a recipe matched (suggest/adapt/exact). Redacted and capped. */
  recipeHint?: string;
}

export interface RecipePreviewOutput {
  recipeId: string;
  allowed: boolean;
  refusal?: string;
  drifted: boolean;
  conflicts: string[];
  files: number;
  added: number;
  removed: number;
  /** `formatReplayPreview` text: summary lines then diffs. */
  text: string;
  /** Structured files for the ask card (partial apply / extra-file approval). */
  entries?: { path: string; action: string; extra?: boolean }[];
}

export interface RecipeReplayOutput {
  status: "applied" | "refused" | "drifted" | "failed_verify" | "failed_apply";
  recipeId: string;
  checkpointId?: string;
  restored: boolean;
  reason?: string;
  appliedPaths: string[];
  /** Text for the model when the replay did not land (`replayFailureContext`). */
  failureContext?: string;
  /** Adapt `what-if/*` branch, when one was forked. */
  whatIfBranch?: string;
}

/** Why the last qualifying turn did not become a recipe (host capture skip). */
export type RecipeCaptureSkipReason =
  | "no_session"
  | "no_turn_mark"
  | "history_truncated"
  | "no_mutation"
  | "no_oracle"
  | "oracle_failed"
  | "no_checkpoint"
  | "no_changes"
  | "too_many_files"
  | "secret_detected"
  | "no_intent"
  | "delete_not_replayable"
  | "user_refused"
  | "too_large"
  | "disabled"
  | "error";

/** MC-70: last `knox/finishTurn` capture attempt, so the Recipes tab can explain an empty list. */
export interface RecipeCaptureOutcome {
  captured: boolean;
  created?: boolean;
  recipeId?: string;
  title?: string;
  status?: RecipeListItem["status"];
  reason?: RecipeCaptureSkipReason;
  at: string;
}

/** Last turn's matcher decision, including near-misses that were not replayed. */
export interface RecipeMatchOutcome {
  mode: "exact" | "adapt" | "suggest" | "generate";
  why: string;
  title?: string;
  score?: number;
  replayable: boolean;
  at: string;
}

/** MC-70: Memory page "Recipes" tab payload. */
export interface RecipeListOutput {
  recipes: RecipeListItem[];
  lastCapture?: RecipeCaptureOutcome;
  /** Newest last; capped. Explains more than the single last attempt. */
  lastCaptures?: RecipeCaptureOutcome[];
  lastMatch?: RecipeMatchOutcome;
}

/** MC-70: one row of the Memory page "Recipes" tab. No file bytes. */
export interface RecipeListItem {
  id: string;
  title: string;
  status: "candidate" | "verified" | "quarantined" | "retired";
  scope: "project" | "global";
  /** Replays attempted. */
  uses: number;
  ok: number;
  reverted: number;
  failedVerify: number;
  files: number;
  oracleKind?: string;
  oracleCommand?: string;
  /** Checkpoints that hold the recipe's bytes. */
  sourceCheckpointIds: string[];
  lastReplayedAt?: string;
  updatedAt: string;
  /** Verified with enough clean replays to offer "Promote to skill" (MC-42). */
  skillEligible?: boolean;
  intentText?: string;
  intentFingerprint?: string;
  familyId?: string;
  slots?: { name: string; kind: string; examples?: string[] }[];
  slotValues?: Record<string, string>;
  preconditions?: { kind: string; value: string }[];
  steps?: { kind: string; path?: string; command?: string }[];
  memoryId?: number;
  sourceSessionId?: string;
  pinned?: boolean;
  notes?: string;
  captureCount?: number;
}

export interface RecipePatchInput {
  recipeId: string;
  title?: string;
  notes?: string;
  pinned?: boolean;
  slots?: { name: string; kind: "identifier" | "path" | "package" | "text"; examples?: string[] }[];
  userPreconditions?: { kind: string; value: string }[];
  scope?: "project" | "global";
  /** Required when `scope` is `global`. */
  consent?: boolean;
}

export interface RecipePatchOutput {
  ok: boolean;
  reason?: "not_found" | "not_allowed" | "needs_consent" | "needs_precondition";
}

/** MC-72: `knoxchat.recipes.enabled`, `knoxchat.recipes.autoReplay`, `knoxchat.selfImprove.enabled`. */
export interface RecipeSettings {
  enabled: boolean;
  autoReplay: "off" | "ask" | "exact" | "adapt";
  selfImprove: boolean;
}

export interface RecipeSetStatusOutput {
  ok: boolean;
  /** `not_found` or `not_allowed` (the state machine refuses the move). */
  reason?: string;
}

export interface RecipePromoteSkillOutput {
  ok: boolean;
  /** Where `SKILL.md` was written. */
  path?: string;
  /** `not_found`, `not_eligible`, or a `writeSkillProposal` reason (`exists`, ...). */
  reason?: string;
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
  /** Alt-submit / noContext: skip the Turn Context editor-state block. */
  skipTurnContext?: boolean;
  /** Plan mode: read-only catalog plus builtin_plan / ask_user / explore task. */
  planMode?: boolean;
}

export interface SharedChatTurnOutput {
  stoppedReason: string;
  steps: number;
  summary: string;
}
