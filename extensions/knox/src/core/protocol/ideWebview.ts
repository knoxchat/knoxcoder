import { ToIdeFromWebviewOrCoreProtocol } from "./ide";
import { ToWebviewFromIdeOrCoreProtocol } from "./webview";

import type {
  ApplyState,
  CodeToEdit,
  ContextSubmenuItem,
  EditStatus,
  MessageContent,
  RangeInFileWithContents,
} from "../";

export type ToIdeFromWebviewProtocol = ToIdeFromWebviewOrCoreProtocol & {
  openUrl: [string, void];
  "knoxchat/listModels": [undefined, any[]];
  "openrouter/listModels": [undefined, any[]];
  "knoxchat/oauth/status": [undefined, import("./knoxOAuth").KnoxOAuthStatus];
  "knoxchat/oauth/start": [undefined, void];
  "knoxchat/oauth/cancel": [undefined, void];
  "knoxchat/oauth/signOut": [undefined, void];
  "openrouter/oauth/status": [undefined, import("./openrouterOAuth").OpenRouterOAuthStatus];
  "openrouter/oauth/start": [undefined, void];
  "openrouter/oauth/cancel": [undefined, void];
  "openrouter/oauth/signOut": [undefined, void];
  // We pass the `curSelectedModel` because we currently cannot access the
  // default model title in the GUI from JB
  applyToFile: [
    {
      text: string;
      streamId: string;
      curSelectedModelTitle: string;
      filepath?: string;
    },
    void,
  ];
  overwriteFile: [{ filepath: string; prevFileContent: string | null }, void];
  showFile: [{ filepath: string }, void];
  toggleDevTools: [undefined, void];
  reloadWindow: [undefined, void];
  focusEditor: [undefined, void];
  insertAtCursor: [{ text: string }, void];
  copyText: [{ text: string }, void];
  "vscode/openMoveRightMarkdown": [undefined, void];
  acceptDiff: [{ filepath: string; streamId?: string }, void];
  rejectDiff: [{ filepath: string; streamId?: string }, void];
  /** Batch accept/reject all pending diffs across multiple files */
  "batch/acceptAll": [undefined, { totalFiles: number; successFiles: number; failedFiles: string[] }];
  "batch/rejectAll": [undefined, { totalFiles: number; successFiles: number; failedFiles: string[] }];
  "batch/acceptSelected": [{ fileUris: string[] }, { totalFiles: number; successFiles: number; failedFiles: string[] }];
  "batch/rejectSelected": [{ fileUris: string[] }, { totalFiles: number; successFiles: number; failedFiles: string[] }];
  "batch/getPendingFiles": [undefined, { files: Array<{ filepath: string; numDiffs: number; selected: boolean }> }];
  "edit/sendPrompt": [
    {
      prompt: MessageContent;
      range: RangeInFileWithContents;
      selectedModelTitle: string;
    },
    void,
  ];
  "edit/exit": [{ shouldFocusEditor: boolean }, void];
  
  // Checkpoint messages
  getCheckpointForMessage: [{ messageId: string }, { success: boolean; checkpointId: string | null }];
  getCheckpointForStableId: [{ stableId: string }, { checkpointId: string | null }];
  restoreCheckpoint: [
    { checkpointId: string; rewindMemory?: boolean },
    {
      success: boolean;
      message?: string;
      memoryRewound?: boolean;
      memoryMessage?: string;
    },
  ];
  createCheckpointForMessage: [{ 
    messageId: string; 
    description?: string; 
    stableId?: string; 
    conversationContext?: {
      messageContent: string;
      role: string;
      timestamp: string;
      index: number;
    }
  }, { checkpointId: string | null }];
  /** Sidebar Settings language. The host applies it and forwards it to editor panels. */
  setGuiLanguage: [{ language: "en" | "zh" }, void];
  /** Sidebar chat session, so editor panels can apply the same "This session" filter. */
  setActiveChatSession: [{ sessionId: string | null }, void];
  getActiveChatSession: [undefined, { sessionId: string | null }];
  getCheckpointGraphShell: [undefined, {
    state: "no-workspace" | "not-initialized" | "empty" | "ready";
    checkpointCount: number;
    workspaceFolders?: Array<{ path: string; name: string }>;
    activeWorkspacePath?: string;
  }];
  runCheckpointGraphAction: [{
    action: "openFolder" | "createCheckpoint" | "retryInit" | "showConfiguration";
  }, { ok: boolean }];
  /** Column, filter, and view prefs. `null` when this window has none yet. */
  getCheckpointGraphUiState: [undefined, {
    hiddenColumns?: Array<"date" | "kind" | "id">;
    columnWidths?: { date?: number; kind?: number; id?: number };
    mute?: boolean;
    detailsLocation?: "inline" | "dock";
    dateStyle?: "relative" | "absolute";
    branchIds?: string[];
    activeBranchOnly?: boolean;
    laneColors?: string[];
    fileView?: "list" | "tree";
  } | null];
  saveCheckpointGraphUiState: [{
    hiddenColumns?: Array<"date" | "kind" | "id">;
    columnWidths?: { date?: number; kind?: number; id?: number };
    mute?: boolean;
    detailsLocation?: "inline" | "dock";
    dateStyle?: "relative" | "absolute";
    branchIds?: string[];
    activeBranchOnly?: boolean;
    laneColors?: string[];
    fileView?: "list" | "tree";
  }, void];
  /** Memory editor panel prefs. `null` when this window has none yet. */
  getMemoryViewUiState: [undefined, { activeTabId?: string } | null];
  saveMemoryViewUiState: [{ activeTabId?: string }, void];
  /**
   * Opens `knox.checkpoints.viewFileDiff`. Missing blobs use that command's
   * warning. `compareToCheckpointId` diffs two checkpoints; `compareToWorkspace`
   * diffs the checkpoint against the live file.
   */
  openCheckpointFileDiff: [{
    checkpointId: string;
    relativePath: string;
    compareToCheckpointId?: string;
    compareToWorkspace?: boolean;
  }, void];
  /** Read-only text of one file as stored at the checkpoint. */
  openCheckpointFileAtRevision: [{
    checkpointId: string;
    relativePath: string;
  }, void];
  /** Live workspace file, beside the graph. */
  openCheckpointWorkingFile: [{ relativePath: string }, void];
  /** Clipboard copy. Absolute uses the sandboxed workspace path. */
  copyCheckpointFilePath: [{ relativePath: string; absolute: boolean }, void];
  renameCheckpointBranch: [{ branchId: string; name: string }, { success: boolean; message?: string }];
  /** `present` adds the tag; otherwise the tag is removed. */
  setCheckpointTag: [{
    checkpointId: string;
    tag: string;
    present: boolean;
  }, { success: boolean; message?: string }];
  /** Paths that differ from the active head. No file bytes. */
  checkpointWorkingTree: [undefined, { paths: string[] }];
  mergeCheckpointBranches: [{
    sourceBranchId: string;
    targetBranchId: string;
  }, {
    success: boolean;
    conflicts: Array<{ path: string }>;
    message?: string;
  }];
  deleteCheckpointBranch: [{ branchId: string }, { success: boolean; message?: string }];
  exportCheckpoint: [{ checkpointId: string }, { success: boolean; cancelled?: boolean }];
  /**
   * Lean graph for the editor panel. Omit `branchIds` for every branch; an
   * empty list selects none. Nodes omit file snapshots and file bytes.
   * `changedPaths` and `sessionId` ride along so row details need no second request.
   */
  checkpointGraph: [{
    limit?: number;
    branchIds?: string[];
    /** When set, the host selects the active branch id. Not a stored branch. */
    activeBranchOnly?: boolean;
  } | undefined, {
    nodes: Array<{
      id: string;
      description: string;
      created: string;
      kind: "manual" | "auto" | "ai" | "merge" | "branch-point";
      branchId?: string;
      parents: string[];
      tags: string[];
      fileChanges: { added: number; modified: number; deleted: number };
      /** Relative paths only. Capped the same way as list search. */
      changedPaths: string[];
      sessionId?: string;
      shortId: string;
      pinned: boolean;
    }>;
    branches: Array<{
      id: string;
      name: string;
      headCheckpointId: string;
      baseCheckpointId: string;
      color: string;
      isActive: boolean;
    }>;
    headCheckpointId: string | null;
    /** True when a later page exists under the requested limit. */
    hasMore?: boolean;
  }];
  listCheckpoints: [{
    query?: string;
    offset?: number;
    limit?: number;
    sessionId?: string;
    thisSessionOnly?: boolean;
  } | undefined, {
    checkpoints: any[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    compareCatalog: Array<{ id: string; description: string; dateCreated: string }>;
    activeWorkspacePath?: string;
    workspaceFolders?: Array<{ path: string; name: string }>;
  }];
  getCheckpointDetails: [{ checkpointId: string }, { success: boolean; details: any | null }];
  getPreviousCheckpoint: [{ checkpointId: string }, { success: boolean; details: any | null }];
  /**
   * Accurate checkpoint comparison: reconstructs true file contents at both
   * checkpoints (handles delta snapshots) and returns per-file old/new pairs.
   * compareToCheckpointId defaults to the immediately preceding checkpoint.
   * With compareToWorkspace the checkpoint is compared against the live
   * workspace (checkpoint = old side, workspace = new side).
   */
  computeCheckpointDiff: [
    {
      checkpointId: string;
      compareToCheckpointId?: string;
      compareToWorkspace?: boolean;
    },
    {
      success: boolean;
      diff: {
        oldCheckpoint: { id: string; description: string; created: string } | null;
        newCheckpoint: { id: string; description: string; created: string };
        files: Array<{
          relativePath: string;
          status: "added" | "deleted" | "modified";
          oldContent: string | null;
          newContent: string | null;
          oldEncoding?: string;
          newEncoding?: string;
        }>;
      } | null;
    },
  ];
  /**
   * Dry-run of restore vs the live workspace. No writes.
   * modified/added/deleted are restore-oriented (overwrite / recreate / extra).
   */
  previewRestore: [
    { checkpointId: string },
    {
      success: boolean;
      preview: {
        checkpointId: string;
        description: string;
        modified: number;
        added: number;
        deleted: number;
        files: Array<{
          relativePath: string;
          action: "overwrite" | "create" | "delete";
          additions: number;
          deletions: number;
          hunkCount: number;
        }>;
        writePaths: string[];
        extraPaths: string[];
        skippedFiles: Array<{ path: string; reason: string }>;
      } | null;
      message?: string;
    },
  ];
  /** Restore only the specified files from a checkpoint (selective restore) */
  restoreCheckpointFiles: [
    { checkpointId: string; relativePaths: string[] },
    {
      success: boolean;
      restoredFiles: string[];
      failedFiles: Array<{ path: string; error: string }>;
    },
  ];
  deleteCheckpoints: [{ checkpointIds: string[] }, { success: boolean; results?: any[] }];
  pinCheckpoint: [{ checkpointId: string; pinned: boolean }, { success: boolean }];
  setActiveCheckpointWorkspace: [{ workspacePath: string }, { success: boolean }];
  getCheckpointConfig: [undefined, { status: string; config?: any }];
  saveCheckpointConfig: [{ config: any }, { status: string }];
  getPerformanceDashboard: [
    { historyDays?: number } | undefined,
    {
      success: boolean;
      data: {
        currentStorage: {
          timestamp: string;
          totalBytes: number;
          checkpointDataBytes: number;
          blobCount: number;
          checkpointCount: number;
        };
        storageHistory: Array<{
          timestamp: string;
          totalBytes: number;
          checkpointDataBytes: number;
          blobCount: number;
          checkpointCount: number;
        }>;
        creationFrequency: Array<{ bucket: string; count: number }>;
        restorationEvents: Array<{
          timestamp: string;
          checkpointId: string;
          success: boolean;
          durationMs: number;
          filesRestored: number;
          filesFailed: number;
          error?: string;
        }>;
        aiSessionMetrics: Array<{
          sessionId: string;
          startedAt: string;
          endedAt?: string;
          filesChanged: number;
          linesAdded?: number;
          linesDeleted?: number;
          checkpointsCreated: number;
          rollbacks?: number;
          durationSeconds: number;
        }>;
        summary: {
          totalCheckpointsCreated: number;
          totalRestorations: number;
          restorationSuccessRate: number;
          avgCreationTimeMs: number;
          avgRestorationTimeMs: number;
          totalAiSessions: number;
          avgChangesPerSession: number;
          totalRollbacks: number;
        };
      } | null;
    },
  ];
  getSharedCheckpointBundles: [
    { limit?: number } | undefined,
    {
      success: boolean;
      bundles: Array<{
        id: string;
        description: string;
        sharedAt: string;
        checkpointCount: number;
        checkpointIds: string[];
        filePath: string;
        sharedBy: string;
        machineId: string;
        hmacSha256?: string;
        hmacKeyId?: string;
        exists: boolean;
      }>;
      auditRecords: Array<{
        id: string;
        timestamp: string;
        userId: string;
        machineId: string;
        action: string;
        resourceType: string;
        resourceId: string;
        outcome: string;
        details: string;
      }>;
    },
  ];
  shareCheckpoints: [
    {
      checkpointIds?: string[];
      description?: string;
      filePath?: string;
    } | undefined,
    {
      success: boolean;
      cancelled?: boolean;
      bundle: {
        id: string;
        description: string;
        sharedAt: string;
        checkpointCount: number;
        checkpointIds: string[];
        filePath: string;
        sharedBy: string;
        machineId: string;
        hmacSha256?: string;
        hmacKeyId?: string;
        exists: boolean;
      } | null;
      message?: string;
    },
  ];
  importSharedBundle: [
    { filePath: string; merge?: boolean; remapIds?: boolean },
    { success: boolean; importedCount?: number; cancelled?: boolean; message?: string },
  ];
  revealSharedBundle: [{ filePath: string }, { success: boolean; message?: string }];
  getCheckpointTimeline: [
    { limit?: number } | undefined,
    {
      success: boolean;
      checkpoints: Array<{
        id: string;
        description: string;
        created: string;
        type: "manual" | "auto" | "ai" | "merge" | "branch-point";
        branchId?: string;
        parentId?: string;
        tags: string[];
        fileChanges?: { added: number; modified: number; deleted: number };
        metadata?: { messageContent?: string; role?: string };
        isIncremental: boolean;
      }>;
      branches: Array<{
        id: string;
        name: string;
        color: string;
        baseCheckpointId: string;
        checkpoints: string[];
        isActive: boolean;
      }>;
      activeBranchId?: string;
    },
  ];
  createCheckpointBranch: [
    { name: string; baseCheckpointId: string; description?: string },
    {
      success: boolean;
      branch: {
        id: string;
        name: string;
        headCheckpointId: string;
        baseCheckpointId: string;
        parentBranchId?: string;
        createdAt: string;
        description?: string;
      } | null;
      message?: string;
    },
  ];
  switchCheckpointBranch: [
    { branchId: string },
    { success: boolean; message?: string },
  ];
  analyzeCheckpoint: [
    { checkpointId: string },
    {
      success: boolean;
      analysis: {
        checkpointId: string;
        generatedDescription: string;
        riskAssessment: {
          level: "Low" | "Medium" | "High" | "Critical";
          score: number;
          factors: Array<{
            category: string;
            description: string;
            weight: number;
            affectedFiles: string[];
          }>;
          recommendations: string[];
        };
        impactAnalysis: {
          affectedFeatures: Array<{
            name: string;
            impactLevel: "Low" | "Medium" | "High";
            changedFiles: string[];
          }>;
          affectedLayers: string[];
          scope: "Isolated" | "Module" | "CrossModule" | "SystemWide";
          uniqueDirectories: number;
          testFilesChanged: boolean;
          linesAdded: number;
          linesDeleted: number;
        };
        groupingSuggestion?: {
          id: string;
          kind: "session" | "time" | "path";
          groupName: string;
          rationale: string;
          confidence: number;
          checkpointIds: string[];
        };
        counts: {
          changed: number;
          created: number;
          deleted: number;
          modified: number;
          binary: number;
          config: number;
          lockfile: number;
          tests: number;
        };
      } | null;
      message?: string;
    },
  ];
  suggestCheckpointGroups: [
    { limit?: number } | undefined,
    {
      success: boolean;
      groups: Array<{
        id: string;
        kind: "session" | "time" | "path";
        groupName: string;
        rationale: string;
        confidence: number;
        checkpointIds: string[];
      }>;
    },
  ];

  // Smart AI Checkpoint Integration messages
  startAISession: [{ sessionId: string; filesToWork?: string[] }, { success: boolean }];
  stopAISession: [{ description?: string }, { success: boolean; checkpointId?: string }];
  trackAIFiles: [{ filePaths: string[] }, { success: boolean }];
  createAICheckpoint: [{ description?: string }, { success: boolean; checkpointId?: string }];
  enterChatMode: [undefined, { success: boolean }];

  // Memory Brain context building (Webview → IDE)
  "memory/buildContext": [
    {
      message: string;
      maxTokens?: number;
      sessionId?: string;
      goal?: string;
      memoryMode?: "full" | "summarized" | "selective";
    },
    {
      context: string | null;
      items?: Array<{
        id: number | null;
        kind: string;
        title: string;
        reason: string;
        category?: string;
        score?: number;
        pinned?: boolean;
      }>;
      timedOut?: boolean;
    },
  ];
  // Memory Brain auto-store after task completion (Webview → IDE)
  "memory/autoStore": [
    { taskDescription: string; filesModified: string[]; sessionSummary?: string },
    { success: boolean },
  ];
  // Sync GUI session.mode === "agent" with VS Code AgentModeManager
  setAgentMode: [
    { active: boolean; sessionId?: string },
    { success: boolean; active: boolean },
  ];

  /** Cheap liveness ping so a dead webview renderer can be reloaded (CSLD-20). */
  "knox/heartbeat": [{ t: number }, void];
  /** Recreate the sidebar HTML after the watchdog placeholder. */
  "knox/reloadWebview": [undefined, void];

  // Post-turn memory write for substantial chat turns (Webview → IDE)
  "memory/postTurn": [
    {
      sessionId: string;
      userMessage: string;
      assistantMessage: string;
      toolSummary?: string;
      title?: string;
      workspaceDir?: string;
    },
    { success: boolean; stored?: number },
  ];

  /**
   * Native workbench chat: build one Agent/Chat LLM request with Core's
   * constructMessages + agent catalog + loop guards (the webview ran these
   * in-bundle; workbench code cannot import Core).
   */
  "knox/buildAgentRequest": [
    import("./nativeAgent").NativeAgentRequestInput,
    import("./nativeAgent").NativeAgentRequestOutput,
  ];
  /** Would this pending call complete a doom loop for the current turn? */
  "knox/checkDoomLoop": [
    import("./nativeAgent").NativeDoomLoopInput,
    import("./nativeAgent").NativeDoomLoopOutput,
  ];
  /** Agent/rule policy (`isHardPolicyDeny`, `isToolAutoApproved`) for one pending call. */
  "knox/evaluateToolPolicy": [
    import("./nativeAgent").NativeToolPolicyInput,
    import("./nativeAgent").NativeToolPolicyOutput,
  ];
  /** Track the session and record the user message before memory context is built. */
  "knox/startTurn": [
    import("./nativeAgent").NativeStartTurnInput,
    import("./nativeAgent").NativeStartTurnOutput,
  ];
  /** Record the assistant message and run the post-turn memory write. */
  "knox/finishTurn": [import("./nativeAgent").NativeFinishTurnInput, void];
  /**
   * Shared loop (K-010): run a whole chat turn on
   * `runAgentLoop`. Progress arrives as `knox/chatTurnEvent` notifications;
   * permission cards are answered with `brain/resolveAutonomousTool`.
   */
  "knox/runChatTurn": [
    import("./nativeAgent").SharedChatTurnInput,
    import("./nativeAgent").SharedChatTurnOutput,
  ];
  /** Stop a shared-loop turn (stream, permission waits, running tools). */
  "knox/cancelChatTurn": [{ sessionId: string }, { cancelled: boolean }];
  /** Strip leaked DSML/XML tool markup and recover text-format tool calls (`hydrateAssistantTextToolCalls`). */
  "knox/hydrateAssistant": [
    import("./nativeAgent").NativeHydrateAssistantInput,
    import("./nativeAgent").NativeHydrateAssistantOutput,
  ];
};

export type ToWebviewFromIdeProtocol = ToWebviewFromIdeOrCoreProtocol & {
  setInactive: [undefined, void];
  newSessionWithPrompt: [{ prompt: string }, void];
  userInput: [{ input: string }, void];
  focusKnoxInput: [undefined, void];
  focusKnoxInputWithoutClear: [undefined, void];
  focusKnoxInputWithNewSession: [undefined, void];
  highlightedCode: [
    {
      rangeInFileWithContents: RangeInFileWithContents;
      prompt?: string;
      shouldRun?: boolean;
    },
    void,
  ];
  addCodeToEdit: [CodeToEdit, void];
  navigateTo: [{ path: string; toggle?: boolean }, void];
  addModel: [undefined, void];

  focusKnoxSessionId: [{ sessionId: string | undefined }, void];
  newSession: [undefined, void];
  setTheme: [{ theme: any }, void];
  setColors: [{ [key: string]: string }, void];
  addApiKey: [undefined, void];
  incrementFtc: [undefined, void];
  applyCodeFromChat: [undefined, void];
  updateApplyState: [ApplyState, void];
  setEditStatus: [{ status: EditStatus; fileAfterEdit?: string }, void];
  exitEditMode: [undefined, void];
  focusEdit: [undefined, void];
  focusEditWithoutClear: [undefined, void];
  
  // Checkpoint response
  checkpointForMessage: [{ messageId: string; checkpointId: string | undefined }, void];
  checkpointListUpdated: [undefined, void];
  /** Graph panel should reload `checkpointGraph` while it is visible. */
  checkpointGraphUpdated: [undefined, void];
  /** Memory panel should reload its active tab while it is visible. */
  memoryViewUpdated: [undefined, void];
  guiLanguageChanged: [{ language: "en" | "zh" }, void];
  activeChatSessionChanged: [{ sessionId: string | null }, void];

  // Image attachment from extension (e.g. screenshot capture)
  addImageAttachment: [{ imageUrl: string; name: string }, void];
  gitStateChanged: [undefined, void];

  /** Extension AgentModeManager status changed — GUI may force Agent on; Chat is not a user switch */
  agentModeChanged: [{ active: boolean }, void];

  /** Workspace restore finished — inject a system note so the agent does not plan on stale files. */
  checkpointRestored: [
    {
      checkpointId: string;
      description?: string;
      restoredFiles: string[];
      sessionId?: string;
      memoryRewound?: boolean;
      memoryMessage?: string;
    },
    void,
  ];
};
