import { associate } from "./associations.js";
import {
  createCheckpoint,
  listCheckpoints,
  findCheckpointByWorkspaceId,
  findNearestCheckpointBefore,
  deleteCheckpointsForWorkspaceId,
  isBrainOpen,
  pinForWorkspaceCheckpoint,
  trimEpisodicAfter,
  rollbackCheckpoint,
  deleteCheckpoint,
} from "./checkpoints.js";
import { startAutoConsolidation, stopAutoConsolidation, consolidate } from "./consolidation.js";
import {
  buildContextForMessage,
  buildContextDetailed,
  runPipeline,
  getPhaseStatus,
  getEffectiveContext,
  recordCompressionMetrics,
  recordContextBuild,
  getContextBuildStats,
  getCompressionStats,
  routeTask,
  runAutonomousLoop,
  cancelAutonomousLoop,
  getAutonomousLoopStatus,
} from "./context.js";
import { dispatch } from "./dispatch.js";
import { recordMessage, getSessionHistory, getSessionHistoryFull } from "./episodic.js";
import { onEvent, clearEventListeners, publishEvent } from "./events.js";
import { autoExtract } from "./extraction.js";
import {
  addEntity,
  searchEntities,
  listEntities,
  addEdge,
  exploreGraph,
  getGraphStats,
  getGraphCapStatus,
  extractEntities,
} from "./graph.js";
import {
  getStats,
  getHealth,
  optimize,
  getConfig,
  updateConfig,
} from "./health.js";
import { exportMemories, importMemories, searchBacklogs } from "./io.js";
import {
  learnPattern,
  suggestApproach,
  getPatterns,
  storeProcedure,
  getProcedures,
  executeProcedure,
} from "./learning.js";
import {
  llmExtractEntities,
  llmSummarizeSession,
  llmEvaluateImportance,
  llmPostActionMemory,
  countTokensAccurate,
} from "./llm.js";
import {
  storeMetricsSnapshot,
  getMetricsTrend,
  getHealthScore,
  getCapacityForecast,
  runHealingAction,
  autoHeal,
  getHealingStrategies,
  getConsolidationStats,
  getReviewDue,
  getEbbinghausStats,
} from "./metrics.js";
import {
  tag,
  untag,
  searchByTag,
  createCollection,
  listCollections,
  addToCollection,
} from "./organization.js";
import {
  setLlm,
  getLlm,
  getActiveSessionId,
  ingestSensoryInput,
  getWorkingMemory,
  onTopicShift,
  restoreWorkingMemory,
  persistWorkingMemory,
  switchWorkingMemorySession,
  pinMemory,
  unpinMemory,
  recordMismatch,
} from "./runtime.js";
import {
  store,
  recall,
  forget,
  forgetMany,
  pinMemories,
  unpinMemories,
} from "./semantic.js";
import {
  trackSession,
  listSessions,
  getSession,
  deleteSession,
  closeSession,
  closeStaleSessions,
} from "./sessions.js";
import { summarizeSession } from "./summarize.js";
import { recordMetric, getMetrics, measureOperation } from "./telemetry.js";

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
 *
 * Implementation lives in this directory; this class is the public static facade
 * so existing `BrainManager.*` call sites stay unchanged.
 */
