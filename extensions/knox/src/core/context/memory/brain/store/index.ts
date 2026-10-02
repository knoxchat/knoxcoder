import { DEDUP_SIMILARITY } from "./semantic.js";
import { KNOWLEDGE_SNAPSHOT_VERSION } from "./checkpoints.js";
import * as connection from "./connection.js";
import * as sessions from "./sessions.js";
import * as episodic from "./episodic.js";
import * as semantic from "./semantic.js";
import * as associations from "./associations.js";
import * as graph from "./graph.js";
import * as learning from "./learning.js";
import * as organization from "./organization.js";
import * as config from "./config.js";
import * as maintenance from "./maintenance.js";
import * as io from "./io.js";
import * as checkpoints from "./checkpoints.js";
import * as runtime from "./runtime.js";
import * as compression from "./compression.js";
import * as valence from "./valence.js";

/**
 * BrainStore — SQLite-backed human-brain-like persistent memory.
 *
 * Architecture mirrors Knox-MS patterns:
 * - Singleton database connection with busy timeout
 * - Three-tier memory (hot/warm/cold) with Ebbinghaus-inspired decay
 * - Episodic memory (conversation events) + Semantic memory (extracted knowledge)
 * - Knowledge graph (entities + edges + traversal)
 * - Learning patterns (success/failure tracking + suggestion)
 * - Procedural memory (workflows + steps)
 * - Tags & collections (organization)
 * - Cross-session associations (knowledge graph edges)
 * - Self-management (health, optimization, config)
 * - Import/Export (backup & restore)
 *
 * Implementation lives in this directory; this class is the public static facade
 * so existing `BrainStore.*` call sites stay unchanged.
 *
 * Data lives at ~/.knoxcoder/memory/brain.sqlite
 */
export class BrainStore {
  static readonly DEDUP_SIMILARITY = DEDUP_SIMILARITY;
  static readonly KNOWLEDGE_SNAPSHOT_VERSION = KNOWLEDGE_SNAPSHOT_VERSION;
  static isOpen = connection.isOpen;
  static get = connection.get;
  static createSession = sessions.createSession;
  static ensureSessionProjectId = sessions.ensureSessionProjectId;
  static listSessionIdsByProject = sessions.listSessionIdsByProject;
  static getTierTokenCounts = sessions.getTierTokenCounts;
  static updateSession = sessions.updateSession;
  static getSession = sessions.getSession;
  static listSessions = sessions.listSessions;
  static deleteSession = sessions.deleteSession;
  static addEpisodic = episodic.addEpisodic;
  static getEpisodicBySession = episodic.getEpisodicBySession;
  static getRecentEpisodic = episodic.getRecentEpisodic;
  static getRecentUserMessages = episodic.getRecentUserMessages;
  static estimateSessionTokens = episodic.estimateSessionTokens;
  static searchEpisodic = episodic.searchEpisodic;
  static getSemanticBySession = semantic.getSemanticBySession;
  static getSemanticById = semantic.getSemanticById;
  static touchSemanticRetrieval = semantic.touchSemanticRetrieval;
  static isPinned = semantic.isPinned;
  static storeSemantic = semantic.storeSemantic;
  static storeSemanticDeduped = semantic.storeSemanticDeduped;
  static searchSemantic = semantic.searchSemantic;
  static deleteSemantic = semantic.deleteSemantic;
  static recordMismatch = semantic.recordMismatch;
  static findDuplicates = semantic.findDuplicates;
  static boostDuplicate = semantic.boostDuplicate;
  static createAssociation = associations.createAssociation;
  static getAssociations = associations.getAssociations;
  static addEntity = graph.addEntity;
  static countEntities = graph.countEntities;
  static pruneEntities = graph.pruneEntities;
  static getEntity = graph.getEntity;
  static findEntity = graph.findEntity;
  static incrementEntityMention = graph.incrementEntityMention;
  static touchEntity = graph.touchEntity;
  static updateEntity = graph.updateEntity;
  static searchEntities = graph.searchEntities;
  static listEntities = graph.listEntities;
  static deleteEntity = graph.deleteEntity;
  static addEdge = graph.addEdge;
  static findEdge = graph.findEdge;
  static updateEdgeWeight = graph.updateEdgeWeight;
  static getEntityEdges = graph.getEntityEdges;
  static getGraphStats = graph.getGraphStats;
  static addPattern = learning.addPattern;
  static findPattern = learning.findPattern;
  static updatePatternStats = learning.updatePatternStats;
  static getPatterns = learning.getPatterns;
  static addProcedure = learning.addProcedure;
  static getProcedure = learning.getProcedure;
  static searchProcedures = learning.searchProcedures;
  static getAllProcedures = learning.getAllProcedures;
  static recordProcedureExecution = learning.recordProcedureExecution;
  static addTag = organization.addTag;
  static removeTag = organization.removeTag;
  static getTagsForMemory = organization.getTagsForMemory;
  static searchByTag = organization.searchByTag;
  static createCollection = organization.createCollection;
  static listCollections = organization.listCollections;
  static addToCollection = organization.addToCollection;
  static getCollectionItems = organization.getCollectionItems;
  static getConfig = config.getConfig;
  static reloadConfig = config.reloadConfig;
  static saveConfig = config.saveConfig;
  static consolidate = maintenance.consolidate;
  static getStats = maintenance.getStats;
  static getHealth = maintenance.getHealth;
  static optimize = maintenance.optimize;
  static exportAll = io.exportAll;
  static importData = io.importData;
  static searchBacklogs = io.searchBacklogs;
  static readKnowledgeSnapshot = checkpoints.readKnowledgeSnapshot;
  static createCheckpoint = checkpoints.createCheckpoint;
  static listCheckpoints = checkpoints.listCheckpoints;
  static findCheckpointByWorkspaceId = checkpoints.findCheckpointByWorkspaceId;
  static findNearestCheckpointBefore = checkpoints.findNearestCheckpointBefore;
  static deleteCheckpointsForWorkspaceId = checkpoints.deleteCheckpointsForWorkspaceId;
  static trimEpisodicAfter = checkpoints.trimEpisodicAfter;
  static rollbackCheckpoint = checkpoints.rollbackCheckpoint;
  static pruneMissingCheckpointSnapshots = checkpoints.pruneMissingCheckpointSnapshots;
  static deleteCheckpoint = checkpoints.deleteCheckpoint;
  static checkRateLimit = runtime.checkRateLimit;
  static recordLlmCall = runtime.recordLlmCall;
  static getRateLimitState = runtime.getRateLimitState;
  static auditLog = runtime.auditLog;
  static getAuditLog = runtime.getAuditLog;
  static addSessionTopic = runtime.addSessionTopic;
  static getSessionTopics = runtime.getSessionTopics;
  static getLatestSessionTopic = runtime.getLatestSessionTopic;
  static openTask = runtime.openTask;
  static getOpenTask = runtime.getOpenTask;
  static closeTask = runtime.closeTask;
  static bindTaskTopic = runtime.bindTaskTopic;
  static listSessionTasks = runtime.listSessionTasks;
  static ensureCurrentTopic = runtime.ensureCurrentTopic;
  static compressContent = compression.compressContent;
  static decompressContent = compression.decompressContent;
  static compressColdTier = compression.compressColdTier;
  static detectEmotionalValence = valence.detectEmotionalValence;
  static computeSalience = valence.computeSalience;
}
