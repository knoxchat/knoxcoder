import fs from "fs";
import path from "path";

import { BrainStore } from "./BrainStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import { LearningEngine } from "./LearningEngine.js";
import { AutoMemory } from "./AutoMemory.js";
import { ContextBuilder } from "./ContextBuilder.js";
import { MemoryPipeline } from "./MemoryPipeline.js";
import { LocalAutonomousLoop } from "./LocalAutonomousLoop.js";
import type { AutonomousLoopInput, AutonomousLoopResult, AutonomousLoopStatus } from "./LocalAutonomousLoop.js";
import { TaskRouter } from "./TaskRouter.js";
import type { TaskScoreInput, TaskRouteResult } from "./TaskRouter.js";
import { LlmMemoryService } from "./LlmMemoryService.js";
import { SleepConsolidation } from "./SleepConsolidation.js";
import type { SleepCycleResult } from "./SleepConsolidation.js";
import { CheckpointManager } from "./CheckpointManager.js";
import type {
  CheckpointStrategyConfig,
  CheckpointLifecycleReport,
  EventReplayResult,
  UndoResult,
} from "./CheckpointManager.js";
import { BatchOperations } from "./BatchOperations.js";
import type {
  BatchDeleteInput,
  BatchDeleteResult,
  BatchStoreInput,
  BatchStoreResult,
  BatchEventInput,
  BatchEventResult,
} from "./BatchOperations.js";
import {
  SessionDiscovery,
  FiveTierHierarchy,
  RootCauseAnalyzer,
  SpacedRepetition,
  LruCache,
  MetricsStorage,
} from "./AdvancedFeatures.js";
import type {
  RelatedSession,
  ExtendedMemoryTier,
  RootCauseReport,
  SpacedRepetitionState,
  LruCacheStats,
  MetricsTrend,
} from "./AdvancedFeatures.js";
import {
  MetricsCollector,
  HealthScorer,
  PredictiveAnalytics,
  HealingEngine,
  ConsolidationTracker,
  CompressionMetrics,
  EffectiveContextTracker,
} from "./PerformanceMonitor.js";
import type {
  MetricsSummary,
  HealthScore,
  CapacityForecast,
  HealingResult,
  HealingAction,
  HealingStrategy,
  ConsolidationStats,
} from "./PerformanceMonitor.js";
import { InputSanitizer } from "./InputSanitizer.js";
import { RetrievalFusion } from "./RetrievalFusion.js";
import type { FusionResult, FusionOptions } from "./RetrievalFusion.js";
import { MemorySnapshot } from "./MemorySnapshot.js";
import type { Snapshot } from "./MemorySnapshot.js";
import { WorkingMemory } from "./WorkingMemory.js";
import type { WorkingMemoryState } from "./WorkingMemory.js";
import { PrefrontalCortex } from "./regions/PrefrontalCortex.js";
import { getMemoryBrainPath } from "../../../util/paths.js";
import {
  filterEpisodicByProjectScope,
  filterSemanticByProjectScope,
  getProjectSessionIds,
  resolveProjectScope,
} from "./projectScope.js";
import type { ILLM } from "../../../index.js";
import type {
  BrainSession,
  BrainStats,
  ConsolidationResult,
  StoreInput,
  RecallInput,
  RecallResult,
  SessionSummaryInput,
  AssociateInput,
  SemanticMemory,
  MemoryBrainAction,
  AddEntityInput,
  AddEdgeInput,
  ExploreGraphInput,
  LearnPatternInput,
  StoreProcedureInput,
  TagInput,
  CollectionInput,
  AddToCollectionInput,
  BuildContextInput,
  MemoryConfigInput,
  MemoryMode,
  MemoryPhase,
  HealthStatus,
  MemoryExport,
  BacklogSearchInput,
  CreateCheckpointInput,
  LlmExtractEntitiesInput,
  LlmSummarizeSessionInput,
  LlmEvaluateImportanceInput,
  LlmPostActionMemoryInput,
  MemoryEvent,
  MemoryEventType,
  MemoryEventListener,
} from "./types.js";

/**
 * BrainManager — Knox-MS-style service layer for the Memory Brain.
 *
 * Provides the public API that the tool implementation and protocol handlers call.
 * Mirrors the Knox-MS service pattern:
 *   Controller → Service → Store → SQLite
 *
 * Features (fully mirrors Knox-MS):
 * - Store/recall across all sessions (unlimited context window)
 * - Automatic conversation tracking (episodic memory)
 * - Knowledge extraction and storage (semantic memory)
 * - Knowledge graph (entities, edges, traversal, spreading activation)
 * - Learning engine (pattern recording, Jaccard similarity, suggestions)
 * - Procedural memory (workflows, steps, execution tracking)
 * - Auto-memory extraction (rule-based fact detection)
 * - Smart context builder (token-budgeted multi-source assembly)
 * - Memory consolidation (hot→warm→cold tiering)
 * - Tags & collections (organization)
 * - Cross-session associations (knowledge graph)
 * - Self-management (health, optimization, configuration)
 * - Import/Export (backup & restore)
 * - Session summarization
 * - Brain statistics
 */
export class BrainManager {
  // ── LLM Reference (set by tool implementation when available) ──────────────
  private static llm: ILLM | null = null;

  // ── Performance Monitoring Singletons ──────────────────────────────────────
  private static readonly metrics = new MetricsCollector();
  private static readonly compressionMetrics = new CompressionMetrics();
  private static readonly effectiveContextTracker = new EffectiveContextTracker();
  private static readonly predictive = new PredictiveAnalytics();
  private static readonly healing = new HealingEngine();
  private static readonly consolidationTracker = new ConsolidationTracker();

  // ── LRU Cache (Tier D) ─────────────────────────────────────────────────────
  private static readonly memoryCache = new LruCache<any>({ maxEntries: 500, ttlMs: 30 * 60 * 1000 });

  // ── Working Memory Instance ────────────────────────────────────────────────
  private static workingMem: WorkingMemory | null = null;
  /** Session whose state is loaded in the working memory singleton (IMP-18). */
  private static workingMemSessionId: string | null = null;
  /** Last IDE session tracked — used for M₁ document-change ingestion. */
  private static activeSessionId: string | null = null;

  /**
   * Set the LLM instance for LLM-enhanced memory features.
   * Called from the tool implementation which has access to extras.llm.
   */
  static setLlm(llm: ILLM): void {
    BrainManager.llm = llm;
  }

  static getLlm(): ILLM | null {
    return BrainManager.llm;
  }

  static getActiveSessionId(): string | null {
    return BrainManager.activeSessionId;
  }

  /** Ingest editor/document text into M₁ sensory buffer (φ₁). */
  static ingestSensoryInput(content: string, sessionId?: string): void {
    const sid = sessionId ?? BrainManager.activeSessionId;
    if (!sid || !content.trim()) return;
    void import("./regions/SensoryCortex.js").then(({ SensoryCortex }) => {
      const wm = BrainManager.getWorkingMemory();
      SensoryCortex.setFlushHandler(sid, (text) => {
        void import("./regions/Thalamus.js").then(({ Thalamus }) => {
          Thalamus.attend(wm, text, "user");
        });
      });
      SensoryCortex.ingest(sid, content);
    });
  }

  /**
   * Get or create the WorkingMemory instance.
   * Optionally restores persisted state from a previous session.
   */
  static getWorkingMemory(): WorkingMemory {
    if (!BrainManager.workingMem) {
      BrainManager.workingMem = new WorkingMemory();
    }
    return BrainManager.workingMem;
  }

  /**
   * REL-06: flush M₂ when the session's topic shifts. No-op if a different
   * session's working memory is currently loaded.
   */
  static async onTopicShift(sessionId?: string): Promise<void> {
    if (
      sessionId &&
      BrainManager.workingMemSessionId &&
      sessionId !== BrainManager.workingMemSessionId
    ) {
      return;
    }
    BrainManager.getWorkingMemory().flushOnTopicShift();
    PrefrontalCortex.clearGoal(sessionId);
    if (sessionId) {
      const { closeOnTopicShift } = await import("./TaskContext.js");
      await closeOnTopicShift(sessionId);
    }
  }

  /**
   * Restore working memory state from a previous session.
   */
  static async restoreWorkingMemory(sessionId: string): Promise<void> {
    try {
      const db = await BrainStore.get();
      const row = await db.get(
        `SELECT value FROM brain_config WHERE key = ?`,
        `working_memory:${sessionId}`,
      );
      BrainManager.workingMem = new WorkingMemory();
      BrainManager.workingMemSessionId = sessionId;
      if (row?.value) {
        const state = JSON.parse(row.value as string) as WorkingMemoryState;
        BrainManager.workingMem.restore(state);
      }
    } catch {
      BrainManager.workingMem = new WorkingMemory();
      BrainManager.workingMemSessionId = sessionId;
    }
  }