export class BrainManager {
  static setLlm = setLlm;
  static getLlm = getLlm;
  static getActiveSessionId = getActiveSessionId;
  static ingestSensoryInput = ingestSensoryInput;
  static getWorkingMemory = getWorkingMemory;
  static onTopicShift = onTopicShift;
  static restoreWorkingMemory = restoreWorkingMemory;
  static persistWorkingMemory = persistWorkingMemory;
  static switchWorkingMemorySession = switchWorkingMemorySession;
  static pinMemory = pinMemory;
  static unpinMemory = unpinMemory;
  static recordMismatch = recordMismatch;
  static onEvent = onEvent;
  static clearEventListeners = clearEventListeners;
  static publishEvent = publishEvent;
  static trackSession = trackSession;
  static listSessions = listSessions;
  static getSession = getSession;
  static deleteSession = deleteSession;
  static closeSession = closeSession;
  static closeStaleSessions = closeStaleSessions;
  static recordMessage = recordMessage;
  static getSessionHistory = getSessionHistory;
  static getSessionHistoryFull = getSessionHistoryFull;
  static store = store;
  static recall = recall;
  static forget = forget;
  static forgetMany = forgetMany;
  static pinMemories = pinMemories;
  static unpinMemories = unpinMemories;
  static summarizeSession = summarizeSession;
  static associate = associate;
  static startAutoConsolidation = startAutoConsolidation;
  static stopAutoConsolidation = stopAutoConsolidation;
  static consolidate = consolidate;
  static getStats = getStats;
  static buildContextForMessage = buildContextForMessage;
  static buildContextDetailed = buildContextDetailed;
  static runPipeline = runPipeline;
  static getPhaseStatus = getPhaseStatus;
  static getEffectiveContext = getEffectiveContext;
  static recordCompressionMetrics = recordCompressionMetrics;
  static recordContextBuild = recordContextBuild;
  static getContextBuildStats = getContextBuildStats;
  static getCompressionStats = getCompressionStats;
  static routeTask = routeTask;
  static runAutonomousLoop = runAutonomousLoop;
  static cancelAutonomousLoop = cancelAutonomousLoop;
  static getAutonomousLoopStatus = getAutonomousLoopStatus;
  static autoExtract = autoExtract;
  static addEntity = addEntity;
  static searchEntities = searchEntities;
  static listEntities = listEntities;
  static addEdge = addEdge;
  static exploreGraph = exploreGraph;
  static getGraphStats = getGraphStats;
  static getGraphCapStatus = getGraphCapStatus;
  static extractEntities = extractEntities;
  static learnPattern = learnPattern;
  static suggestApproach = suggestApproach;
  static getPatterns = getPatterns;
  static storeProcedure = storeProcedure;
  static getProcedures = getProcedures;
  static executeProcedure = executeProcedure;
  static tag = tag;
  static untag = untag;
  static searchByTag = searchByTag;
  static createCollection = createCollection;
  static listCollections = listCollections;
  static addToCollection = addToCollection;
  static getHealth = getHealth;
  static optimize = optimize;
  static getConfig = getConfig;
  static updateConfig = updateConfig;
  static recordMetric = recordMetric;
  static getMetrics = getMetrics;
  static storeMetricsSnapshot = storeMetricsSnapshot;
  static getMetricsTrend = getMetricsTrend;
  static measureOperation = measureOperation;
  static getHealthScore = getHealthScore;
  static getCapacityForecast = getCapacityForecast;
  static runHealingAction = runHealingAction;
  static autoHeal = autoHeal;
  static getHealingStrategies = getHealingStrategies;
  static getConsolidationStats = getConsolidationStats;
  static getReviewDue = getReviewDue;
  static getEbbinghausStats = getEbbinghausStats;
  static exportMemories = exportMemories;
  static importMemories = importMemories;
  static searchBacklogs = searchBacklogs;
  static llmExtractEntities = llmExtractEntities;
  static llmSummarizeSession = llmSummarizeSession;
  static llmEvaluateImportance = llmEvaluateImportance;
  static llmPostActionMemory = llmPostActionMemory;
  static countTokensAccurate = countTokensAccurate;
  static createCheckpoint = createCheckpoint;
  static listCheckpoints = listCheckpoints;
  static findCheckpointByWorkspaceId = findCheckpointByWorkspaceId;
  static findNearestCheckpointBefore = findNearestCheckpointBefore;
  static deleteCheckpointsForWorkspaceId = deleteCheckpointsForWorkspaceId;
  static isBrainOpen = isBrainOpen;
  static pinForWorkspaceCheckpoint = pinForWorkspaceCheckpoint;
  static trimEpisodicAfter = trimEpisodicAfter;
  static rollbackCheckpoint = rollbackCheckpoint;
  static deleteCheckpoint = deleteCheckpoint;
  static dispatch = dispatch;
}
