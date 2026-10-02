/** Memory tool action dispatch. */

import { BrainStore } from "../BrainStore.js";
import { KnowledgeGraph } from "../KnowledgeGraph.js";
import { LearningEngine } from "../LearningEngine.js";
import { ContextBuilder } from "../ContextBuilder.js";
import { CheckpointManager } from "../CheckpointManager.js";
import type {
  CheckpointStrategyUpdate,
} from "../CheckpointManager.js";
import { BatchOperations } from "../BatchOperations.js";
import type {
  BatchDeleteInput,
  BatchStoreInput,
  BatchEventInput,
} from "../BatchOperations.js";
import {
  SessionDiscovery,
  FiveTierHierarchy,
  RootCauseAnalyzer,
  SpacedRepetition,
  MetricsStorage,
} from "../AdvancedFeatures.js";
import type {
  HealingAction,
} from "../PerformanceMonitor.js";
import { RetrievalFusion } from "../RetrievalFusion.js";
import { MemorySnapshot } from "../MemorySnapshot.js";
import {
  filterSemanticByProjectScope,
  getProjectSessionIds,
} from "../projectScope.js";
import type {
  StoreInput,
  RecallInput,
  SessionSummaryInput,
  AssociateInput,
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
  BacklogSearchInput,
} from "../types.js";
import { brainRuntime } from "./state.js";
import { associate } from "./associations.js";
import { createCheckpoint, deleteCheckpoint, listCheckpoints, rollbackCheckpoint } from "./checkpoints.js";
import { consolidate } from "./consolidation.js";
import { getCompressionStats, getEffectiveContext, getPhaseStatus, runPipeline } from "./context.js";
import { autoExtract } from "./extraction.js";
import { formatBacklogResult, formatBatchDeleteResult, formatBatchStoreResult, formatCacheStats, formatCheckpointStrategyConfig, formatConfig, formatConsolidationStats, formatForecast, formatHealingResult, formatHealth, formatHealthScore, formatLifecycleReport, formatMetrics, formatProcedureList, formatRecallResult, formatRelatedSessions, formatReplayResult, formatReviewDue, formatRootCauseReport, formatSemanticList, formatSessionDetail, formatSessionList, formatStats } from "./format.js";
import { addEdge, addEntity, exploreGraph, extractEntities, getGraphCapStatus, getGraphStats, searchEntities } from "./graph.js";
import { getConfig, getHealth, getStats, optimize, updateConfig } from "./health.js";
import { invalidateMemoryCaches } from "./helpers.js";
import { exportMemories, importMemories, searchBacklogs } from "./io.js";
import { executeProcedure, getPatterns, getProcedures, learnPattern, storeProcedure, suggestApproach } from "./learning.js";
import { llmEvaluateImportance, llmExtractEntities, llmPostActionMemory, llmSummarizeSession } from "./llm.js";
import { autoHeal, getCapacityForecast, getConsolidationStats, getHealingStrategies, getHealthScore, runHealingAction } from "./metrics.js";
import { addToCollection, createCollection, listCollections, searchByTag, tag, untag } from "./organization.js";
import { getActiveSessionId, recordMismatch } from "./runtime.js";
import { forget, recall, store } from "./semantic.js";
import { closeSession, getSession, listSessions } from "./sessions.js";
import { summarizeSession } from "./summarize.js";
import { getMetrics } from "./telemetry.js";

// ── Tool Dispatch ──────────────────────────────────────────────────────────

/**
 * Main dispatch entry point for the Memory tool.
 * Routes the action to the appropriate handler and returns formatted output.
 */