  /** Persist working memory for a session to brain_config (IMP-18). */
  static async persistWorkingMemory(sessionId: string): Promise<void> {
    if (BrainManager.workingMemSessionId !== sessionId || !BrainManager.workingMem) {
      return;
    }
    try {
      const state = BrainManager.workingMem.serialize();
      const db = await BrainStore.get();
      await db.run(
        `INSERT OR REPLACE INTO brain_config (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
        `working_memory:${sessionId}`,
        JSON.stringify(state),
      );
    } catch {}
  }

  /**
   * Switch the in-memory working memory singleton to another session.
   * Persists outgoing state and restores incoming state from SQLite.
   */
  static async switchWorkingMemorySession(sessionId: string): Promise<void> {
    if (BrainManager.workingMemSessionId === sessionId) {
      return;
    }
    if (BrainManager.workingMemSessionId) {
      await BrainManager.persistWorkingMemory(BrainManager.workingMemSessionId);
    }
    BrainManager.workingMem = null;
    await BrainManager.restoreWorkingMemory(sessionId);
    PrefrontalCortex.switchSession(sessionId);
  }

  /**
   * Pin a semantic memory so it stays hot and is preferred during inject.
   */
  static async pinMemory(id: number): Promise<boolean> {
    const mem = await BrainStore.getSemanticById(id);
    if (!mem) return false;
    await BrainStore.addTag("semantic", id, "pinned");
    await BrainStore.removeTag("semantic", id, "mismatch");
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic
       SET importance_score = MAX(importance_score, 0.95),
           tier = 'hot',
           last_accessed_at = datetime('now'),
           mismatch_until = NULL
       WHERE id = ?`,
      [id],
    );
    BrainManager.invalidateMemoryCaches();
    BrainManager.emit("tag:added", { id, tag: "pinned" });
    return true;
  }

  /**
   * Unpin a semantic memory (keeps the memory, removes pin privilege).
   */
  static async unpinMemory(id: number): Promise<boolean> {
    const mem = await BrainStore.getSemanticById(id);
    if (!mem) return false;
    await BrainStore.removeTag("semantic", id, "pinned");
    BrainManager.invalidateMemoryCaches();
    BrainManager.emit("tag:removed", { id, tag: "pinned" });
    return true;
  }

  /**
   * REL-14: mark a semantic memory as not relevant. Does not delete.
   * Demotes it for the session's current topic for MISMATCH_TTL_DAYS.
   */
  static async recordMismatch(id: number, sessionId?: string): Promise<boolean> {
    const mem = await BrainStore.getSemanticById(id);
    if (!mem) return false;
    const sid = sessionId ?? mem.source_session_id ?? undefined;
    const topic = sid ? await BrainStore.getLatestSessionTopic(sid) : null;
    const ok = await BrainStore.recordMismatch(id, topic?.id ?? mem.topic_id ?? null);
    if (ok) {
      BrainManager.invalidateMemoryCaches();
      BrainManager.emit("memory:mismatched", { id, topic_id: topic?.id ?? null });
    }
    return ok;
  }

  // ── Event Broadcasting ─────────────────────────────────────────────────────
  private static eventListeners: MemoryEventListener[] = [];

  /**
   * Register a listener for memory events.
   * Returns an unsubscribe function.
   */
  static onEvent(listener: MemoryEventListener): () => void {
    BrainManager.eventListeners.push(listener);
    return () => {
      BrainManager.eventListeners = BrainManager.eventListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Remove all event listeners.
   */
  static clearEventListeners(): void {
    BrainManager.eventListeners = [];
  }

  /**
   * Publish a memory event (public API for pipeline and tools).
   */
  static publishEvent(type: MemoryEventType, data: Record<string, any> = {}): void {
    BrainManager.emit(type, data);
  }

  /**
   * Emit a memory event to all registered listeners.
   * Also writes to the audit trail.
   */
  private static emit(type: MemoryEventType, data: Record<string, any> = {}): void {
    const event: MemoryEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    for (const listener of BrainManager.eventListeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors disrupt memory operations
      }
    }
    // Write to audit trail (fire-and-forget)
    const targetType = type.split(":")[0];
    const targetId = data.id ?? data.session_id ?? null;
    BrainStore.auditLog(type, targetType, targetId, data).catch(() => {});
  }

  // ── Session Management ─────────────────────────────────────────────────────

  /**
   * Register or update a conversation session.
   */
  static async trackSession(sessionId: string, title: string, workspaceDir: string): Promise<void> {
    await BrainManager.switchWorkingMemorySession(sessionId);
    BrainManager.activeSessionId = sessionId;

    const existing = await BrainStore.getSession(sessionId);
    if (existing) {
      await BrainStore.updateSession(sessionId, { title, is_active: true });
      await BrainStore.ensureSessionProjectId(sessionId, workspaceDir);
    } else {
      await BrainStore.createSession(sessionId, title, workspaceDir);
    }
  }

  /**
   * List all tracked sessions.
   */
  static async listSessions(limit?: number, workspaceDir?: string): Promise<BrainSession[]> {
    return BrainStore.listSessions(limit, workspaceDir);
  }

  /**
   * Get a specific session with its details.
   */
  static async getSession(sessionId: string): Promise<BrainSession | null> {
    return BrainStore.getSession(sessionId);
  }

  /**
   * Delete a session and all its episodic memories.
   */
  static async deleteSession(sessionId: string): Promise<boolean> {
    // Auto-summarize before deletion if not already summarized
    const session = await BrainStore.getSession(sessionId);
    if (session && !session.summary) {
      try {
        await BrainManager.llmSummarizeSession(sessionId);
      } catch {
        // Still delete even if summarization fails
      }
    }
    const result = await BrainStore.deleteSession(sessionId);
    if (result) BrainManager.emit("session:deleted", { session_id: sessionId });
    return result;
  }

  /**
   * Close a session (mark as inactive) and auto-summarize.
   * This triggers LLM summarization if available, or heuristic fallback.
   */
  static async closeSession(sessionId: string, options?: { persistWorkingMemory?: boolean }): Promise<string> {
    const session = await BrainStore.getSession(sessionId);
    if (!session) return `Session "${sessionId}" not found.`;

    // Flush remaining buffered messages as a final topic segment
    AutoMemory.flushSessionTopics(sessionId, session.message_count ?? 0).catch(() => {});

    // P4.1 — Persist working memory state before closing. Skipped for
    // background stale-session closes: the working memory singleton holds the
    // *current* session's state, not the stale session's.
    if (options?.persistWorkingMemory !== false) {
      await BrainManager.persistWorkingMemory(sessionId);
    }

    if (BrainManager.activeSessionId === sessionId) {
      BrainManager.activeSessionId = null;
    }
    if (BrainManager.workingMemSessionId === sessionId) {
      BrainManager.workingMem = null;
      BrainManager.workingMemSessionId = null;
    }

    // Auto-summarize on close (when enabled)
    let summary = session.summary ?? "";
    const config = BrainStore.getConfig();
    if (!summary && config.auto_summarize) {
      try {
        const result = await BrainManager.llmSummarizeSession(sessionId);
        summary = result.summary;
      } catch {
        summary = await BrainManager.summarizeSession({ session_id: sessionId });
      }
    } else if (!summary && !config.auto_summarize) {
      summary = session.summary ?? "";
    }

    await BrainStore.updateSession(sessionId, { is_active: false });

    // Clear snapshot cache for closed session
    MemorySnapshot.remove(sessionId);

    BrainManager.emit("session:updated", { session_id: sessionId, is_active: false, auto_summarized: true });
    return `Session "${session.title}" closed and summarized.`;
  }

  /**
   * Close sessions that have been idle longer than `maxIdleHours`.
   * Called by the auto-consolidation scheduler so sessions abandoned by the
   * UI still get topic-flushed, summarized, and their working memory persisted.
   */
  static async closeStaleSessions(maxIdleHours: number = 24): Promise<number> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT id FROM brain_sessions
       WHERE is_active = 1
         AND updated_at < datetime('now', ?)
       ORDER BY updated_at ASC
       LIMIT 10`,
      [`-${Math.max(1, Math.floor(maxIdleHours))} hours`],
    );

    let closed = 0;
    for (const row of rows) {
      try {
        await BrainManager.closeSession((row as any).id, { persistWorkingMemory: false });
        closed++;
      } catch {
        // Best-effort — skip sessions that fail to close
      }
    }
    return closed;
  }

  // ── Episodic Memory (Conversation Tracking) ────────────────────────────────

  /**
   * Record a conversation turn in episodic memory.
   * Called automatically during chat to build the memory trace.
   */
  static async recordMessage(
    sessionId: string,
    role: string,
    content: string,
    options?: {
      type?: "user_message" | "assistant_message" | "tool_call" | "tool_result" | "system";
      tokenCount?: number;
      importance?: number;
      metadata?: Record<string, any>;
    },
  ): Promise<number> {
    const importance =
      options?.importance ?? BrainManager.estimateImportance(content, role);
    const id = await BrainStore.addEpisodic(
      sessionId,
      options?.type ?? (role === "user" ? "user_message" : "assistant_message"),
      role,
      content,
      options?.tokenCount ?? BrainManager.estimateTokens(content),
      importance,
      options?.metadata ?? {},
    );

    // Passive learning: extract facts/entities and detect topic shifts from
    // every recorded turn. Fire-and-forget — autoExtract respects the
    // auto_extract_enabled config and must never block conversation flow.
    if (role === "user" || role === "assistant") {
      BrainManager.autoExtract(content, role, sessionId, id).catch(() => {});

      // Keep working memory (the "currently thinking about" buffer) fresh:
      // gate attention toward this turn, then slot it in. Long content is
      // truncated — working memory holds gist, not transcripts.
      try {
        const wm = BrainManager.getWorkingMemory();
        wm.attendTo(content);
        wm.add({
          id: `episodic:${id}`,
          content: content.length > 500 ? `${content.slice(0, 500)}…` : content,
          source: role === "user" ? "user" : "episodic",
          relevance: Math.max(0.3, Math.min(1, importance)),
          metadata: { session_id: sessionId, role },
        });
      } catch {}
    }

    return id;
  }

  /**
   * Get conversation history for a session (episodic only — legacy).
   */
  static async getSessionHistory(sessionId: string, limit?: number) {
    return BrainStore.getEpisodicBySession(sessionId, limit);
  }

  /**
   * Full session history: episodic + semantic + topics + metadata (IMP-22).
   */
  static async getSessionHistoryFull(
    sessionId: string,
    options?: { episodicLimit?: number; semanticLimit?: number },
  ): Promise<import("./types.js").SessionHistoryResult> {
    const episodicLimit = options?.episodicLimit ?? 500;
    const semanticLimit = options?.semanticLimit ?? 200;

    const [session, episodic, semantic, topics, token_estimate] = await Promise.all([
      BrainStore.getSession(sessionId),
      BrainStore.getEpisodicBySession(sessionId, episodicLimit),
      BrainStore.getSemanticBySession(sessionId, semanticLimit),
      BrainStore.getSessionTopics(sessionId),
      BrainStore.estimateSessionTokens(sessionId),
    ]);

    return {
      session,
      episodic,
      semantic,
      topics,
      token_estimate,
      message_count: session?.message_count ?? episodic.length,
    };
  }

  // ── Semantic Memory (Knowledge Store) ──────────────────────────────────────

  /**
   * Store a piece of knowledge in semantic memory.
   * This is the brain's long-term storage — facts, decisions, patterns, etc.
   */
  static async store(input: StoreInput): Promise<number> {
    // P1.1 — Sanitize inputs
    const titleResult = InputSanitizer.enforce(input.title);
    const contentResult = InputSanitizer.enforce(input.content);
    input.title = titleResult;
    input.content = contentResult;

    // Auto-generate keywords if not provided
    if (!input.keywords) {
      input.keywords = BrainManager.extractKeywords(input.title + " " + input.content);
    }

    // Check for near-duplicates before storing
    const { id, deduplicated } = await BrainStore.storeSemanticDeduped(input);
    BrainManager.invalidateMemoryCaches();
    BrainManager.emit("memory:stored", {
      id,
      category: input.category,
      title: input.title,
      deduplicated,
      original_id: id,
    });

    if (!deduplicated) {
      CheckpointManager.recordChange().catch(() => {});
      MemorySnapshot.invalidateAll();
    }

    return id;
  }

  /**
   * Recall memories relevant to a query.
   * Searches both semantic and optionally episodic memory.
   * Returns results ranked by relevance.
   */
  static async recall(input: RecallInput): Promise<RecallResult> {
    const projectSessionIds = await getProjectSessionIds(
      input.session_id ?? BrainManager.getActiveSessionId() ?? undefined,
    );

    // Check LRU cache first
    const cacheKey = [
      "recall",
      input.query ?? "",
      input.category ?? "",
      input.session_id ?? "",
      BrainStore.getConfig().memory_scope,
      projectSessionIds?.join(",") ?? "global",
      input.include_episodic !== false ? "episodic" : "semantic-only",
      String(input.limit ?? 10),
    ].join(":");
    const cached = BrainManager.memoryCache.get(cacheKey);
    if (cached) {
      BrainManager.emit("memory:recalled", { query: input.query, semantic_count: cached.semantic.length, episodic_count: cached.episodic.length, cache_hit: true });
      return cached as RecallResult;
    }

    // P2.1+P2.2 — Use RetrievalFusion for multi-strategy search
    let semantic: any[];
    try {
      const fusionResults = await RetrievalFusion.search({
        query: input.query,
        limit: input.limit ?? BrainStore.getConfig().retrieval_top_k,
        category: input.category,
        includeEpisodic: false,
        projectSessionIds,
      });
      // Map fusion results back to semantic memory format
      semantic = fusionResults
        .filter((r) => r.type === "semantic")
        .map((r) => ({
          ...r.data,
          fusion_score: r.score,
          fusion_scores: r.scores,
        }));
    } catch {
      // Fallback to direct search if fusion fails
      semantic = filterSemanticByProjectScope(
        await BrainStore.searchSemantic(
          input.query,
          input.category,
          input.limit ?? 10,
        ),
        projectSessionIds,
      );
    }

    // Boost spaced repetition scores for retrieved memories (recall already increments access count)
    for (const mem of semantic) {
      SpacedRepetition.boostOnRetrieval(mem.id, { incrementAccess: false }).catch(() => {});
    }

    let episodic: any[] = [];
    if (input.include_episodic !== false) {
      episodic = filterEpisodicByProjectScope(
        await BrainStore.searchEpisodic(
          input.query,
          undefined,
          Math.min(input.limit ?? 10, 20),
        ),
        projectSessionIds,
      );
    }

    // Gather associations for top results
    const associations: any[] = [];
    for (const mem of semantic.slice(0, 3)) {
      const assocs = await BrainStore.getAssociations("semantic", mem.id);
      associations.push(...assocs);
    }

    const result: RecallResult = { semantic, episodic, associations };

    // Cache the result
    BrainManager.memoryCache.set(cacheKey, result);

    BrainManager.emit("memory:recalled", { query: input.query, semantic_count: semantic.length, episodic_count: episodic.length });
    return result;
  }

  /**
   * Delete a semantic memory by ID.
   */
  static async forget(id: number): Promise<boolean> {
    // Safety checkpoint before destructive operation
    await CheckpointManager.beforeDestructiveOp("delete").catch(() => {});

    const result = await BrainStore.deleteSemantic(id);
    if (result) {
      BrainManager.invalidateMemoryCaches();
      BrainManager.emit("memory:deleted", { id });
      MemorySnapshot.invalidateAll();
    }
    return result;
  }

  /**
   * Delete many semantic memories in one transaction and one safety checkpoint.
   */
  static async forgetMany(ids: number[]): Promise<BatchDeleteResult> {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (unique.length === 0) {
      return {
        target_type: "semantic",
        requested: 0,
        deleted: 0,
        failed: 0,
        errors: [],
      };
    }

    await CheckpointManager.beforeDestructiveOp("batch_delete").catch(() => {});
    const result = await BatchOperations.batchDelete({
      target_type: "semantic",
      ids: unique,
    });
    if (result.deleted > 0) {
      BrainManager.invalidateMemoryCaches();
      BrainManager.emit("memory:deleted", { ids: unique, deleted: result.deleted });
      MemorySnapshot.invalidateAll();
    }
    return result;
  }

  /**
   * Pin many semantic memories in one transaction.
   */
  static async pinMemories(ids: number[]): Promise<{ updated: number; failed: number }> {
    const result = await BatchOperations.batchPin(ids);
    if (result.updated > 0) {
      BrainManager.invalidateMemoryCaches();
      BrainManager.emit("tag:added", { ids, tag: "pinned", updated: result.updated });
    }
    return result;
  }

  /**
   * Unpin many semantic memories in one transaction.
   */
  static async unpinMemories(ids: number[]): Promise<{ updated: number; failed: number }> {
    const result = await BatchOperations.batchUnpin(ids);
    if (result.updated > 0) {
      BrainManager.invalidateMemoryCaches();
      BrainManager.emit("tag:removed", { ids, tag: "pinned", updated: result.updated });
    }
    return result;
  }

  // ── Session Summarization ──────────────────────────────────────────────────

  /**
   * Generate a summary of a session's conversation.
   * This creates a compressed representation for long-term storage.
   */
  static async summarizeSession(input: SessionSummaryInput): Promise<string> {
    const history = await BrainStore.getEpisodicBySession(input.session_id, 500);
    const session = await BrainStore.getSession(input.session_id);

    if (history.length === 0) {
      return "No conversation history found for this session.";
    }

    // Build a condensed summary from the conversation
    const summaryParts: string[] = [];
    summaryParts.push(`Session: ${session?.title ?? input.session_id}`);
    summaryParts.push(`Messages: ${history.length}`);
    summaryParts.push(`Period: ${history[0].created_at} — ${history[history.length - 1].created_at}`);
    summaryParts.push("");

    // Extract key topics from high-importance messages
    const important = history
      .filter((m) => m.importance_score >= 0.6)
      .slice(0, 20);

    if (important.length > 0) {
      summaryParts.push("Key Topics:");
      for (const msg of important) {
        const preview = msg.content.substring(0, 200).replace(/\n/g, " ");
        summaryParts.push(`  [${msg.role}] ${preview}${msg.content.length > 200 ? "..." : ""}`);
      }
      summaryParts.push("");
    }

    // Gather user messages as topic indicators
    const userMessages = history.filter((m) => m.role === "user").slice(0, 30);
    if (userMessages.length > 0) {
      summaryParts.push("User Requests:");
      for (const msg of userMessages) {
        const preview = msg.content.substring(0, 150).replace(/\n/g, " ");
        summaryParts.push(`  - ${preview}${msg.content.length > 150 ? "..." : ""}`);
      }
    }

    const summary = summaryParts.join("\n");

    // Store the summary on the session
    await BrainStore.updateSession(input.session_id, { summary });
    BrainManager.invalidateMemoryCaches();
    BrainManager.emit("session:summarized", { session_id: input.session_id, summary_length: summary.length });

    // Also store as a semantic memory for cross-session recall
    await BrainStore.storeSemantic({
      category: "summary",
      title: `Session Summary: ${session?.title ?? input.session_id}`,
      content: summary,
      session_id: input.session_id,
      keywords: BrainManager.extractKeywords(summary),
      importance: 0.7,
    });

    return summary;
  }

  // ── Associations ───────────────────────────────────────────────────────────

  /**
   * Create an association between two memories.
   */
  static async associate(input: AssociateInput): Promise<number> {
    const id = await BrainStore.createAssociation(input);
    BrainManager.invalidateMemoryCaches();
    BrainManager.emit("edge:added", { id, source: `${input.source_type}#${input.source_id}`, target: `${input.target_type}#${input.target_id}`, relationship: input.relationship });
    return id;
  }

  // ── Consolidation ──────────────────────────────────────────────────────────

  // Track consolidation count for auto-checkpoint
  private static consolidationCount = 0;

  // Auto-consolidation timer
  private static consolidationTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start the auto-consolidation scheduler.
   * Runs consolidation periodically based on the configured interval.
   */
  static startAutoConsolidation(): void {
    if (BrainManager.consolidationTimer) return; // Already running
    const config = BrainStore.getConfig();
    const intervalMs = config.consolidation_interval_hours * 60 * 60 * 1000;
    if (intervalMs <= 0) return;

    BrainManager.consolidationTimer = setInterval(async () => {
      try {
        // Close sessions that have been idle for a day so topic flushing,
        // working-memory persistence, and auto-summarization actually run
        // even when the UI never closes a session explicitly.
        await BrainManager.closeStaleSessions(24).catch(() => {});

        // Run the full sleep cycle every tick — decay, promotion, compression,
        // and distillation must happen regardless of capacity, not only when
        // the hot tier is nearly full.
        await BrainManager.consolidate();
      } catch {
        // Silently ignore auto-consolidation failures
      }
    }, intervalMs);

    // Don't prevent Node from exiting
    if (BrainManager.consolidationTimer && typeof BrainManager.consolidationTimer === "object" && "unref" in BrainManager.consolidationTimer) {
      BrainManager.consolidationTimer.unref();
    }

    BrainManager.consolidationTracker.setSchedulerActive(true, config.consolidation_interval_hours);
  }

  /**
   * Stop the auto-consolidation scheduler.
   */
  static stopAutoConsolidation(): void {
    if (BrainManager.consolidationTimer) {
      clearInterval(BrainManager.consolidationTimer);
      BrainManager.consolidationTimer = null;
    }
    BrainManager.consolidationTracker.setSchedulerActive(false, 0);
  }

  /**
   * Run memory consolidation with full sleep-cycle phases.
   * Replaces basic tiering with REM/NREM-inspired consolidation:
   *   NREM-1: Replay & strengthen important memories
   *   NREM-2: Ebbinghaus decay & tier demotion
   *   NREM-3: Cold-tier compression
   *   REM:    Episodic-to-semantic distillation
   *   Post:   Graph strengthening & high-value promotion
   * Auto-creates a checkpoint every N consolidations (configurable).
   */
  static async consolidate(): Promise<SleepCycleResult> {
    // Safety checkpoint before destructive consolidation
    await CheckpointManager.beforeDestructiveOp("consolidate").catch(() => {});

    const start = performance.now();
    const result = await BrainManager.metrics.measure("consolidate", () => SleepConsolidation.runCycle());
    const durationMs = performance.now() - start;

    BrainManager.consolidationTracker.record(result, durationMs);
    BrainManager.emit("consolidation:completed", {
      promoted: result.promoted, demoted: result.demoted, pruned: result.pruned,
      replayed: result.replayed, strengthened: result.strengthened,
      distilled: result.distilled, edges_strengthened: result.edges_strengthened,
      compressed: result.compressed, sub_phases: result.sub_phases,
      duration_ms: durationMs,
    });

    // Auto-checkpoint after N consolidations
    const config = BrainStore.getConfig();
    if (config.auto_checkpoint_interval > 0) {
      BrainManager.consolidationCount++;
      if (BrainManager.consolidationCount % config.auto_checkpoint_interval === 0) {
        try {
          await BrainStore.createCheckpoint(`auto-consolidation-${BrainManager.consolidationCount}`);
        } catch {
          // Silently ignore checkpoint failures
        }
      }
    }

    return result;
  }

  // ── Statistics ─────────────────────────────────────────────────────────────

  /**
   * Get brain statistics.
   */
  static async getStats(): Promise<BrainStats> {
    return BrainStore.getStats();
  }

  // ── Auto-context: Build context from memory for conversation ───────────────

  /**
   * Build relevant context from memory for a new message.
   * This is the key function that enables "unlimited context window".
   *
   * Given any user message, it searches across ALL sessions to find relevant
   * semantic knowledge and episodic memories, then returns them as context.
   */
  static async buildContextForMessage(
    message: string,
    currentSessionId?: string,
    maxTokens?: number,
  ): Promise<string> {
    const result = await BrainManager.buildContextDetailed(
      message,
      currentSessionId,
      maxTokens,
    );
    return result.context;
  }

  static async buildContextDetailed(
    message: string,
    currentSessionId?: string,
    maxTokens?: number,
    options?: { goal?: string; memory_mode?: MemoryMode },
  ) {
    const result = await MemoryPipeline.runPreTurn({
      message,
      session_id: currentSessionId,
      max_tokens: maxTokens,
      goal: options?.goal,
    });
    return result.context!;
  }

  /**
   * Run the 8-phase memory pipeline for a single phase or full pre/post turn.
   */
  static async runPipeline(params: {
    mode: "pre_turn" | "post_turn" | "full_cycle" | MemoryPhase;
    message?: string;
    session_id?: string;
    role?: string;
    goal?: string;
    max_tokens?: number;
    turn_content?: string;
  }) {
    if (params.mode === "pre_turn") {
      return MemoryPipeline.runPreTurn({
        message: params.message ?? "",
        session_id: params.session_id,
        goal: params.goal,
        max_tokens: params.max_tokens,
      });
    }
    if (params.mode === "post_turn") {
      return MemoryPipeline.runPostTurn({
        message: params.message ?? "",
        session_id: params.session_id,
        role: params.role,
        turn_content: params.turn_content,
      });
    }
    if (params.mode === "full_cycle") {
      return MemoryPipeline.runFullCycle({
        message: params.message ?? "",
        session_id: params.session_id,
        role: params.role,
        goal: params.goal,
        max_tokens: params.max_tokens,
        turn_content: params.turn_content,
      });
    }
    return {
      phases: [
        await MemoryPipeline.runPhase(params.mode, {
          message: params.message ?? "",
          session_id: params.session_id,
          role: params.role,
          turn_content: params.turn_content,
        }),
      ],
    };
  }

  static getPhaseStatus() {
    const consolidationStats = BrainManager.consolidationTracker.getStats();
    return MemoryPipeline.getPhaseStatus(consolidationStats.scheduler_active);
  }

  /** Local C_effective metrics (IMP-04 / IMP-16). Part II M₁–M₅ hierarchy. */
  static async getEffectiveContext() {
    const { calculateHierarchyEffective } = await import("./MemoryHierarchy.js");
    const config = BrainStore.getConfig();
    const wmStats = BrainManager.getWorkingMemory().getStats();
    const hierarchy = await calculateHierarchyEffective({
      activeSessionId: BrainManager.activeSessionId,
      workingMemoryTokens: wmStats.total_tokens,
    });
    const graphEntityCount = await BrainStore.countEntities();
    const compression = BrainManager.compressionMetrics.getStats();
    const buildStats = BrainManager.effectiveContextTracker.getStats();
    const sensory = (await import("./SensoryBuffer.js")).SensoryBuffer.getStats(
      BrainManager.activeSessionId ?? undefined,
    );

    return {
      /** W_max — configured active context window (Part VII). */
      active_window_tokens: config.context_max_tokens,
      context_max_tokens: config.context_max_tokens,
      last_context_tokens_used: buildStats.last_context_tokens_used,
      last_context_max_tokens: buildStats.last_context_max_tokens,
      window_utilization: buildStats.window_utilization,
      tier_tokens: hierarchy.tier_tokens,
      memory_levels: hierarchy.levels,
      hierarchy_effective_tokens: hierarchy.hierarchy_effective_tokens,
      working_memory_tokens: wmStats.total_tokens,
      working_memory_budget: wmStats.token_budget,
      sensory_buffer_tokens: sensory.estimated_tokens,
      sensory_buffer_ms: sensory.buffer_ms,
      graph_entity_count: graphEntityCount,
      graph_max_entities: config.graph_max_entities,
      graph_max_depth: config.graph_max_depth,
      graph_depth_decay_gamma: config.graph_depth_decay_gamma,
      graph_cap_utilization:
        config.graph_max_entities > 0
          ? graphEntityCount / config.graph_max_entities
          : 0,
      total_effective: config.context_max_tokens + hierarchy.hierarchy_effective_tokens,
      compression_ratios: hierarchy.compression_ratios,
      memory_tokens_saved: compression.total_tokens_saved,
      last_compression_tokens_saved: compression.last_tokens_saved,
      compression_events: compression.compression_events,
    };
  }

  /** Record tokens saved from compress-oldest overflow (IMP-15). */
  static recordCompressionMetrics(tokensSaved: number): void {
    if (tokensSaved <= 0) return;
    BrainManager.compressionMetrics.record(tokensSaved);
    BrainManager.recordMetric("build_context_compression", 0, tokensSaved, true);
  }

  /** Record last context build utilization for capacity dashboard (IMP-16). */
  static recordContextBuild(tokensUsed: number, maxTokens: number): void {
    BrainManager.effectiveContextTracker.recordBuild(tokensUsed, maxTokens);
  }

  static getContextBuildStats() {
    return BrainManager.effectiveContextTracker.getStats();
  }

  static getCompressionStats() {
    return BrainManager.compressionMetrics.getStats();
  }

  /** Score task difficulty and route to configured model (IMP-17). */
  static routeTask(input: TaskScoreInput): TaskRouteResult {
    return TaskRouter.scoreAndRoute(input);
  }

  /** Start local autonomous execution loop (IMP-24). */
  static async runAutonomousLoop(input: AutonomousLoopInput): Promise<AutonomousLoopResult> {
    return LocalAutonomousLoop.run(input);
  }

  /** Cancel a running autonomous loop for a session. */
  static cancelAutonomousLoop(sessionId: string): boolean {
    return LocalAutonomousLoop.cancel(sessionId);
  }

  /** Get status of a running or recently completed autonomous loop. */
  static getAutonomousLoopStatus(sessionId: string): AutonomousLoopStatus | null {
    return LocalAutonomousLoop.getStatus(sessionId);
  }

  // ── Auto-Memory Extraction ─────────────────────────────────────────────────

  /**
   * Automatically extract memories from a message.
   * Called during conversation tracking for passive knowledge building.
   * Triggers LLM-enhanced extraction periodically when available.
   * Also runs topic shift detection on each message.
   */
  static async autoExtract(
    content: string,
    role: string,
    sessionId: string,
    messageIndex?: number,
  ): Promise<{ semantic_count: number; entity_count: number }> {
    const config = BrainStore.getConfig();
    if (!config.auto_extract_enabled) {
      return { semantic_count: 0, entity_count: 0 };
    }
    const result = await AutoMemory.extract(content, role, sessionId);
    if (result.semantic_count > 0 || result.entity_count > 0) {
      BrainManager.emit("auto_extract:completed", { session_id: sessionId, semantic_count: result.semantic_count, entity_count: result.entity_count });
    }

    // Trigger LLM-enhanced extraction periodically for substantial messages
    if (result.should_llm_extract && config.llm_entity_extraction_enabled && BrainManager.llm) {
      // Fire-and-forget: don't block the main flow
      BrainManager.llmExtractEntities(content, sessionId).catch(() => {
        // Silently ignore LLM extraction failures
      });
    }

    // Auto-detect topic shifts (fire-and-forget)
    if (messageIndex !== undefined) {
      AutoMemory.detectTopicShift(sessionId, role, content, messageIndex)
        .then((topic) => {
          if (topic) {
            BrainManager.emit("topic:detected", { session_id: sessionId, topic: topic.topic, keywords: topic.keywords, confidence: topic.confidence });
          }
        })
        .catch(() => {});
    }

    return { semantic_count: result.semantic_count, entity_count: result.entity_count };
  }

  // ── Knowledge Graph ────────────────────────────────────────────────────────

  static async addEntity(input: AddEntityInput): Promise<number> {
    const id = await KnowledgeGraph.addEntity(input);
    BrainManager.emit("entity:added", { id, name: input.name, entity_type: input.entity_type });
    return id;
  }

  static async searchEntities(query: string, entityType?: any, limit?: number) {
    return KnowledgeGraph.searchEntities(query, entityType, limit);
  }

  static async addEdge(input: AddEdgeInput): Promise<number> {
    const id = await KnowledgeGraph.addEdge(input);
    BrainManager.emit("edge:added", { id, source_entity_id: input.source_entity_id, target_entity_id: input.target_entity_id, relationship: input.relationship });
    return id;
  }

  static async exploreGraph(input: ExploreGraphInput) {
    return KnowledgeGraph.explore(input);
  }

  static async getGraphStats() {
    return KnowledgeGraph.getStats();
  }

  /** Knowledge graph cap + γ decay config (IMP-11). */
  static async getGraphCapStatus() {
    return KnowledgeGraph.getCapStatus();
  }

  static async extractEntities(text: string) {
    return KnowledgeGraph.extractAndStore(text);
  }

  // ── Learning Engine ────────────────────────────────────────────────────────

  static async learnPattern(input: LearnPatternInput): Promise<number> {
    const id = await LearningEngine.learnPattern(input);
    BrainManager.emit("pattern:learned", { id, goal_type: input.goal_type, signature: input.pattern_signature, success: input.success });
    return id;
  }

  static async suggestApproach(query: string, goalType?: any, limit?: number) {
    return LearningEngine.suggestApproach(query, goalType, limit);
  }

  static async getPatterns(goalType?: any, limit?: number) {
    return LearningEngine.getPatterns(goalType, limit);
  }

  // ── Procedural Memory ──────────────────────────────────────────────────────

  static async storeProcedure(input: StoreProcedureInput): Promise<number> {
    const id = await BrainStore.addProcedure({
      name: input.name,
      description: input.description,
      steps: input.steps,
      trigger_pattern: input.trigger_pattern,
      category: input.category ?? "general",
    });
    BrainManager.emit("procedure:stored", { id, name: input.name, steps_count: input.steps.length });
    return id;
  }

  static async getProcedures(category?: string, limit?: number) {
    return BrainStore.getAllProcedures(category, limit);
  }

  static async executeProcedure(id: number, success: boolean) {
    await BrainStore.recordProcedureExecution(id, success);
    const proc = await BrainStore.getProcedure(id);
    BrainManager.emit("procedure:executed", { id, success, name: proc?.name });
    return proc;
  }

  // ── Tags ───────────────────────────────────────────────────────────────────

  static async tag(input: TagInput): Promise<number> {
    const id = await BrainStore.addTag(input.memory_type, input.memory_id, input.tag);
    BrainManager.emit("tag:added", { id, memory_type: input.memory_type, memory_id: input.memory_id, tag: input.tag });
    return id;
  }

  static async untag(input: TagInput): Promise<boolean> {
    const result = await BrainStore.removeTag(input.memory_type, input.memory_id, input.tag);
    if (result) BrainManager.emit("tag:removed", { memory_type: input.memory_type, memory_id: input.memory_id, tag: input.tag });
    return result;
  }

  static async searchByTag(tag: string, memoryType?: string, limit?: number) {
    return BrainStore.searchByTag(tag, memoryType, limit);
  }

  // ── Collections ────────────────────────────────────────────────────────────

  static async createCollection(input: CollectionInput): Promise<number> {
    const id = await BrainStore.createCollection(input.name, input.description ?? "");
    BrainManager.emit("collection:created", { id, name: input.name });
    return id;
  }

  static async listCollections(limit?: number) {
    return BrainStore.listCollections(limit);
  }

  static async addToCollection(input: AddToCollectionInput): Promise<number> {
    const id = await BrainStore.addToCollection(input.collection_id, input.memory_type, input.memory_id);
    BrainManager.emit("collection:item_added", { id, collection_id: input.collection_id, memory_type: input.memory_type, memory_id: input.memory_id });
    return id;
  }

  // ── Health & Self-Management ───────────────────────────────────────────────

  static async getHealth(): Promise<HealthStatus> {
    return BrainStore.getHealth();
  }

  static async optimize(): Promise<string> {
    return BrainManager.metrics.measure("optimize", () => BrainStore.optimize());
  }

  static getConfig() {
    return BrainStore.getConfig();
  }

  static async updateConfig(input: MemoryConfigInput): Promise<string> {
    await BrainStore.saveConfig(input.key, input.value);
    // Hot-reload working memory when its config keys change (IMP-05).
    if (input.key.startsWith("working_memory_")) {
      BrainManager.workingMem = null;
      BrainManager.workingMemSessionId = null;
    }
    if (input.key === "sensory_buffer_ms") {
      const { SensoryBuffer } = await import("./SensoryBuffer.js");
      SensoryBuffer.rescheduleAll();
    }
    if (input.key === "graph_max_entities") {
      const pruned = await KnowledgeGraph.enforceEntityCap();
      if (pruned > 0) {
        return `Config updated: ${input.key} = ${input.value} (pruned ${pruned} entities to fit cap)`;
      }
    }
    return `Config updated: ${input.key} = ${input.value}`;
  }

  // ── Performance Metrics ────────────────────────────────────────────────────

  /**
   * Record an operation metric (called internally or from tool implementations).
   */
  static recordMetric(operation: string, durationMs: number, tokenCount: number = 0, success: boolean = true): void {
    BrainManager.metrics.record({
      operation, duration_ms: durationMs, token_count: tokenCount, success, timestamp: Date.now(),
    });
  }

  /**
   * Get performance metrics summary.
   * @param windowMs — Optional time window in ms (e.g. 3600000 for last hour)
   */
  static getMetrics(windowMs?: number): MetricsSummary {
    return BrainManager.metrics.getSummary(windowMs);
  }

  /** Persist a metrics snapshot for trend dashboard (IMP-16). */
  static async storeMetricsSnapshot(windowMs?: number): Promise<number> {
    const mSummary = BrainManager.getMetrics(windowMs);
    const stats = await BrainStore.getStats();
    const compression = BrainManager.compressionMetrics.getStats();
    const effective = await BrainManager.getEffectiveContext();
    return MetricsStorage.storeSnapshot(
      mSummary,
      stats.db_size_bytes,
      stats.total_semantic + stats.total_episodic,
      compression.total_tokens_saved,
      effective.hierarchy_effective_tokens,
      effective.total_effective,
    );
  }

  /** Structured metrics trend for dashboard (IMP-16). */
  static async getMetricsTrend(hours = 24): Promise<MetricsTrend> {
    return MetricsStorage.analyzeTrends(hours);
  }

  /**
   * Wrap an async operation with metric collection.
   */
  static async measureOperation<T>(operation: string, fn: () => Promise<T>, tokenCount?: number): Promise<T> {
    return BrainManager.metrics.measure(operation, fn, tokenCount);
  }

  // ── Multi-dimensional Health Scoring ───────────────────────────────────────

  /**
   * Compute a composite health score across latency, accuracy, efficiency,
   * capacity, and fragmentation dimensions.
   */
  static async getHealthScore(weights?: Record<string, number>): Promise<HealthScore> {
    const metrics = BrainManager.metrics.getSummary();
    const basicHealth = await BrainStore.getHealth();
    return HealthScorer.score(metrics, basicHealth, weights);
  }

  // ── Predictive Analytics ───────────────────────────────────────────────────

  /**
   * Update predictive analytics with latest metrics snapshot
   * and return a capacity forecast.
   */
  static async getCapacityForecast(): Promise<CapacityForecast> {
    const metrics = BrainManager.metrics.getSummary();
    const health = await BrainStore.getHealth();
    const stats = await BrainStore.getStats();
    const totalMemories = stats.total_episodic + stats.total_semantic;

    BrainManager.predictive.update(metrics, health.db_size_bytes);
    return BrainManager.predictive.forecast(health.db_size_bytes, totalMemories);
  }

  // ── Healing Actions ────────────────────────────────────────────────────────

  /**
   * Run a specific healing action.
   */
  static async runHealingAction(action: HealingAction): Promise<HealingResult> {
    return BrainManager.metrics.measure(`heal:${action}`, () => BrainManager.healing.runAction(action));
  }

  /**
   * Auto-heal based on current health status.
   * Adaptively selects the most effective healing strategies.
   */
  static async autoHeal(): Promise<HealingResult[]> {
    const health = await BrainStore.getHealth();
    return BrainManager.healing.autoHeal(health);
  }

  /**
   * Get healing strategy effectiveness rankings.
   */
  static getHealingStrategies(): HealingStrategy[] {
    return BrainManager.healing.getStrategies();
  }

  // ── Consolidation Stats ────────────────────────────────────────────────────

  /**
   * Get detailed consolidation statistics including scheduler state,
   * run history, and aggregate counts.
   */
  static getConsolidationStats(): ConsolidationStats {
    return BrainManager.consolidationTracker.getStats();
  }

  /** Part IV — memories due for spaced repetition review. */
  static async getReviewDue(limit = 20): Promise<SpacedRepetitionState[]> {
    const cfg = BrainStore.getConfig();
    return SpacedRepetition.getMemoriesDueForReview(cfg.ebbinghaus_review_threshold, limit);
  }

  /** Part IV — Ebbinghaus config + aggregate retention stats for dashboard. */
  static async getEbbinghausStats(): Promise<{
    config: ReturnType<typeof import("./memoryConfigAccess.js").getEbbinghausConfig>;
    review_due_count: number;
    avg_retention: number;
  }> {
    const { getEbbinghausConfig } = await import("./memoryConfigAccess.js");
    const due = await BrainManager.getReviewDue(100);
    const avgRetention =
      due.length > 0
        ? due.reduce((sum, d) => sum + d.current_retention, 0) / due.length
        : 1.0;
    return {
      config: getEbbinghausConfig(),
      review_due_count: due.length,
      avg_retention: avgRetention,
    };
  }

  // ── Import/Export ──────────────────────────────────────────────────────────

  static async exportMemories(): Promise<string> {
    const data = await BrainStore.exportAll();
    const exportPath = path.join(getMemoryBrainPath(), `brain-export-${Date.now()}.json`);
    fs.writeFileSync(exportPath, JSON.stringify(data, null, 2));
    return `Memories exported to: ${exportPath}\nSessions: ${data.sessions.length}, Semantic: ${data.semantic.length}, Episodic: ${data.episodic.length}, Entities: ${data.entities.length}, Patterns: ${data.patterns.length}, Procedures: ${data.procedures.length}`;
  }

  static async importMemories(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Import file not found: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const data: MemoryExport = JSON.parse(raw);
    if (!data.version) {
      throw new Error("Invalid export file: missing version field");
    }
    const result = await BrainStore.importData(data);
    const summary = Object.entries(result.imported)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    return `Import complete: ${summary}`;
  }

  // ── Cross-Session Backlog Search ───────────────────────────────────────────

  /**
   * Search across ALL sessions for matching content.
   * Supports date range filtering, role filtering, and session ID scoping.
   * This is the "find back logs to remember" feature.
   */
  static async searchBacklogs(input: BacklogSearchInput) {
    let sessionIds = input.session_ids;
    if (!sessionIds) {
      const { sessionIds: scoped } = await resolveProjectScope(
        input.session_id ?? BrainManager.getActiveSessionId() ?? undefined,
        input.workspace_dir,
      );
      sessionIds = scoped;
    }

    return BrainStore.searchBacklogs(input.query, {
      limit: input.limit,
      session_ids: sessionIds,
      date_from: input.date_from,
      date_to: input.date_to,
      roles: input.roles,
      include_semantic: input.include_semantic,
      include_episodic: input.include_episodic,
    });
  }

  // ── LLM-Enhanced Features ─────────────────────────────────────────────────

  /**
   * LLM-powered entity extraction.
   * Falls back to rule-based if LLM unavailable.
   */
  static async llmExtractEntities(text: string, sessionId?: string) {
    const llm = BrainManager.llm;
    if (!llm) {
      const fallback = await KnowledgeGraph.extractAndStore(text);
      return { ...fallback, llm_used: false };
    }
    return LlmMemoryService.extractEntities(llm, text, sessionId);
  }

  /**
   * LLM-powered session summarization.
   * Falls back to heuristic summary if LLM unavailable.
   */
  static async llmSummarizeSession(sessionId: string, detailLevel?: "brief" | "detailed") {
    const config = BrainStore.getConfig();
    const llm = BrainManager.llm;
    if (!llm || !config.llm_summarization_enabled) {
      // Fall back to existing heuristic summarize
      const summary = await BrainManager.summarizeSession({ session_id: sessionId });
      return { summary, llm_used: false };
    }
    return LlmMemoryService.summarizeSession(llm, sessionId, detailLevel ?? config.preferred_summary_detail);
  }

  /**
   * LLM-powered importance evaluation.
   * Falls back to heuristic scoring if LLM unavailable.
   */
  static async llmEvaluateImportance(content: string, role?: string, context?: string) {
    const config = BrainStore.getConfig();
    const llm = BrainManager.llm;
    if (!llm || !config.llm_importance_scoring_enabled) {
      const score = BrainManager.estimateImportance(content, role ?? "user");
      return { score, reason: "Heuristic scoring", llm_used: false };
    }
    return LlmMemoryService.evaluateImportance(llm, content, role, context);
  }

  /**
   * LLM-powered post-action memory update.
   * After a tool action completes, the LLM decides what should be remembered.
   */
  static async llmPostActionMemory(
    actionDescription: string,
    actionResult: string,
    sessionId?: string,
  ) {
    const config = BrainStore.getConfig();
    const llm = BrainManager.llm;
    if (!llm || !config.llm_post_action_memory_enabled) {
      return { memories_created: 0, entities_created: 0, patterns_recorded: 0, llm_used: false };
    }
    return LlmMemoryService.postActionMemory(llm, actionDescription, actionResult, sessionId);
  }

  /**
   * Local context-budget estimate (chars ÷ 4). KnoxChat bills at the provider.
   */
  static countTokensAccurate(text: string): number {
    return BrainManager.estimateTokens(text);
  }

  // ── Checkpoint / Rollback ──────────────────────────────────────────────────

  static async createCheckpoint(label: string, workspaceCheckpointId?: string) {
    const cp = await BrainStore.createCheckpoint(label, workspaceCheckpointId);
    BrainManager.emit("checkpoint:created", { id: cp.id, label });
    return cp;
  }

  static async listCheckpoints(limit?: number) {
    return BrainStore.listCheckpoints(limit);
  }

  static async findCheckpointByWorkspaceId(workspaceCheckpointId: string) {
    return BrainStore.findCheckpointByWorkspaceId(workspaceCheckpointId);
  }

  static async trimEpisodicAfter(sessionId: string, createdAt: string) {
    return BrainStore.trimEpisodicAfter(sessionId, createdAt);
  }

  static async rollbackCheckpoint(checkpointId: number) {
    const result = await BrainStore.rollbackCheckpoint(checkpointId);
    BrainManager.emit("checkpoint:rolled_back", { id: checkpointId });
    return result;
  }

  static async deleteCheckpoint(checkpointId: number) {
    const result = await BrainStore.deleteCheckpoint(checkpointId);
    if (result) BrainManager.emit("checkpoint:deleted", { id: checkpointId });
    return result;
  }

  // ── Tool Dispatch ──────────────────────────────────────────────────────────

  /**
   * Main dispatch entry point for the Memory tool.
   * Routes the action to the appropriate handler and returns formatted output.
   */
  static async dispatch(action: MemoryBrainAction, params: any): Promise<string> {
    switch (action) {
      // ── Original Actions ─────────────────────────────────────────────────
      case "store": {
        const id = await BrainManager.store(params as StoreInput);
        return `Memory stored successfully (ID: ${id}). Category: ${params.category}, Title: "${params.title}"`;
      }

      case "recall": {
        const result = await BrainManager.recall(params as RecallInput);
        return BrainManager.formatRecallResult(result);
      }

      case "search": {
        // P2.1+P2.2 — Use RetrievalFusion for search dispatch
        const projectSessionIds = await getProjectSessionIds(
          params.session_id ?? BrainManager.getActiveSessionId() ?? undefined,
          params.workspace_directory,
        );
        let semantic: any[];
        try {
          const fusionResults = await RetrievalFusion.search({
            query: params.query,
            limit: params.limit ?? 10,
            category: params.category,
            includeEpisodic: false,
            projectSessionIds,
          });
          semantic = fusionResults
            .filter((r) => r.type === "semantic")
            .map((r) => ({
              ...r.data,
              fusion_score: r.score,
            }));
        } catch {
          semantic = filterSemanticByProjectScope(
            await BrainStore.searchSemantic(
              params.query,
              params.category,
              params.limit ?? 10,
            ),
            projectSessionIds,
          );
        }
        return BrainManager.formatSemanticList(semantic, `Search results for: "${params.query}"`);
      }

      case "summarize_session": {
        const summary = await BrainManager.summarizeSession(params as SessionSummaryInput);
        return summary;
      }

      case "list_sessions": {
        const sessions = await BrainManager.listSessions(params?.limit, params?.workspace_directory);
        return BrainManager.formatSessionList(sessions);
      }

      case "get_session": {
        const session = await BrainManager.getSession(params.session_id);
        if (!session) return `Session "${params.session_id}" not found.`;
        const history = await BrainStore.getEpisodicBySession(params.session_id, params.limit ?? 50);
        return BrainManager.formatSessionDetail(session, history);
      }

      case "close_session": {
        return await BrainManager.closeSession(params.session_id);
      }

      case "delete": {
        const success = await BrainManager.forget(params.id);
        if (!success) {
          return `Memory #${params.id} not found.`;
        }
        let offer = "";
        try {
          const { formatLinkedRestoreOffer } = await import(
            "../../soul/extractToolFiles.js"
          );
          const { getLastSoulEvent } = await import(
            "../../soul/recordSoulEvent.js"
          );
          const sessionId = BrainManager.getActiveSessionId();
          offer = sessionId
            ? formatLinkedRestoreOffer(
                getLastSoulEvent(sessionId)?.workspaceCheckpointId,
              )
            : "";
        } catch {
          // Offer is best-effort.
        }
        return offer
          ? `Memory #${params.id} deleted.\n${offer}`
          : `Memory #${params.id} deleted.`;
      }

      case "mismatch": {
        const demoted = await BrainManager.recordMismatch(
          params.id,
          params.session_id,
        );
        return demoted
          ? `Memory #${params.id} marked not relevant.`
          : `Memory #${params.id} not found.`;
      }

      case "get_stats": {
        const stats = await BrainManager.getStats();
        return BrainManager.formatStats(stats);
      }

      case "consolidate": {
        const consolidated = await BrainManager.consolidate();
        return `Consolidation complete: ${consolidated.promoted} promoted, ${consolidated.demoted} demoted, ${consolidated.pruned} pruned, ${consolidated.summaries_created} summaries created.`;
      }

      case "associate": {
        const assocId = await BrainManager.associate(params as AssociateInput);
        return `Association created (ID: ${assocId}): ${params.source_type}#${params.source_id} → ${params.target_type}#${params.target_id} [${params.relationship}]`;
      }

      // ── Knowledge Graph Actions ──────────────────────────────────────────
      case "add_entity": {
        const entityId = await BrainManager.addEntity(params as AddEntityInput);
        return `Entity added/updated (ID: ${entityId}): [${params.entity_type}] ${params.name}`;
      }

      case "search_entities": {
        const entities = await BrainManager.searchEntities(
          params.query,
          params.entity_type,
          params.limit ?? 20,
        );
        return KnowledgeGraph.formatEntityList(entities, `Entity search results for: "${params.query}"`);
      }

      case "add_edge": {
        const edgeId = await BrainManager.addEdge(params as AddEdgeInput);
        return `Edge added/strengthened (ID: ${edgeId}): #${params.source_entity_id} —[${params.relationship}]→ #${params.target_entity_id}`;
      }

      case "explore_graph": {
        const exploreResult = await BrainManager.exploreGraph(params as ExploreGraphInput);
        return KnowledgeGraph.formatExploreResult(exploreResult);
      }

      case "get_graph_stats": {
        const [graphStats, cap] = await Promise.all([
          BrainManager.getGraphStats(),
          BrainManager.getGraphCapStatus(),
        ]);
        return KnowledgeGraph.formatGraphStats({ ...graphStats, cap });
      }

      case "extract_entities": {
        const extracted = await BrainManager.extractEntities(params.content ?? params.text ?? "");
        return `Entity extraction complete: ${extracted.added} added, ${extracted.updated} updated.\n${KnowledgeGraph.formatEntityList(extracted.entities, "Extracted entities:")}`;
      }

      // ── Learning Pattern Actions ─────────────────────────────────────────
      case "learn_pattern": {
        const patternId = await BrainManager.learnPattern(params as LearnPatternInput);
        return `Pattern recorded (ID: ${patternId}): [${params.goal_type}] ${params.pattern_signature} (${params.success ? "success" : "failure"})`;
      }

      case "suggest_approach": {
        const suggestions = await BrainManager.suggestApproach(
          params.query,
          params.goal_type,
          params.limit ?? 5,
        );
        return LearningEngine.formatSuggestions(suggestions);
      }

      case "get_patterns": {
        const patterns = await BrainManager.getPatterns(params?.goal_type, params?.limit);
        return LearningEngine.formatPatternList(patterns);
      }

      // ── Procedural Memory Actions ────────────────────────────────────────
      case "store_procedure": {
        const procId = await BrainManager.storeProcedure(params as StoreProcedureInput);
        return `Procedure stored (ID: ${procId}): "${params.name}" with ${params.steps?.length ?? 0} steps`;
      }

      case "get_procedures": {
        const procedures = await BrainManager.getProcedures(params?.category, params?.limit);
        return BrainManager.formatProcedureList(procedures);
      }

      case "execute_procedure": {
        const proc = await BrainManager.executeProcedure(params.id, params.success ?? true);
        if (!proc) return `Procedure #${params.id} not found.`;
        const steps = JSON.parse(proc.steps) as string[];
        return `Procedure "${proc.name}" executed (${params.success !== false ? "success" : "failure"}).\nSuccess rate: ${(proc.success_rate * 100).toFixed(0)}% | Executions: ${proc.execution_count}\nSteps:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`;
      }

      // ── Auto-Memory Actions ──────────────────────────────────────────────
      case "auto_extract": {
        // Ensure the session exists before extraction (FK constraint)
        const extractSessionId = params.session_id ?? "manual";
        const existingSession = await BrainStore.getSession(extractSessionId);
        if (!existingSession) {
          await BrainStore.createSession(extractSessionId, "Auto-extract session", "");
        }
        const autoResult = await BrainManager.autoExtract(
          params.content ?? params.text ?? "",
          params.role ?? "user",
          extractSessionId,
        );
        return `Auto-extraction complete: ${autoResult.semantic_count} semantic memories, ${autoResult.entity_count} entities extracted.`;
      }

      // ── Context Builder Actions ──────────────────────────────────────────
      case "build_context": {
        const sessionId = params.session_id;
        const message = params.message ?? params.query;

        // P3.1 — The snapshot cache only serves generic session-start
        // context. A concrete message needs query-specific retrieval, so
        // never answer it with a frozen generic snapshot.
        if (sessionId && !message) {
          try {
            const snapshot = await MemorySnapshot.getSnapshot(sessionId, params.max_tokens);
            if (snapshot) {
              return snapshot.context;
            }
          } catch {}
        }

        const context = await ContextBuilder.build({
          ...params,
          message: message ?? "session context overview",
        } as BuildContextInput);

        // Track changes for snapshot refresh
        if (sessionId) {
          MemorySnapshot.recordChange(sessionId);
        }

        return context;
      }

      case "run_pipeline": {
        const result = await BrainManager.runPipeline(params);
        const phaseSummary = result.phases
          ?.map((p: any) => `${p.phase}: ${p.detail ?? p.success}`)
          .join("; ");
        if (result.context) {
          return result.context.context;
        }
        return phaseSummary ?? "Pipeline completed.";
      }

      case "get_phase_status": {
        const status = BrainManager.getPhaseStatus();
        return JSON.stringify(status);
      }

      case "get_effective_context": {
        const metrics = await BrainManager.getEffectiveContext();
        return JSON.stringify(metrics);
      }

      // ── Tag Actions ──────────────────────────────────────────────────────
      case "tag": {
        const tagId = await BrainManager.tag(params as TagInput);
        return `Tag "${params.tag}" added to ${params.memory_type}#${params.memory_id} (ID: ${tagId})`;
      }

      case "untag": {
        const untagged = await BrainManager.untag(params as TagInput);
        return untagged
          ? `Tag "${params.tag}" removed from ${params.memory_type}#${params.memory_id}`
          : `Tag "${params.tag}" not found on ${params.memory_type}#${params.memory_id}`;
      }

      case "search_by_tag": {
        const tagResults = await BrainManager.searchByTag(params.tag, params.memory_type, params.limit);
        if (tagResults.length === 0) return `No memories found with tag "${params.tag}"`;
        const parts = [`Memories tagged "${params.tag}" (${tagResults.length}):`];
        for (const t of tagResults) {
          parts.push(`  [${t.memory_type}#${t.memory_id}] tagged ${t.created_at}`);
        }
        return parts.join("\n");
      }

      // ── Collection Actions ───────────────────────────────────────────────
      case "create_collection": {
        const collId = await BrainManager.createCollection(params as CollectionInput);
        return `Collection created (ID: ${collId}): "${params.name}"`;
      }

      case "list_collections": {
        const collections = await BrainManager.listCollections(params?.limit);
        if (collections.length === 0) return "No collections created yet.";
        const parts = [`Collections (${collections.length}):`];
        for (const c of collections) {
          parts.push(`  [#${c.id}] ${c.name} (${c.item_count} items) — ${c.description || "no description"}`);
        }
        return parts.join("\n");
      }

      case "add_to_collection": {
        const itemId = await BrainManager.addToCollection(params as AddToCollectionInput);
        return `Added ${params.memory_type}#${params.memory_id} to collection #${params.collection_id} (item ID: ${itemId})`;
      }

      // ── Import/Export Actions ────────────────────────────────────────────
      case "export": {
        return await BrainManager.exportMemories();
      }

      case "import": {
        const importResult = await BrainManager.importMemories(params.file_path ?? params.path);
        BrainManager.invalidateMemoryCaches();
        return importResult;
      }

      // ── Self-Management Actions ──────────────────────────────────────────
      case "get_health": {
        const health = await BrainManager.getHealth();
        return BrainManager.formatHealth(health);
      }

      case "optimize": {
        return await BrainManager.optimize();
      }

      case "get_config": {
        const config = BrainManager.getConfig();
        return BrainManager.formatConfig(config);
      }

      case "update_config": {
        return await BrainManager.updateConfig(params as MemoryConfigInput);
      }

      // ── Cross-Session Backlog Search ─────────────────────────────────────
      case "search_backlogs": {
        const backlogResult = await BrainManager.searchBacklogs(params as BacklogSearchInput);
        return BrainManager.formatBacklogResult(backlogResult);
      }

      // ── LLM-Enhanced Actions ─────────────────────────────────────────────
      case "llm_extract_entities": {
        const llmExtract = await BrainManager.llmExtractEntities(
          params.text ?? params.content ?? "",
          params.session_id,
        );
        return `LLM Entity Extraction: ${llmExtract.added} added, ${llmExtract.updated} updated (LLM used: ${llmExtract.llm_used})\n${KnowledgeGraph.formatEntityList(llmExtract.entities, "Extracted entities:")}`;
      }

      case "llm_summarize_session": {
        const llmSummary = await BrainManager.llmSummarizeSession(
          params.session_id,
          params.detail_level,
        );
        return `Session Summary (LLM used: ${llmSummary.llm_used}):\n${llmSummary.summary}`;
      }

      case "llm_evaluate_importance": {
        const importance = await BrainManager.llmEvaluateImportance(
          params.content ?? params.text ?? "",
          params.role,
          params.context,
        );
        return `Importance Score: ${importance.score.toFixed(2)} (LLM used: ${importance.llm_used})\nReason: ${importance.reason}`;
      }

      case "llm_post_action_memory": {
        const postAction = await BrainManager.llmPostActionMemory(
          params.action_description,
          params.action_result,
          params.session_id,
        );
        return `Post-Action Memory Update (LLM used: ${postAction.llm_used}):\n  Memories created: ${postAction.memories_created}\n  Entities created: ${postAction.entities_created}\n  Patterns recorded: ${postAction.patterns_recorded}`;
      }

      // ── Checkpoint/Rollback Actions ──────────────────────────────────────
      case "create_checkpoint": {
        const checkpoint = await BrainManager.createCheckpoint(params.label ?? "manual");
        return `Checkpoint created (ID: ${checkpoint.id}): "${checkpoint.label}"\n  Semantic: ${checkpoint.semantic_count}, Entities: ${checkpoint.entity_count}, Patterns: ${checkpoint.pattern_count}\n  Snapshot: ${checkpoint.snapshot_path}`;
      }

      case "list_checkpoints": {
        const checkpoints = await BrainManager.listCheckpoints(params?.limit);
        if (checkpoints.length === 0) return "No checkpoints created yet.";
        const cpParts = [`Checkpoints (${checkpoints.length}):`];
        for (const cp of checkpoints) {
          cpParts.push(`  [#${cp.id}] "${cp.label}" — ${cp.created_at}`);
          const linked = cp.workspace_checkpoint_id
            ? `, workspace_cp=${cp.workspace_checkpoint_id}`
            : "";
          cpParts.push(`    Semantic: ${cp.semantic_count}, Entities: ${cp.entity_count}, Patterns: ${cp.pattern_count}${linked}`);
        }
        return cpParts.join("\n");
      }

      case "rollback_checkpoint": {
        const rollbackMsg = await BrainManager.rollbackCheckpoint(params.id ?? params.checkpoint_id);
        return rollbackMsg;
      }

      case "delete_checkpoint": {
        const deleted = await BrainManager.deleteCheckpoint(params.id ?? params.checkpoint_id);
        return deleted
          ? `Checkpoint #${params.id ?? params.checkpoint_id} deleted.`
          : `Checkpoint #${params.id ?? params.checkpoint_id} not found.`;
      }

      // ── Audit Trail Actions ──────────────────────────────────────────────
      case "get_audit_log": {
        const auditEntries = await BrainStore.getAuditLog({
          action: params.audit_action,
          target_type: params.audit_target_type,
          target_id: params.audit_target_id,
          limit: params.limit ?? 50,
          since: params.date_from,
        });
        if (auditEntries.length === 0) return "No audit log entries found.";
        const auditParts = [`Audit Log (${auditEntries.length} entries):`];
        for (const entry of auditEntries) {
          auditParts.push(`  [${entry.created_at}] ${entry.action} → ${entry.target_type}#${entry.target_id}`);
          try {
            const details = JSON.parse(entry.details);
            const detailStr = Object.entries(details).map(([k, v]) => `${k}=${v}`).join(", ");
            if (detailStr) auditParts.push(`    ${detailStr}`);
          } catch {}
        }
        return auditParts.join("\n");
      }

      // ── Session Topic Actions ────────────────────────────────────────────
      case "get_session_topics": {
        const topics = await BrainStore.getSessionTopics(params.session_id);
        if (topics.length === 0) return `No topics detected for session "${params.session_id}".`;
        const topicParts = [`Session Topics (${topics.length}):`];
        for (const t of topics) {
          topicParts.push(`  [${t.created_at}] "${t.topic}" (confidence: ${t.confidence.toFixed(2)})`);
          topicParts.push(`    Keywords: ${t.keywords}`);
          topicParts.push(`    Messages: ${t.message_range_start}–${t.message_range_end}`);
        }
        return topicParts.join("\n");
      }

      // ── Performance & Self-Management Actions ───────────────────────────
      case "get_metrics": {
        const mSummary = BrainManager.getMetrics(params.window_ms);
        return BrainManager.formatMetrics(mSummary);
      }

      case "get_health_score": {
        const hScore = await BrainManager.getHealthScore(params.weights);
        return BrainManager.formatHealthScore(hScore);
      }

      case "get_capacity_forecast": {
        const forecast = await BrainManager.getCapacityForecast();
        return BrainManager.formatForecast(forecast);
      }

      case "heal": {
        if (params.action) {
          const healResult = await BrainManager.runHealingAction(params.action as HealingAction);
          return BrainManager.formatHealingResult([healResult]);
        }
        const autoResults = await BrainManager.autoHeal();
        return BrainManager.formatHealingResult(autoResults);
      }

      case "get_healing_strategies": {
        const strats = BrainManager.getHealingStrategies();
        if (strats.length === 0) return "No healing strategies recorded yet. Run 'heal' first.";
        const sParts = ["Healing Strategy Effectiveness:"];
        for (const s of strats) {
          sParts.push(`  [${s.action}] effectiveness: ${s.effectiveness.toFixed(3)} — runs: ${s.total_runs}, success: ${s.success_count}/${s.total_runs}, avg impact: ${s.avg_impact.toFixed(3)}, avg duration: ${s.avg_duration_ms.toFixed(0)}ms`);
        }
        return sParts.join("\n");
      }

      case "get_consolidation_stats": {
        const cStats = BrainManager.getConsolidationStats();
        return BrainManager.formatConsolidationStats(cStats);
      }

      // ── Checkpoint Strategies & Lifecycle (Tier C) ───────────────────────
      case "checkpoint_strategy_config": {
        const cfg = CheckpointManager.getConfig();
        return BrainManager.formatCheckpointStrategyConfig(cfg);
      }

      case "update_checkpoint_strategy": {
        const update: Partial<CheckpointStrategyConfig> = {};
        if (params.mode) update.mode = params.mode;
        if (params.adaptive_change_threshold !== undefined) update.adaptive_change_threshold = params.adaptive_change_threshold;
        if (params.time_interval_minutes !== undefined) update.time_interval_minutes = params.time_interval_minutes;
        if (params.max_checkpoints !== undefined) update.max_checkpoints = params.max_checkpoints;
        if (params.max_age_days !== undefined) update.max_age_days = params.max_age_days;
        if (params.max_total_size_mb !== undefined) update.max_total_size_mb = params.max_total_size_mb;
        if (params.compress_snapshots !== undefined) update.compress_snapshots = params.compress_snapshots;
        CheckpointManager.updateConfig(update);
        const updated = CheckpointManager.getConfig();
        return `Checkpoint strategy updated.\n${BrainManager.formatCheckpointStrategyConfig(updated)}`;
      }

      case "checkpoint_lifecycle_cleanup": {
        const report = await CheckpointManager.runLifecycleCleanup();
        return BrainManager.formatLifecycleReport(report);
      }

      case "compress_checkpoint": {
        const saved = await CheckpointManager.compressExistingCheckpoint(params.id ?? params.checkpoint_id);
        return saved > 0
          ? `Checkpoint compressed — saved ${(saved / 1024).toFixed(1)} KB`
          : `Checkpoint already compressed or not found.`;
      }

      case "diff_checkpoint": {
        const diff = await CheckpointManager.diffFromCheckpoint(params.id ?? params.checkpoint_id);
        return [
          `Checkpoint Diff:`,
          `  Semantic: +${diff.semantic.added} / -${diff.semantic.removed}`,
          `  Entities: +${diff.entities.added} / -${diff.entities.removed}`,
          `  Patterns: +${diff.patterns.added} / -${diff.patterns.removed}`,
          `  Audit events since: ${diff.events_since}`,
        ].join("\n");
      }

      // ── Event Replay & Undo (Tier C) ────────────────────────────────────
      case "replay_events": {
        const replay = await CheckpointManager.replayEvents({
          from: params.from,
          to: params.to,
          checkpoint_id: params.checkpoint_id,
          action_filter: params.action_filter,
          target_type_filter: params.target_type_filter,
          limit: params.limit,
        });
        return BrainManager.formatReplayResult(replay);
      }

      case "undo_operation": {
        const undoResult = await CheckpointManager.undoOperation(params.audit_entry_id ?? params.id);
        return undoResult.success
          ? `Undo successful: ${undoResult.details}`
          : `Undo failed: ${undoResult.details}`;
      }

      case "get_undoable_operations": {
        const undoable = await CheckpointManager.getUndoableOperations(params.limit ?? 20);
        if (undoable.length === 0) return "No undoable operations found.";
        const parts = [`Undoable Operations (${undoable.length}):`];
        for (const entry of undoable) {
          parts.push(`  [#${entry.id}] ${entry.action} → ${entry.target_type}#${entry.target_id} (${entry.created_at})`);
        }
        return parts.join("\n");
      }

      // ── Batch Operations (Tier C) ───────────────────────────────────────
      case "batch_delete": {
        const batchDelResult = await BatchOperations.batchDelete(params as BatchDeleteInput);
        if (batchDelResult.deleted > 0) BrainManager.invalidateMemoryCaches();
        return BrainManager.formatBatchDeleteResult(batchDelResult);
      }

      case "batch_store": {
        const batchStoreResult = await BatchOperations.batchStore(params as BatchStoreInput);
        if (batchStoreResult.stored > 0) BrainManager.invalidateMemoryCaches();
        return BrainManager.formatBatchStoreResult(batchStoreResult);
      }

      case "batch_audit_log": {
        const batchAuditResult = await BatchOperations.batchAuditLog(params as BatchEventInput);
        return `Batch audit log: ${batchAuditResult.logged} logged, ${batchAuditResult.failed} failed.`;
      }

      case "batch_update_importance": {
        const updated = await BatchOperations.batchUpdateImportance(params.updates ?? []);
        if (updated > 0) BrainManager.invalidateMemoryCaches();
        return `Batch importance update: ${updated} records updated.`;
      }

      case "batch_move_tier": {
        const moved = await BatchOperations.batchMoveTier(params.target_type, params.ids, params.tier);
        if (moved > 0) BrainManager.invalidateMemoryCaches();
        return `Batch tier move: ${moved} records moved to "${params.tier}".`;
      }

      // ── Related Sessions Discovery (Tier D) ─────────────────────────────
      case "find_related_sessions": {
        const related = await SessionDiscovery.findRelatedSessions(
          params.session_id,
          params.limit ?? 10,
        );
        return BrainManager.formatRelatedSessions(related);
      }

      // ── 5-Tier Memory Hierarchy (Tier D) ────────────────────────────────
      case "five_tier_consolidate": {
        const fiveResult = await FiveTierHierarchy.consolidate();
        return [
          "5-Tier Consolidation Complete:",
          `  Promoted: ${fiveResult.promoted}`,
          `  Demoted: ${fiveResult.demoted}`,
          `  Pruned: ${fiveResult.pruned}`,
          `  Compressed: ${fiveResult.compressed}`,
        ].join("\n");
      }

      case "get_tier_distribution": {
        const dist = await FiveTierHierarchy.getTierDistribution();
        const parts = ["Tier Distribution:"];
        for (const [tier, counts] of Object.entries(dist)) {
          parts.push(`  ${tier}: ${counts.semantic} semantic, ${counts.episodic} episodic (total: ${counts.semantic + counts.episodic})`);
        }
        return parts.join("\n");
      }

      case "get_tier_configs": {
        const configs = FiveTierHierarchy.getConfigs();
        const parts = ["5-Tier Configuration:"];
        for (const cfg of configs) {
          parts.push(`  ${cfg.tier}: max_age=${cfg.max_age_hours}h, importance_threshold=${cfg.importance_threshold}, retrieval_threshold=${cfg.retrieval_threshold}, compress=${cfg.compress}`);
        }
        return parts.join("\n");
      }

      case "update_tier_config": {
        FiveTierHierarchy.updateConfig(params.tier, {
          max_age_hours: params.max_age_hours,
          importance_threshold: params.importance_threshold,
          retrieval_threshold: params.retrieval_threshold,
          compress: params.compress,
        });
        return `Tier "${params.tier}" config updated.`;
      }

      // ── Root Cause Analysis (Tier D) ────────────────────────────────────
      case "root_cause_analysis": {
        const report = await RootCauseAnalyzer.analyze();
        return BrainManager.formatRootCauseReport(report);
      }

      // ── Spaced Repetition (Tier D) ──────────────────────────────────────
      case "get_review_due": {
        const cfg = BrainStore.getConfig();
        const due = await SpacedRepetition.getMemoriesDueForReview(
          params.retention_threshold ?? cfg.ebbinghaus_review_threshold,
          params.limit ?? 20,
        );
        return BrainManager.formatReviewDue(due);
      }

      case "boost_memory": {
        const newImportance = await SpacedRepetition.boostOnRetrieval(params.id ?? params.memory_id);
        return newImportance > 0
          ? `Memory #${params.id ?? params.memory_id} boosted — new importance: ${newImportance.toFixed(3)}`
          : `Memory #${params.id ?? params.memory_id} not found.`;
      }

      // ── LRU Cache (Tier D) ──────────────────────────────────────────────
      case "get_cache_stats": {
        const cacheStats = BrainManager.memoryCache.getStats();
        return BrainManager.formatCacheStats(cacheStats);
      }

      case "clear_cache": {
        BrainManager.memoryCache.clear();
        return "LRU cache cleared.";
      }

      // ── Metrics Storage (Tier D) ────────────────────────────────────────
      case "store_metrics_snapshot": {
        const mSummary = BrainManager.getMetrics(params.window_ms);
        const stats = await BrainStore.getStats();
        const compression = BrainManager.getCompressionStats();
        const effective = await BrainManager.getEffectiveContext();
        const snapshotId = await MetricsStorage.storeSnapshot(
          mSummary,
          stats.db_size_bytes,
          stats.total_semantic + stats.total_episodic,
          compression.total_tokens_saved,
          effective.hierarchy_effective_tokens,
          effective.total_effective,
        );
        return `Metrics snapshot stored (ID: ${snapshotId}).`;
      }

      case "get_metrics_trend": {
        const trendSummary = await MetricsStorage.getTrendSummary(params.hours ?? 24);
        return trendSummary;
      }

      default:
        return `Unknown action: "${action}". Available actions: store, recall, search, summarize_session, list_sessions, get_session, delete, get_stats, consolidate, associate, add_entity, search_entities, add_edge, explore_graph, get_graph_stats, extract_entities, learn_pattern, suggest_approach, get_patterns, store_procedure, get_procedures, execute_procedure, auto_extract, build_context, tag, untag, search_by_tag, create_collection, list_collections, add_to_collection, export, import, get_health, optimize, get_config, update_config, search_backlogs, llm_extract_entities, llm_summarize_session, llm_evaluate_importance, llm_post_action_memory, create_checkpoint, list_checkpoints, rollback_checkpoint, delete_checkpoint, get_audit_log, get_session_topics, get_metrics, get_health_score, get_capacity_forecast, heal, get_healing_strategies, get_consolidation_stats, checkpoint_strategy_config, update_checkpoint_strategy, checkpoint_lifecycle_cleanup, compress_checkpoint, diff_checkpoint, replay_events, undo_operation, get_undoable_operations, batch_delete, batch_store, batch_audit_log, batch_update_importance, batch_move_tier, find_related_sessions, five_tier_consolidate, get_tier_distribution, get_tier_configs, update_tier_config, root_cause_analysis, get_review_due, boost_memory, get_cache_stats, clear_cache, store_metrics_snapshot, get_metrics_trend`;
    }
  }

  // ── Formatting Helpers ─────────────────────────────────────────────────────

  private static formatRecallResult(result: RecallResult): string {
    const parts: string[] = [];

    if (result.semantic.length > 0) {
      parts.push(`📚 Semantic Memories (${result.semantic.length} found):`);
      for (const mem of result.semantic) {
        parts.push(`  [#${mem.id}] [${mem.category}] ${mem.title}`);
        parts.push(`    ${mem.content.substring(0, 300)}${mem.content.length > 300 ? "..." : ""}`);
        parts.push(`    Importance: ${mem.importance_score.toFixed(2)} | Retrieved: ${mem.retrieval_count}x | Tier: ${mem.tier}`);
      }
      parts.push("");
    }

    if (result.episodic.length > 0) {
      parts.push(`💭 Episodic Memories (${result.episodic.length} found):`);
      for (const ep of result.episodic) {
        parts.push(`  [#${ep.id}] [${ep.session_id.substring(0, 8)}...] ${ep.role}: ${ep.content.substring(0, 200)}${ep.content.length > 200 ? "..." : ""}`);
      }
      parts.push("");
    }

    if (result.associations.length > 0) {
      parts.push(`🔗 Associations (${result.associations.length} found):`);
      for (const a of result.associations) {
        parts.push(`  ${a.source_type}#${a.source_id} —[${a.relationship}]→ ${a.target_type}#${a.target_id} (strength: ${a.strength.toFixed(2)})`);
      }
    }

    if (parts.length === 0) {
      return "No memories found matching the query.";
    }

    return parts.join("\n");
  }

  private static formatSemanticList(memories: SemanticMemory[], header: string): string {
    if (memories.length === 0) return `${header}\nNo results.`;
    const parts = [header];
    for (const mem of memories) {
      parts.push(`[#${mem.id}] [${mem.category}] ${mem.title}`);
      parts.push(`  ${mem.content.substring(0, 200)}${mem.content.length > 200 ? "..." : ""}`);
      parts.push(`  Keywords: ${mem.keywords || "none"} | Importance: ${mem.importance_score.toFixed(2)} | Retrieved: ${mem.retrieval_count}x`);
    }
    return parts.join("\n");
  }

  private static formatSessionList(sessions: BrainSession[]): string {
    if (sessions.length === 0) return "No sessions tracked yet.";
    const parts = [`Tracked Sessions (${sessions.length}):`];
    for (const s of sessions) {
      const status = s.is_active ? "🟢" : "⚪";
      parts.push(`  ${status} [${s.id.substring(0, 8)}...] ${s.title} (${s.message_count} msgs, ${s.updated_at})`);
      if (s.workspace_directory) {
        parts.push(`    Workspace: ${s.workspace_directory}`);
      }
    }
    return parts.join("\n");
  }

  private static formatSessionDetail(session: BrainSession, history: any[]): string {
    const parts = [
      `Session: ${session.title}`,
      `ID: ${session.id}`,
      `Workspace: ${session.workspace_directory || "N/A"}`,
      `Messages: ${session.message_count}`,
      `Created: ${session.created_at}`,
      `Updated: ${session.updated_at}`,
      `Active: ${session.is_active}`,
    ];

    if (session.summary) {
      parts.push("", "Summary:", session.summary);
    }

    if (history.length > 0) {
      parts.push("", `Recent History (${history.length} messages):`);
      for (const msg of history.slice(-20)) {
        const preview = msg.content.substring(0, 150).replace(/\n/g, " ");
        parts.push(`  [${msg.role}] ${preview}${msg.content.length > 150 ? "..." : ""}`);
      }
    }

    return parts.join("\n");
  }

  private static formatStats(stats: BrainStats): string {
    const sizeKB = (stats.db_size_bytes / 1024).toFixed(1);
    return [
      "Memory Brain Statistics:",
      `  Sessions: ${stats.total_sessions}`,
      `  Episodic memories: ${stats.total_episodic}`,
      `  Semantic memories: ${stats.total_semantic}`,
      `  Associations: ${stats.total_associations}`,
      `  Knowledge graph: ${stats.total_entities} entities, ${stats.total_edges} edges`,
      `  Learning patterns: ${stats.total_patterns}`,
      `  Procedures: ${stats.total_procedures}`,
      `  Tags: ${stats.total_tags}`,
      `  Collections: ${stats.total_collections}`,
      `  Tiers: hot=${stats.tier_counts.hot}, warm=${stats.tier_counts.warm}, cold=${stats.tier_counts.cold}`,
      `  Categories: ${Object.entries(stats.category_counts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
      `  Entity types: ${Object.entries(stats.entity_type_counts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
      `  Oldest: ${stats.oldest_memory ?? "N/A"}`,
      `  Newest: ${stats.newest_memory ?? "N/A"}`,
      `  DB Size: ${sizeKB} KB`,
    ].join("\n");
  }

  private static formatProcedureList(procedures: any[]): string {
    if (procedures.length === 0) return "No procedures stored yet.";
    const parts = [`Procedures (${procedures.length}):`];
    for (const p of procedures) {
      const steps = JSON.parse(p.steps) as string[];
      parts.push(`  [#${p.id}] [${p.category}] ${p.name}`);
      parts.push(`    ${p.description}`);
      parts.push(`    Steps: ${steps.length} | Success rate: ${(p.success_rate * 100).toFixed(0)}% | Executions: ${p.execution_count}`);
      parts.push(`    Trigger: ${p.trigger_pattern || "manual"}`);
    }
    return parts.join("\n");
  }

  private static formatHealth(health: HealthStatus): string {
    const statusEmoji = health.status === "healthy" ? "🟢" : health.status === "degraded" ? "🟡" : "🔴";
    const sizeKB = (health.db_size_bytes / 1024).toFixed(1);
    const parts = [
      `Memory Brain Health: ${statusEmoji} ${health.status.toUpperCase()}`,
      `  Total memories: ${health.total_memories}`,
      `  DB size: ${sizeKB} KB`,
      `  Fragmentation: ${(health.fragmentation_ratio * 100).toFixed(1)}%`,
      `  Oldest unaccessed: ${health.oldest_unaccessed_days.toFixed(0)} days`,
    ];

    if (health.issues.length > 0) {
      parts.push("  Issues:");
      for (const issue of health.issues) {
        parts.push(`    ⚠ ${issue}`);
      }
    }

    if (health.recommendations.length > 0) {
      parts.push("  Recommendations:");
      for (const rec of health.recommendations) {
        parts.push(`    → ${rec}`);
      }
    }

    return parts.join("\n");
  }

  private static formatConfig(config: any): string {
    const parts = ["Memory Brain Configuration:"];
    for (const [key, value] of Object.entries(config)) {
      parts.push(`  ${key}: ${value}`);
    }
    return parts.join("\n");
  }

  private static formatBacklogResult(result: any): string {
    const parts: string[] = [];
    parts.push(`Cross-Session Backlog Search — ${result.sessions_searched} sessions searched, ${result.total_matches} total matches`);
    parts.push("");

    if (result.semantic.length > 0) {
      parts.push(`📚 Semantic Memories (${result.semantic.length}):`);
      for (const mem of result.semantic) {
        parts.push(`  [#${mem.id}] [${mem.category}] ${mem.title}`);
        parts.push(`    ${mem.content.substring(0, 250)}${mem.content.length > 250 ? "..." : ""}`);
        parts.push(`    Session: ${mem.source_session_id ?? "N/A"} | Importance: ${mem.importance_score.toFixed(2)} | Retrieved: ${mem.retrieval_count}x`);
      }
      parts.push("");
    }

    if (result.episodic.length > 0) {
      parts.push(`💭 Episodic Memories (${result.episodic.length}):`);
      for (const ep of result.episodic) {
        parts.push(`  [#${ep.id}] [Session: ${ep.session_id.substring(0, 8)}...] [${ep.role}]`);
        parts.push(`    ${ep.content.substring(0, 250)}${ep.content.length > 250 ? "..." : ""}`);
        parts.push(`    ${ep.created_at} | Importance: ${ep.importance_score.toFixed(2)}`);
      }
    }

    if (result.total_matches === 0) {
      parts.push("No matching memories found across sessions.");
    }

    return parts.join("\n");
  }

  // ── Utility Helpers ────────────────────────────────────────────────────────

  /**
   * Rough token estimate (4 chars ≈ 1 token).
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate importance of a message based on heuristics.
   */
  private static estimateImportance(content: string, role: string): number {
    let score = 0.5;

    // User messages that are questions are more important
    if (role === "user") {
      score += 0.1;
      if (content.includes("?")) score += 0.05;
      // Longer messages tend to be more substantial
      if (content.length > 200) score += 0.1;
    }

    // Messages with code blocks are more important
    if (content.includes("```")) score += 0.1;

    // Messages mentioning errors, fixes, decisions
    const importantTerms = ["error", "fix", "decision", "important", "remember", "always", "never", "convention", "pattern", "rule"];
    for (const term of importantTerms) {
      if (content.toLowerCase().includes(term)) {
        score += 0.05;
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Extract keywords from text for search indexing.
   */
  private static extractKeywords(text: string): string {
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "to", "of", "in", "for",
      "on", "with", "at", "by", "from", "as", "into", "through", "during",
      "before", "after", "above", "below", "between", "under", "again",
      "further", "then", "once", "here", "there", "when", "where", "why",
      "how", "all", "each", "every", "both", "few", "more", "most", "other",
      "some", "such", "no", "nor", "not", "only", "own", "same", "so",
      "than", "too", "very", "just", "because", "but", "and", "or", "if",
      "this", "that", "these", "those", "it", "its", "i", "me", "my",
      "we", "our", "you", "your", "he", "she", "they", "them", "what",
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    // Count frequency and return top keywords
    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([w]) => w)
      .join(", ");
  }

  /**
   * Clear derived read caches after any write that can change retrieval output.
   */
  private static invalidateMemoryCaches(): void {
    BrainManager.memoryCache.clear();
    MemorySnapshot.invalidateAll();
  }

  // ── Performance & Self-Management Formatters ─────────────────────────────

  private static formatMetrics(m: MetricsSummary): string {
    const parts = [
      "Performance Metrics:",
      `  Total operations: ${m.total_operations}`,
      `  Success rate: ${(m.success_rate * 100).toFixed(1)}%`,
      `  Avg response: ${m.avg_response_ms.toFixed(1)}ms`,
      `  P95 response: ${m.p95_response_ms.toFixed(1)}ms`,
      `  P99 response: ${m.p99_response_ms.toFixed(1)}ms`,
      `  Total tokens: ${m.total_tokens_used}`,
      `  Ops/min: ${m.operations_per_minute.toFixed(2)}`,
      `  Uptime: ${(m.uptime_ms / 60000).toFixed(1)} min`,
    ];
    const ops = Object.entries(m.by_operation);
    if (ops.length > 0) {
      parts.push("  Per-operation:");
      for (const [op, s] of ops) {
        parts.push(`    ${op}: ${s.count} calls, ${(s.success_rate * 100).toFixed(0)}% success, avg ${s.avg_ms.toFixed(1)}ms, p95 ${s.p95_ms.toFixed(1)}ms, ${s.total_tokens} tokens`);
      }
    }
    return parts.join("\n");
  }

  private static formatHealthScore(h: HealthScore): string {
    return [
      `Health Score: ${h.grade} (${(h.overall * 100).toFixed(1)}%)`,
      `  Latency:       ${(h.dimensions.latency * 100).toFixed(1)}% (weight: ${h.weights.latency})`,
      `  Accuracy:      ${(h.dimensions.accuracy * 100).toFixed(1)}% (weight: ${h.weights.accuracy})`,
      `  Efficiency:    ${(h.dimensions.efficiency * 100).toFixed(1)}% (weight: ${h.weights.efficiency})`,
      `  Capacity:      ${(h.dimensions.capacity * 100).toFixed(1)}% (weight: ${h.weights.capacity})`,
      `  Fragmentation: ${(h.dimensions.fragmentation * 100).toFixed(1)}% (weight: ${h.weights.fragmentation})`,
    ].join("\n");
  }

  private static formatForecast(f: CapacityForecast): string {
    const sizeMb = (f.current_db_size_bytes / (1024 * 1024)).toFixed(2);
    const growthKbDay = (f.growth_rate_bytes_per_day / 1024).toFixed(1);
    const parts = [
      "Capacity Forecast:",
      `  Current DB size: ${sizeMb} MB`,
      `  Growth rate: ${growthKbDay} KB/day`,
      `  Trend: ${f.trend}`,
      `  EMA response time: ${f.ema_response_ms.toFixed(1)}ms`,
      `  EMA tokens/op: ${f.ema_tokens_per_op.toFixed(1)}`,
      `  Memory growth: ${f.memory_growth_rate_per_day.toFixed(1)} memories/day`,
    ];
    if (f.days_until_100mb !== null) parts.push(`  Days until 100MB: ${Math.ceil(f.days_until_100mb)}`);
    if (f.days_until_500mb !== null) parts.push(`  Days until 500MB: ${Math.ceil(f.days_until_500mb)}`);
    if (f.recommendations.length > 0) {
      parts.push("  Recommendations:");
      for (const r of f.recommendations) parts.push(`    → ${r}`);
    }
    return parts.join("\n");
  }

  private static formatHealingResult(results: HealingResult[]): string {
    if (results.length === 0) return "No healing actions were needed.";
    const parts = [`Healing Results (${results.length} actions):`];
    for (const r of results) {
      const status = r.success ? "✓" : "✗";
      parts.push(`  ${status} [${r.action}] ${r.details} (${r.duration_ms.toFixed(0)}ms, impact: ${(r.impact * 100).toFixed(0)}%)`);
    }
    return parts.join("\n");
  }

  private static formatConsolidationStats(s: ConsolidationStats): string {
    const parts = [
      "Consolidation Statistics:",
      `  Total runs: ${s.total_runs}`,
      `  Last run: ${s.last_run_at ?? "never"}`,
      `  Last duration: ${s.last_duration_ms.toFixed(0)}ms`,
      `  Avg duration: ${s.avg_duration_ms.toFixed(0)}ms`,
      `  Scheduler: ${s.scheduler_active ? "active" : "inactive"} (every ${s.scheduler_interval_hours}h)`,
      `  Next scheduled: ${s.next_scheduled_at ?? "N/A"}`,
      "  Totals:",
      `    Promoted: ${s.total_promoted}`,
      `    Demoted: ${s.total_demoted}`,
      `    Pruned: ${s.total_pruned}`,
      `    Distilled: ${s.total_distilled}`,
      `    Replayed: ${s.total_replayed}`,
      `    Compressed: ${s.total_compressed}`,
    ];
    if (s.cycle_history.length > 0) {
      parts.push(`  Recent cycles (last ${Math.min(5, s.cycle_history.length)}):`);
      for (const c of s.cycle_history.slice(-5)) {
        parts.push(`    [${c.timestamp}] ${c.duration_ms.toFixed(0)}ms — promoted: ${c.promoted}, demoted: ${c.demoted}, pruned: ${c.pruned}`);
      }
    }
    return parts.join("\n");
  }

  // ── Tier C Formatting Helpers ──────────────────────────────────────────────

  private static formatCheckpointStrategyConfig(cfg: CheckpointStrategyConfig): string {
    return [
      "Checkpoint Strategy Configuration:",
      `  Mode: ${cfg.mode}`,
      `  Adaptive change threshold: ${cfg.adaptive_change_threshold}`,
      `  Time interval: ${cfg.time_interval_minutes} minutes`,
      `  Max checkpoints: ${cfg.max_checkpoints}`,
      `  Max age: ${cfg.max_age_days} days`,
      `  Max total size: ${cfg.max_total_size_mb} MB`,
      `  Compress snapshots: ${cfg.compress_snapshots}`,
    ].join("\n");
  }

  private static formatLifecycleReport(report: CheckpointLifecycleReport): string {
    const sizeMb = (report.total_size_bytes / (1024 * 1024)).toFixed(2);
    return [
      "Checkpoint Lifecycle Cleanup:",
      `  Deleted by age: ${report.deleted_by_age}`,
      `  Deleted by count: ${report.deleted_by_count}`,
      `  Deleted by size: ${report.deleted_by_size}`,
      `  Total deleted: ${report.total_deleted}`,
      `  Remaining: ${report.remaining}`,
      `  Total size: ${sizeMb} MB`,
    ].join("\n");
  }

  private static formatReplayResult(replay: EventReplayResult): string {
    if (replay.events_replayed === 0) return "No events found in the specified range.";
    const parts = [
      `Event Replay (${replay.events_replayed} events):`,
      `  From: ${replay.from_timestamp}`,
      `  To: ${replay.target_timestamp}`,
      "",
    ];
    for (const op of replay.operations) {
      parts.push(`  [${op.timestamp}] ${op.action} → ${op.target_type}#${op.target_id}`);
      const detailStr = Object.entries(op.details).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
      if (detailStr) parts.push(`    ${detailStr}`);
    }
    return parts.join("\n");
  }

  private static formatBatchDeleteResult(result: BatchDeleteResult): string {
    const parts = [
      `Batch Delete (${result.target_type}):`,
      `  Requested: ${result.requested}`,
      `  Deleted: ${result.deleted}`,
      `  Failed: ${result.failed}`,
    ];
    if (result.errors.length > 0) {
      parts.push("  Errors:");
      for (const err of result.errors) parts.push(`    ⚠ ${err}`);
    }
    return parts.join("\n");
  }

  private static formatBatchStoreResult(result: BatchStoreResult): string {
    const parts = [
      `Batch Store:`,
      `  Stored: ${result.stored} (IDs: ${result.ids.join(", ")})`,
      `  Failed: ${result.failed}`,
    ];
    if (result.errors.length > 0) {
      parts.push("  Errors:");
      for (const err of result.errors) parts.push(`    ⚠ ${err}`);
    }
    return parts.join("\n");
  }

  // ── Tier D Formatting Helpers ──────────────────────────────────────────────

  private static formatRelatedSessions(related: RelatedSession[]): string {
    if (related.length === 0) return "No related sessions found.";
    const parts = [`Related Sessions (${related.length}):`];
    for (const r of related) {
      parts.push(`  [${r.session.id.substring(0, 8)}...] "${r.session.title}" (relevance: ${r.relevance_score.toFixed(1)})`);
      if (r.shared_entities.length > 0) parts.push(`    Shared entities: ${r.shared_entities.join(", ")}`);
      if (r.shared_topics.length > 0) parts.push(`    Shared topics: ${r.shared_topics.join(", ")}`);
      if (r.shared_keywords.length > 0) parts.push(`    Shared keywords: ${r.shared_keywords.slice(0, 10).join(", ")}`);
    }
    return parts.join("\n");
  }

  private static formatRootCauseReport(report: RootCauseReport): string {
    const statusEmoji = report.overall_status === "healthy" ? "🟢" : report.overall_status === "degraded" ? "🟡" : "🔴";
    const parts = [
      `Root Cause Analysis: ${statusEmoji} ${report.overall_status.toUpperCase()} (${report.timestamp})`,
    ];

    if (report.root_causes.length === 0) {
      parts.push("  No issues detected — system is healthy.");
    } else {
      parts.push(`  ${report.root_causes.length} issue(s) found:`);
      for (const cause of report.root_causes) {
        const sevEmoji = cause.severity === "critical" ? "🔴" : cause.severity === "high" ? "🟠" : cause.severity === "medium" ? "🟡" : "⚪";
        parts.push(`  ${sevEmoji} [${cause.category}] ${cause.symptom}`);
        parts.push(`    Root cause: ${cause.root_cause}`);
        if (cause.evidence.length > 0) parts.push(`    Evidence: ${cause.evidence.join("; ")}`);
        if (cause.recommended_actions.length > 0) parts.push(`    Actions: ${cause.recommended_actions.join("; ")}`);
        parts.push(`    Impact: ${cause.estimated_impact}`);
      }
    }

    const tierStr = Object.entries(report.tier_balance).map(([k, v]) => `${k}=${v}`).join(", ");
    if (tierStr) parts.push(`  Tier balance: ${tierStr}`);

    return parts.join("\n");
  }

  private static formatReviewDue(items: SpacedRepetitionState[]): string {
    if (items.length === 0) return "No memories due for review — all retention levels are adequate.";
    const parts = [`Memories Due for Review (${items.length}):`];
    for (const item of items) {
      const overdueStr = item.overdue ? " ⚠ OVERDUE" : "";
      parts.push(`  [#${item.memory_id}] [${item.category}] "${item.title}"`);
      parts.push(`    Retention: ${(item.current_retention * 100).toFixed(0)}% | Strength: ${item.strength.toFixed(2)} | Retrievals: ${item.retrieval_count}${overdueStr}`);
      parts.push(`    Next review: ${item.days_until_review.toFixed(1)} days (${item.next_optimal_review})`);
    }
    return parts.join("\n");
  }

  private static formatCacheStats(stats: LruCacheStats): string {
    const parts = [
      "LRU Cache Statistics:",
      `  Size: ${stats.size} / ${stats.max_size}`,
      `  Hits: ${stats.hits} | Misses: ${stats.misses} | Evictions: ${stats.evictions}`,
      `  Hit rate: ${(stats.hit_rate * 100).toFixed(1)}%`,
      `  Memory: ${(stats.total_memory_bytes / 1024).toFixed(1)} KB`,
      `  Avg entry age: ${(stats.avg_entry_age_ms / 1000).toFixed(1)}s`,
    ];
    if (stats.hottest_keys.length > 0) {
      parts.push("  Hottest keys:");
      for (const k of stats.hottest_keys.slice(0, 5)) {
        parts.push(`    "${k.key}" — ${k.hits} hits`);
      }
    }
    return parts.join("\n");
  }
}
