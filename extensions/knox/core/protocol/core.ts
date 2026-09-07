import {
  ConfigResult,
  DevDataLogEvent,
  ModelRole,
} from "knoxdev-package/config-yaml";


import { ProfileDescription } from "../config/ConfigHandler";
import { SharedConfigSchema } from "../config/sharedConfig";
import type { MemoryCategory } from "../context/memory/types";
import type { SemanticCategory, MemoryBrainAction } from "../context/memory/brain/types";
import {
  GlobalContextModelSelections,
  ReasoningEffortPrefs,
} from "../util/GlobalContext";

import type {
  BrowserSerializedKnoxConfig,
  ChatMessage,
  ContextItem,
  ContextItemWithId,
  ContextSubmenuItem,
  DiffLine,
  ExperimentalModelRoles,
  FileSymbolMap,
  IdeSettings,
  LLMFullCompletionOptions,
  ModelDescription,
  PromptLog,
  RangeInFile,
  Session,
  SessionMetadata,
  SlashCommandDescription,
  ToolCall,
} from "../";
import type { AgentJobsRequest, AgentJobsResponse } from "./agentJobs";



export interface ListHistoryOptions {
  offset?: number;
  limit?: number;
  workspaceDirectory?: string;
}

export type ToCoreFromIdeOrWebviewProtocol = {
  // Special
  ping: [string, string];
  abort: [undefined, void];

  // History
  "history/list": [ListHistoryOptions, SessionMetadata[]];
  "history/delete": [{ id: string }, void];
  "history/load": [{ id: string }, Session];
  "history/save": [Session, void];
  "devdata/log": [DevDataLogEvent, void];
  "config/addOpenAiKey": [string, void];
  "config/addModel": [
    {
      model: ModelDescription;
      role?: keyof ExperimentalModelRoles;
    },
    void,
  ];
  "config/newPromptFile": [undefined, void];
  "config/ideSettingsUpdate": [IdeSettings, void];
  "config/getSerializedProfileInfo": [
    undefined,
    {
      result: ConfigResult<BrowserSerializedKnoxConfig>;
      profileId: string | null;
    },
  ];
  "config/deleteModel": [{ title: string }, void];
  "config/addPrompt": [
    {
      name: string;
      description: string;
      prompt: string;
    },
    void,
  ];
  "config/reload": [undefined, ConfigResult<BrowserSerializedKnoxConfig>];
  "config/listProfiles": [
    undefined,
    { profiles: ProfileDescription[] | null; selectedProfileId: string | null },
  ];
  "config/refreshProfiles": [undefined, void];
  "config/openProfile": [{ profileId: string | undefined }, void];
  "config/updateSharedConfig": [SharedConfigSchema, SharedConfigSchema];
  "config/updateSelectedModel": [
    {
      profileId: string;
      role: ModelRole;
      title: string | null;
    },
    GlobalContextModelSelections,
  ];
  "ui/getReasoningEffortPrefs": [undefined, ReasoningEffortPrefs];
  "ui/updateReasoningEffortPrefs": [
    Partial<ReasoningEffortPrefs>,
    ReasoningEffortPrefs,
  ];
  "context/getContextItems": [
    {
      name: string;
      query: string;
      fullInput: string;
      selectedCode: RangeInFile[];
      selectedModelTitle: string;
    },
    ContextItemWithId[],
  ];
  "context/getSymbolsForFiles": [{ uris: string[] }, FileSymbolMap];
  "context/getAutoContext": [
    {
      message: string;
      existingContextPaths: string[];
      modelName?: string;
    },
    ContextItem[],
  ];
  // Memory management
  "memory/create": [
    {
      category: MemoryCategory;
      title: string;
      content: string;
      source: string;
      keywords?: string;
      relevanceScore?: number;
      ttlDays?: number | null;
    },
    { id: number },
  ];
  "memory/search": [
    { query: string; category?: MemoryCategory; limit?: number },
    { items: any[] },
  ];
  "memory/delete": [{ id: number }, { success: boolean }];
  "memory/list": [undefined, { items: any[] }];
  "memory/cleanup": [undefined, { removed: number }];
  // Memory Brain — human-brain-like persistent memory across all sessions
  "brain/dispatch": [
    { action: MemoryBrainAction; [key: string]: any },
    { result: string },
  ];
  "brain/trackSession": [
    { sessionId: string; title: string; workspaceDir: string },
    void,
  ];
  "brain/recordMessage": [
    { sessionId: string; role: string; content: string; type?: string; tokenCount?: number; importance?: number; metadata?: Record<string, unknown> },
    { id: number },
  ];
  "brain/recordSoulEvent": [
    {
      sessionId: string;
      kind: "tool_success" | "tool_denied" | "tool_error" | "restore" | "compaction"
        | "build:fail" | "build:pass" | "qemu:panic" | "bisect:step";
      toolName?: string;
      files?: string[];
      workspaceCheckpointId?: string;
      memoryCheckpointId?: number;
      ok: boolean;
      policy?: "allow" | "ask" | "deny";
      summary: string;
    },
    { id: number },
  ];
  "brain/getLastSoulEvent": [
    { sessionId: string },
    {
      event: {
        sessionId: string;
        kind: string;
        toolName?: string;
        files: string[];
        workspaceCheckpointId?: string;
        memoryCheckpointId?: number;
        ok: boolean;
        summary: string;
        episodicId: number;
      } | null;
    },
  ];
  "brain/autoStore": [
    {
      taskDescription: string;
      filesModified: string[];
      sessionSummary?: string;
      sessionId?: string;
    },
    { success: boolean },
  ];
  "brain/buildContext": [
    {
      message: string;
      sessionId?: string;
      maxTokens?: number;
      goal?: string;
      memoryMode?: "full" | "summarized" | "selective";
    },
    {
      context: string;
      items?: Array<{
        id: number | null;
        kind: string;
        title: string;
        reason: string;
        category?: string;
        score?: number;
        pinned?: boolean;
        fts5?: number;
        trigram?: number;
        graph?: number;
        recency?: number;
        importance?: number;
        topic_id?: number | null;
        task_id?: string | null;
        gate_passed?: boolean;
        evidence?: string[];
      }>;
    },
  ];
  "brain/pinMemory": [{ id: number }, { success: boolean }];
  "brain/unpinMemory": [{ id: number }, { success: boolean }];
  "brain/mismatchMemory": [
    { id: number; sessionId?: string },
    { success: boolean },
  ];
  "brain/getAuditLog": [
    { action?: string; limit?: number; since?: string } | undefined,
    {
      entries: Array<{
        id: number;
        action: string;
        target_type: string;
        target_id: string | number | null;
        details: unknown;
        created_at: string;
      }>;
    },
  ];
  "brain/pinMemories": [{ ids: number[] }, { updated: number; failed: number }];
  "brain/unpinMemories": [{ ids: number[] }, { updated: number; failed: number }];
  "brain/deleteMemories": [
    { ids: number[] },
    { deleted: number; failed: number; errors: string[] },
  ];
  "brain/store": [
    { category: SemanticCategory; title: string; content: string; keywords?: string; importance?: number; session_id?: string; ttl_days?: number | null },
    { id: number },
  ];
  "brain/recall": [
    { query: string; category?: SemanticCategory; session_id?: string; limit?: number; include_episodic?: boolean },
    { result: any },
  ];
  "brain/stats": [undefined, { stats: any }];
  "brain/dashboard": [
    undefined,
    {
      stats: any;
      health: any;
      graphStats: any;
      sessions: any[];
      healthScore: any;
      consolidation: any;
    },
  ];
  "brain/consolidate": [undefined, { result: any }];
  // Direct GUI endpoints (return structured JSON, not formatted text)
  "brain/graphStats": [
    undefined,
    {
      total_entities: number;
      total_edges: number;
      entity_types: Record<string, number>;
      max_entities?: number;
      cap_utilization?: number;
      at_cap?: boolean;
      max_depth?: number;
      depth_decay_gamma?: number;
    },
  ];
  "brain/searchEntities": [{ query: string; entity_type?: string; limit?: number }, { entities: any[] }];
  "brain/exploreGraph": [{ entity_id: number; depth?: number }, { result: any }];
  "brain/getConfig": [undefined, { config: any }];
  "brain/updateConfig": [{ key: string; value: string }, { success: boolean }];
  "brain/optimize": [undefined, { message: string }];
  "brain/heal": [{ action?: string } | undefined, { results: any[] }];
  "brain/export": [
    { password?: string } | undefined,
    { data: string; filePath?: string; encrypted?: boolean },
  ];
  "brain/import": [
    { filePath?: string; data?: string; password?: string },
    { result: string },
  ];
  "brain/deleteMemory": [{ id: number }, { success: boolean }];
  "brain/searchMemories": [
    {
      query?: string;
      category?: string;
      tier?: string;
      pinned?: boolean;
      limit?: number;
      offset?: number;
    },
    { memories: any[] },
  ];
  "brain/listSessions": [
    { limit?: number; workspace_directory?: string },
    { sessions: any[] },
  ];
  "brain/summarizeSession": [{ session_id: string }, { summary: string }];
  // Cross-session backlog search
  "brain/searchBacklogs": [
    {
      query: string;
      limit?: number;
      session_ids?: string[];
      session_id?: string;
      workspace_dir?: string;
      date_from?: string;
      date_to?: string;
      roles?: string[];
      include_semantic?: boolean;
      include_episodic?: boolean;
    },
    { result: any },
  ];
  // LLM-enhanced memory operations
  "brain/llmExtractEntities": [
    { text: string; session_id?: string },
    { result: any },
  ];
  "brain/llmSummarizeSession": [
    { session_id: string; detail_level?: string },
    { summary: string; llm_used: boolean },
  ];
  "brain/llmEvaluateImportance": [
    { content: string; role?: string; context?: string },
    { score: number; reason: string; llm_used: boolean },
  ];
  "brain/llmPostActionMemory": [
    { action_description: string; action_result: string; session_id?: string },
    { result: any },
  ];
  // Checkpoint / rollback
  "brain/createCheckpoint": [
    { label: string },
    { checkpoint: any },
  ];
  "brain/listCheckpoints": [
    { limit?: number },
    { checkpoints: any[] },
  ];
  "brain/rollbackCheckpoint": [
    { checkpoint_id: number },
    { result: string },
  ];
  "brain/deleteCheckpoint": [
    { checkpoint_id: number },
    { success: boolean },
  ];
  "brain/runPipeline": [
    {
      mode: "pre_turn" | "post_turn" | string;
      message?: string;
      sessionId?: string;
      role?: string;
      goal?: string;
      maxTokens?: number;
      turnContent?: string;
    },
    { phases: any[]; context?: string; items?: any[]; extracted?: any },
  ];
  "brain/getEffectiveContext": [
    undefined,
    {
      active_window_tokens: number;
      context_max_tokens?: number;
      last_context_tokens_used?: number;
      last_context_max_tokens?: number;
      window_utilization?: number;
      tier_tokens: Record<string, number>;
      hierarchy_effective_tokens: number;
      memory_levels?: Array<{
        id: string;
        name: string;
        tokens: number;
        ratio: number;
        effective_tokens: number;
      }>;
      graph_entity_count: number;
      total_effective: number;
      compression_ratios: {
        active: number;
        hot: number;
        warm: number;
        cold: number;
        frozen: number;
      };
      memory_tokens_saved?: number;
    },
  ];
  "brain/getPhaseStatus": [
    undefined,
    {
      active_phase: string | null;
      last_completed?: { phase: string; at: number } | null;
      phase_counts?: Record<string, number>;
      cycle_invariant_met?: boolean;
      background_sleep_active?: boolean;
      canonical_order?: string[];
    },
  ];
  "brain/getReviewDue": [
    { limit?: number } | undefined,
    {
      items: Array<{
        memory_id: number;
        category: string;
        title: string;
        importance_score: number;
        retrieval_count: number;
        last_accessed_at: string;
        current_retention: number;
        strength: number;
        next_optimal_review: string;
        days_until_review: number;
        overdue: boolean;
      }>;
      count: number;
    },
  ];
  "brain/getEbbinghausStats": [
    undefined,
    {
      config: {
        baseStrength: number;
        lambda: number;
        pruneThreshold: number;
        reviewThreshold: number;
        strengtheningAlpha: number;
        repetitionBeta: number;
        salienceWeight: number;
        importanceWeight: number;
      };
      review_due_count: number;
      avg_retention: number;
    },
  ];
  "brain/routeTask": [
    { message: string; toolCount?: number; codeBlockCount?: number },
    { difficulty: string; score: number; modelId: string },
  ];
  "brain/runAutonomousLoop": [
    {
      sessionId: string;
      goal: string;
      maxIterations?: number;
      modelTitle?: string;
      permissionMode?: "default" | "acceptEdits" | "fullAuto";
      toolSettings?: Record<
        string,
        "allowedWithPermission" | "allowedWithoutPermission" | "disabled"
      >;
      sessionAllowlist?: string[];
    },
    {
      success: boolean;
      iterations: number;
      final_result: string;
      cancelled: boolean;
      checkpoints_created: number;
    },
  ];
  "brain/resolveAutonomousTool": [
    {
      sessionId: string;
      callId: string;
      allow: boolean;
      always?: boolean;
    },
    { ok: boolean },
  ];
  "brain/cancelAutonomousLoop": [
    { sessionId: string },
    { cancelled: boolean },
  ];
  "brain/getAutonomousLoopStatus": [
    { sessionId: string },
    {
      session_id: string;
      goal: string;
      iteration: number;
      max_iterations: number;
      running: boolean;
      last_result?: string;
      checkpoints_created: number;
      started_at: string;
    } | null,
  ];
  "brain/getSessionHistory": [
    { sessionId: string; episodicLimit?: number; semanticLimit?: number },
    {
      session: any;
      episodic: any[];
      semantic: any[];
      topics: any[];
      token_estimate: number;
      message_count: number;
    },
  ];
  "brain/getMetricsTrend": [
    { hours?: number } | undefined,
    {
      snapshots: Array<{
        id: number;
        timestamp: string;
        avg_response_ms: number;
        success_rate: number;
        db_size_bytes: number;
        memory_count: number;
        memory_tokens_saved?: number;
        hierarchy_effective_tokens?: number;
        total_effective?: number;
      }>;
      period_hours: number;
      avg_response_trend: "improving" | "stable" | "degrading";
      success_rate_trend: "improving" | "stable" | "degrading";
      growth_rate_trend: "stable" | "growing" | "shrinking" | "accelerating";
      compression_trend?: "improving" | "stable" | "degrading";
      effective_context_trend?: "improving" | "stable" | "degrading";
    },
  ];
  "context/loadSubmenuItems": [{ title: string }, ContextSubmenuItem[]];
  "llm/complete": [
    {
      prompt: string;
      completionOptions: LLMFullCompletionOptions;
      title: string;
    },
    string,
  ];
  "llm/listModels": [{ title: string }, string[] | undefined];
  "llm/streamChat": [
    {
      messages: ChatMessage[];
      completionOptions: LLMFullCompletionOptions;
      title: string;
      legacySlashCommandData?: {
        command: SlashCommandDescription;
        input: string;
        contextItems: ContextItemWithId[];
        historyIndex: number;
        selectedCode: RangeInFile[];
      };
    },
    AsyncGenerator<ChatMessage, PromptLog>,
  ];
  streamDiffLines: [
    {
      prefix: string;
      highlighted: string;
      suffix: string;
      input: string;
      language: string | undefined;
      modelTitle: string | undefined;
    },
    AsyncGenerator<DiffLine>,
  ];
  "chatDescriber/describe": [
    {
      selectedModelTitle: string;
      text: string;
    },
    string | undefined,
  ];
  "stats/getTokensPerDay": [
    undefined,
    { day: string; promptTokens: number; generatedTokens: number }[],
  ];
  "stats/getTokensPerModel": [
    undefined,
    { model: string; promptTokens: number; generatedTokens: number }[],
  ];
  "stats/getTokensPerModelWithCost": [
    undefined,
    {
      model: string;
      promptTokens: number;
      generatedTokens: number;
      promptCost: number;
      completionCost: number;
      totalCost: number;
    }[],
  ];
  /** Terminal fix suggestions from ErrorPatternDetector */
  "terminal/getSuggestions": [
    undefined,
    {
      suggestions: Array<{
        command: string;
        errorPattern: string;
        suggestedFix: string;
        confidence: number;
        timestamp: number;
      }>;
    },
  ];
  "terminal/applySuggestion": [
    { command: string; suggestedFix: string },
    { success: boolean },
  ];
  // File changes
  "files/changed": [{ uris?: string[] }, void];
  "files/opened": [{ uris?: string[] }, void];
  "files/created": [{ uris?: string[] }, void];
  "files/deleted": [{ uris?: string[] }, void];
  "files/closed": [{ uris?: string[] }, void];

  "auth/getAuthUrl": [undefined, { url: string }];
  "tools/call": [
    {
      toolCall: ToolCall;
      selectedModelTitle: string;
      viewReadModelTitle?: string | null;
      realTimeSearchModelTitle?: string | null;
      preferredModel?: "chat" | "viewRead" | "realTimeSearch";
      sessionId?: string;
      turnId?: string;
    },
    { contextItems: ContextItem[] },
  ];
  /** Abort any in-flight tools/call executions (terminal kill, etc.). */
  "tools/cancel": [undefined, void];
  /**
   * Isolate agent edits in a git worktree (Claude EnterWorktree).
   * `enter` creates/reuses; `apply` copies changed files onto the main tree;
   * `discard` removes the worktree; `status` reports current state.
   */
  "agent/worktree": [
    {
      action: "enter" | "apply" | "discard" | "status";
      sessionId?: string;
    },
    {
      ok: boolean;
      error?: string;
      state?: {
        enabled: boolean;
        branch?: string;
        path?: string;
        files: string[];
      } | null;
    },
  ];
  /**
   * Background agent jobs panel (Claude Agent view lite).
   * `list` returns shell jobs; `kill` stops a running job; `dismiss` drops a finished one.
   */
  "agent/jobs": [AgentJobsRequest, AgentJobsResponse];
  "clipboardCache/add": [{ content: string }, void];
};