export async function dispatch(action: MemoryBrainAction, params: any): Promise<string> {
  switch (action) {
    // ── Original Actions ─────────────────────────────────────────────────
    case "store": {
      const id = await store(params as StoreInput);
      return `Memory stored successfully (ID: ${id}). Category: ${params.category}, Title: "${params.title}"`;
    }

    case "recall": {
      const result = await recall(params as RecallInput);
      return formatRecallResult(result);
    }

    case "search": {
      // P2.1+P2.2 — Use RetrievalFusion for search dispatch
      const projectSessionIds = await getProjectSessionIds(
        params.session_id ?? getActiveSessionId() ?? undefined,
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
      return formatSemanticList(semantic, `Search results for: "${params.query}"`);
    }

    case "summarize_session": {
      const summary = await summarizeSession(params as SessionSummaryInput);
      return summary;
    }

    case "list_sessions": {
      const sessions = await listSessions(params?.limit, params?.workspace_directory);
      return formatSessionList(sessions);
    }

    case "get_session": {
      const session = await getSession(params.session_id);
      if (!session) return `Session "${params.session_id}" not found.`;
      const history = await BrainStore.getEpisodicBySession(params.session_id, params.limit ?? 50);
      return formatSessionDetail(session, history);
    }

    case "close_session": {
      return await closeSession(params.session_id);
    }

    case "delete": {
      const success = await forget(params.id);
      if (!success) {
        return `Memory #${params.id} not found.`;
      }
      let offer = "";
      try {
        const { formatLinkedRestoreOffer } = await import("../../../soul/extractToolFiles.js");
        const { getLastSoulEvent } = await import("../../../soul/recordSoulEvent.js");
        const sessionId = getActiveSessionId();
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
      const demoted = await recordMismatch(
        params.id,
        params.session_id,
      );
      return demoted
        ? `Memory #${params.id} marked not relevant.`
        : `Memory #${params.id} not found.`;
    }

    case "get_stats": {
      const stats = await getStats();
      return formatStats(stats);
    }

    case "consolidate": {
      const consolidated = await consolidate();
      return `Consolidation complete: ${consolidated.promoted} promoted, ${consolidated.demoted} demoted, ${consolidated.pruned} pruned, ${consolidated.summaries_created} summaries created.`;
    }

    case "associate": {
      const assocId = await associate(params as AssociateInput);
      return `Association created (ID: ${assocId}): ${params.source_type}#${params.source_id} → ${params.target_type}#${params.target_id} [${params.relationship}]`;
    }

    // ── Knowledge Graph Actions ──────────────────────────────────────────
    case "add_entity": {
      const entityId = await addEntity(params as AddEntityInput);
      return `Entity added/updated (ID: ${entityId}): [${params.entity_type}] ${params.name}`;
    }

    case "search_entities": {
      const entities = await searchEntities(
        params.query,
        params.entity_type,
        params.limit ?? 20,
      );
      return KnowledgeGraph.formatEntityList(entities, `Entity search results for: "${params.query}"`);
    }

    case "add_edge": {
      const edgeId = await addEdge(params as AddEdgeInput);
      return `Edge added/strengthened (ID: ${edgeId}): #${params.source_entity_id} —[${params.relationship}]→ #${params.target_entity_id}`;
    }

    case "explore_graph": {
      const exploreResult = await exploreGraph(params as ExploreGraphInput);
      return KnowledgeGraph.formatExploreResult(exploreResult);
    }

    case "get_graph_stats": {
      const [graphStats, cap] = await Promise.all([
        getGraphStats(),
        getGraphCapStatus(),
      ]);
      return KnowledgeGraph.formatGraphStats({ ...graphStats, cap });
    }

    case "extract_entities": {
      const extracted = await extractEntities(params.content ?? params.text ?? "");
      return `Entity extraction complete: ${extracted.added} added, ${extracted.updated} updated.\n${KnowledgeGraph.formatEntityList(extracted.entities, "Extracted entities:")}`;
    }

    // ── Learning Pattern Actions ─────────────────────────────────────────
    case "learn_pattern": {
      const patternId = await learnPattern(params as LearnPatternInput);
      return `Pattern recorded (ID: ${patternId}): [${params.goal_type}] ${params.pattern_signature} (${params.success ? "success" : "failure"})`;
    }

    case "suggest_approach": {
      const suggestions = await suggestApproach(
        params.query,
        params.goal_type,
        params.limit ?? 5,
      );
      return LearningEngine.formatSuggestions(suggestions);
    }

    case "get_patterns": {
      const patterns = await getPatterns(params?.goal_type, params?.limit);
      return LearningEngine.formatPatternList(patterns);
    }

    // ── Procedural Memory Actions ────────────────────────────────────────
    case "store_procedure": {
      const procId = await storeProcedure(params as StoreProcedureInput);
      return `Procedure stored (ID: ${procId}): "${params.name}" with ${params.steps?.length ?? 0} steps`;
    }

    case "get_procedures": {
      const procedures = await getProcedures(params?.category, params?.limit);
      return formatProcedureList(procedures);
    }

    case "execute_procedure": {
      const proc = await executeProcedure(params.id, params.success ?? true);
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
      const autoResult = await autoExtract(
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
      const result = await runPipeline(params);
      const phaseSummary = result.phases
        ?.map((p: any) => `${p.phase}: ${p.detail ?? p.success}`)
        .join("; ");
      if (result.context) {
        return result.context.context;
      }
      return phaseSummary ?? "Pipeline completed.";
    }

    case "get_phase_status": {
      const status = getPhaseStatus();
      return JSON.stringify(status);
    }

    case "get_effective_context": {
      const metrics = await getEffectiveContext();
      return JSON.stringify(metrics);
    }

    // ── Tag Actions ──────────────────────────────────────────────────────
    case "tag": {
      const tagId = await tag(params as TagInput);
      return `Tag "${params.tag}" added to ${params.memory_type}#${params.memory_id} (ID: ${tagId})`;
    }

    case "untag": {
      const untagged = await untag(params as TagInput);
      return untagged
        ? `Tag "${params.tag}" removed from ${params.memory_type}#${params.memory_id}`
        : `Tag "${params.tag}" not found on ${params.memory_type}#${params.memory_id}`;
    }

    case "search_by_tag": {
      const tagResults = await searchByTag(params.tag, params.memory_type, params.limit);
      if (tagResults.length === 0) return `No memories found with tag "${params.tag}"`;
      const parts = [`Memories tagged "${params.tag}" (${tagResults.length}):`];
      for (const t of tagResults) {
        parts.push(`  [${t.memory_type}#${t.memory_id}] tagged ${t.created_at}`);
      }
      return parts.join("\n");
    }

    // ── Collection Actions ───────────────────────────────────────────────
    case "create_collection": {
      const collId = await createCollection(params as CollectionInput);
      return `Collection created (ID: ${collId}): "${params.name}"`;
    }

    case "list_collections": {
      const collections = await listCollections(params?.limit);
      if (collections.length === 0) return "No collections created yet.";
      const parts = [`Collections (${collections.length}):`];
      for (const c of collections) {
        parts.push(`  [#${c.id}] ${c.name} (${c.item_count} items) — ${c.description || "no description"}`);
      }
      return parts.join("\n");
    }

    case "add_to_collection": {
      const itemId = await addToCollection(params as AddToCollectionInput);
      return `Added ${params.memory_type}#${params.memory_id} to collection #${params.collection_id} (item ID: ${itemId})`;
    }

    // ── Import/Export Actions ────────────────────────────────────────────
    case "export": {
      return await exportMemories();
    }

    case "import": {
      const importResult = await importMemories(params.file_path ?? params.path);
      invalidateMemoryCaches();
      return importResult;
    }

    // ── Self-Management Actions ──────────────────────────────────────────
    case "get_health": {
      const health = await getHealth();
      return formatHealth(health);
    }

    case "optimize": {
      return await optimize();
    }

    case "get_config": {
      const config = getConfig();
      return formatConfig(config);
    }

    case "update_config": {
      return await updateConfig(params as MemoryConfigInput);
    }

    // ── Cross-Session Backlog Search ─────────────────────────────────────
    case "search_backlogs": {
      const backlogResult = await searchBacklogs(params as BacklogSearchInput);
      return formatBacklogResult(backlogResult);
    }

    // ── LLM-Enhanced Actions ─────────────────────────────────────────────
    case "llm_extract_entities": {
      const llmExtract = await llmExtractEntities(
        params.text ?? params.content ?? "",
        params.session_id,
      );
      return `LLM Entity Extraction: ${llmExtract.added} added, ${llmExtract.updated} updated (LLM used: ${llmExtract.llm_used})\n${KnowledgeGraph.formatEntityList(llmExtract.entities, "Extracted entities:")}`;
    }

    case "llm_summarize_session": {
      const llmSummary = await llmSummarizeSession(
        params.session_id,
        params.detail_level,
      );
      return `Session Summary (LLM used: ${llmSummary.llm_used}):\n${llmSummary.summary}`;
    }

    case "llm_evaluate_importance": {
      const importance = await llmEvaluateImportance(
        params.content ?? params.text ?? "",
        params.role,
        params.context,
      );
      return `Importance Score: ${importance.score.toFixed(2)} (LLM used: ${importance.llm_used})\nReason: ${importance.reason}`;
    }

    case "llm_post_action_memory": {
      const postAction = await llmPostActionMemory(
        params.action_description,
        params.action_result,
        params.session_id,
      );
      return `Post-Action Memory Update (LLM used: ${postAction.llm_used}):\n  Memories created: ${postAction.memories_created}\n  Entities created: ${postAction.entities_created}\n  Patterns recorded: ${postAction.patterns_recorded}`;
    }

    // ── Checkpoint/Rollback Actions ──────────────────────────────────────
    case "create_checkpoint": {
      const checkpoint = await createCheckpoint(params.label ?? "manual");
      return `Checkpoint created (ID: ${checkpoint.id}): "${checkpoint.label}"\n  Semantic: ${checkpoint.semantic_count}, Entities: ${checkpoint.entity_count}, Patterns: ${checkpoint.pattern_count}\n  Snapshot: ${checkpoint.snapshot_path}`;
    }

    case "list_checkpoints": {
      const checkpoints = await listCheckpoints(params?.limit);
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
      const rollbackMsg = await rollbackCheckpoint(params.id ?? params.checkpoint_id);
      return rollbackMsg;
    }

    case "delete_checkpoint": {
      const deleted = await deleteCheckpoint(params.id ?? params.checkpoint_id);
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
      const mSummary = getMetrics(params.window_ms);
      return formatMetrics(mSummary);
    }

    case "get_health_score": {
      const hScore = await getHealthScore(params.weights);
      return formatHealthScore(hScore);
    }

    case "get_capacity_forecast": {
      const forecast = await getCapacityForecast();
      return formatForecast(forecast);
    }

    case "heal": {
      if (params.action) {
        const healResult = await runHealingAction(params.action as HealingAction);
        return formatHealingResult([healResult]);
      }
      const autoResults = await autoHeal();
      return formatHealingResult(autoResults);
    }

    case "get_healing_strategies": {
      const strats = getHealingStrategies();
      if (strats.length === 0) return "No healing strategies recorded yet. Run 'heal' first.";
      const sParts = ["Healing Strategy Effectiveness:"];
      for (const s of strats) {
        sParts.push(`  [${s.action}] effectiveness: ${s.effectiveness.toFixed(3)} — runs: ${s.total_runs}, success: ${s.success_count}/${s.total_runs}, avg impact: ${s.avg_impact.toFixed(3)}, avg duration: ${s.avg_duration_ms.toFixed(0)}ms`);
      }
      return sParts.join("\n");
    }

    case "get_consolidation_stats": {
      const cStats = getConsolidationStats();
      return formatConsolidationStats(cStats);
    }

    // ── Checkpoint Strategies & Lifecycle (Tier C) ───────────────────────
    case "checkpoint_strategy_config": {
      const cfg = CheckpointManager.getConfig();
      return formatCheckpointStrategyConfig(cfg);
    }

    case "update_checkpoint_strategy": {
      const update: CheckpointStrategyUpdate = {};
      if (params.mode) update.mode = params.mode;
      if (params.adaptive_change_threshold !== undefined) update.adaptive_change_threshold = params.adaptive_change_threshold;
      if (params.time_interval_minutes !== undefined) update.time_interval_minutes = params.time_interval_minutes;
      if (params.max_checkpoints !== undefined) update.max_checkpoints = params.max_checkpoints;
      if (params.max_age_days !== undefined) update.max_age_days = params.max_age_days;
      if (params.max_total_size_mb !== undefined) update.max_total_size_mb = params.max_total_size_mb;
      if (params.compress_snapshots !== undefined) update.compress_snapshots = params.compress_snapshots;
      await CheckpointManager.updateConfig(update);
      const updated = CheckpointManager.getConfig();
      return `Checkpoint strategy updated.\n${formatCheckpointStrategyConfig(updated)}`;
    }

    case "checkpoint_lifecycle_cleanup": {
      const report = await CheckpointManager.runLifecycleCleanup();
      return formatLifecycleReport(report);
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
      return formatReplayResult(replay);
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
      if (batchDelResult.deleted > 0) invalidateMemoryCaches();
      return formatBatchDeleteResult(batchDelResult);
    }

    case "batch_store": {
      const batchStoreResult = await BatchOperations.batchStore(params as BatchStoreInput);
      if (batchStoreResult.stored > 0) invalidateMemoryCaches();
      return formatBatchStoreResult(batchStoreResult);
    }

    case "batch_audit_log": {
      const batchAuditResult = await BatchOperations.batchAuditLog(params as BatchEventInput);
      return `Batch audit log: ${batchAuditResult.logged} logged, ${batchAuditResult.failed} failed.`;
    }

    case "batch_update_importance": {
      const updated = await BatchOperations.batchUpdateImportance(params.updates ?? []);
      if (updated > 0) invalidateMemoryCaches();
      return `Batch importance update: ${updated} records updated.`;
    }

    case "batch_move_tier": {
      const moved = await BatchOperations.batchMoveTier(params.target_type, params.ids, params.tier);
      if (moved > 0) invalidateMemoryCaches();
      return `Batch tier move: ${moved} records moved to "${params.tier}".`;
    }

    // ── Related Sessions Discovery (Tier D) ─────────────────────────────
    case "find_related_sessions": {
      const related = await SessionDiscovery.findRelatedSessions(
        params.session_id,
        params.limit ?? 10,
      );
      return formatRelatedSessions(related);
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
      return formatRootCauseReport(report);
    }

    // ── Spaced Repetition (Tier D) ──────────────────────────────────────
    case "get_review_due": {
      const cfg = BrainStore.getConfig();
      const due = await SpacedRepetition.getMemoriesDueForReview(
        params.retention_threshold ?? cfg.ebbinghaus_review_threshold,
        params.limit ?? 20,
      );
      return formatReviewDue(due);
    }

    case "boost_memory": {
      const newImportance = await SpacedRepetition.boostOnRetrieval(params.id ?? params.memory_id);
      return newImportance > 0
        ? `Memory #${params.id ?? params.memory_id} boosted — new importance: ${newImportance.toFixed(3)}`
        : `Memory #${params.id ?? params.memory_id} not found.`;
    }

    // ── LRU Cache (Tier D) ──────────────────────────────────────────────
    case "get_cache_stats": {
      const cacheStats = brainRuntime.memoryCache.getStats();
      return formatCacheStats(cacheStats);
    }

    case "clear_cache": {
      brainRuntime.memoryCache.clear();
      return "LRU cache cleared.";
    }

    // ── Metrics Storage (Tier D) ────────────────────────────────────────
    case "store_metrics_snapshot": {
      const mSummary = getMetrics(params.window_ms);
      const stats = await BrainStore.getStats();
      const compression = getCompressionStats();
      const effective = await getEffectiveContext();
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
