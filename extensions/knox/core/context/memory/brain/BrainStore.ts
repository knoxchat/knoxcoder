import fs from "fs";
import path from "path";
import zlib from "zlib";
import { randomUUID } from "node:crypto";

import { open } from "sqlite";
import sqlite3 from "sqlite3";

import { DatabaseConnection } from "../../../util/refreshIndex.js";
import { getMemoryBrainSqlitePath, getMemoryBrainPath } from "../../../util/paths.js";
import { RetrievalFusion } from "./RetrievalFusion.js";
import { InputSanitizer } from "./InputSanitizer.js";
import { entitySearchTerms, requiresBoundedEntityMatch } from "./GraphRetrieval.js";

import type {
  BrainSession,
  EpisodicMemory,
  SemanticMemory,
  MemoryAssociation,
  StoreInput,
  RecallInput,
  RecallResult,
  BrainStats,
  ConsolidationResult,
  EpisodicType,
  MemoryTier,
  SemanticCategory,
  AssociateInput,
  GraphEntity,
  GraphEdge,
  AddEntityInput,
  AddEdgeInput,
  EntityType,
  LearningPattern,
  GoalType,
  ProceduralMemory,
  MemoryTag,
  MemoryCollection,
  CollectionItem,
  HealthStatus,
  MemoryConfig,
  MemoryExport,
  MemoryCheckpoint,
  BacklogSearchResult,
  RateLimitState,
  AuditLogEntry,
  SessionTopic,
  BrainTask,
  EmotionalValence,
} from "./types.js";
import { MEMORY_CONTEXT_TOKEN_CEILING } from "./types.js";

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
 * Data lives at ~/.knox/memory/brain.sqlite
 */
export class BrainStore {
  private static db: DatabaseConnection | null = null;
  private static defaultConfigSnapshot: MemoryConfig | null = null;
  private static config: MemoryConfig = {
    auto_extract_enabled: true,
    auto_extract_min_importance: 0.3,
    consolidation_interval_hours: 24,
    max_episodic_per_session: 1000,
    max_hot_memories: 500,
    hot_to_warm_hours: 24,
    warm_to_cold_days: 7,
    cold_prune_days: 90,
    graph_enabled: true,
    learning_enabled: true,
    context_max_tokens: MEMORY_CONTEXT_TOKEN_CEILING,
    max_context_tokens: MEMORY_CONTEXT_TOKEN_CEILING,
    context_goal_budget_ratio: 0.1,
    memory_mode: "summarized",
    retrieval_threshold: 0.6,
    retrieval_top_k: 20,
    retrieval_continuation_expand: true,
    fts5_use_and_for_content: true,
    topic_shift_jaccard: 0.35,
    retrieval_require_lexical: true,
    wm_mismatch_decay: 0.25,
    wm_inject_min_relevance: 0.35,
    summary_inject_min_overlap: 0.2,
    pinned_unmatched_cap: 2,
    graph_max_entities: 5000,
    graph_max_depth: 3,
    memory_scope: "project",
    sensory_buffer_ms: 250,
    auto_summarize: true,
    summarize_threshold: 50,
    enable_knowledge_extraction: true,
    post_turn_min_chars: 80,
    mode_full_semantic_multiplier: 1.25,
    mode_full_episodic_multiplier: 2.0,
    mode_full_min_importance: 0,
    mode_full_episodic_snippet_len: 400,
    mode_summarized_semantic_multiplier: 0.75,
    mode_summarized_episodic_multiplier: 0.75,
    mode_summarized_min_importance: 0.3,
    mode_summarized_episodic_snippet_len: 150,
    mode_selective_semantic_multiplier: 0.5,
    mode_selective_episodic_multiplier: 0.25,
    mode_selective_min_importance: 0.7,
    mode_selective_episodic_snippet_len: 200,
    mode_selective_include_episodic: false,
    mode_selective_include_procedures: false,
    mode_selective_include_patterns: false,
    context_graph_entity_search: 10,
    context_graph_entity_display: 5,
    context_graph_edge_per_entity: 3,
    context_graph_edge_budget_ratio: 0.7,
    context_procedure_limit: 5,
    context_pattern_limit: 3,
    context_pinned_limit: 10,
    context_session_summary_min_tokens: 200,
    context_line_truncate_chars: 300,
    context_line_compress_chars: 200,
    context_compress_keep_lines: 3,
    budget_semantic_ratio: 0.40,
    budget_episodic_ratio: 0.25,
    budget_graph_ratio: 0.15,
    budget_procedures_ratio: 0.10,
    budget_patterns_ratio: 0.10,
    budget_min_semantic_ratio: 0.15,
    budget_min_episodic_ratio: 0.10,
    budget_min_graph_ratio: 0.05,
    budget_min_procedures_ratio: 0.05,
    budget_min_patterns_ratio: 0.05,
    budget_query_procedural_boost: 0.10,
    budget_query_graph_boost: 0.10,
    budget_query_patterns_boost: 0.08,
    budget_query_episodic_long_boost: 0.08,
    budget_query_semantic_short_boost: 0.08,
    budget_query_long_threshold_chars: 500,
    budget_query_short_threshold_chars: 50,
    fusion_candidate_multiplier: 5,
    fusion_candidate_min: 50,
    graph_depth_decay_gamma: 0.7,
    graph_memory_boost_factor: 0.3,
    graph_entity_search_limit: 5,
    graph_neighbor_limit: 10,
    graph_neighbor_memory_limit: 5,
    graph_indirect_neighbor_factor: 0.5,
    recency_decay_lambda: 0.004125,
    fusion_conversational_min_chars: 200,
    fusion_factual_max_chars: 80,
    fusion_default_fts5: 0.35,
    fusion_default_trigram: 0.15,
    fusion_default_graph: 0.20,
    fusion_default_recency: 0.15,
    fusion_default_importance: 0.15,
    fusion_factual_fts5: 0.50,
    fusion_factual_trigram: 0.10,
    fusion_factual_graph: 0.20,
    fusion_factual_recency: 0.10,
    fusion_factual_importance: 0.10,
    fusion_conversational_fts5: 0.40,
    fusion_conversational_trigram: 0.10,
    fusion_conversational_graph: 0.15,
    fusion_conversational_recency: 0.15,
    fusion_conversational_importance: 0.20,
    fusion_procedural_fts5: 0.30,
    fusion_procedural_trigram: 0.20,
    fusion_procedural_graph: 0.25,
    fusion_procedural_recency: 0.10,
    fusion_procedural_importance: 0.15,
    fusion_code_fts5: 0.25,
    fusion_code_trigram: 0.30,
    fusion_code_graph: 0.15,
    fusion_code_recency: 0.15,
    fusion_code_importance: 0.15,
    fusion_continuation_fts5: 0.35,
    fusion_continuation_trigram: 0.10,
    fusion_continuation_graph: 0.10,
    fusion_continuation_recency: 0.30,
    fusion_continuation_importance: 0.15,
    enable_enhanced_semantic: false,
    compression_ratio_active: 1.0,
    compression_ratio_hot: 0.5,
    compression_ratio_warm: 0.2,
    compression_ratio_cold: 0.1,
    compression_ratio_frozen: 0.05,
    working_memory_max_slots: 7,
    working_memory_token_budget: 30000,
    working_memory_token_ratio: 0.125,
    working_memory_decay_rate: 0.001,
    working_memory_ttl_seconds: 30,
    easy_model: "",
    medium_model: "",
    hard_model: "",
    autonomous_max_iterations: 0,
    ebbinghaus_base_strength: 1.0,
    ebbinghaus_lambda: 0.03,
    ebbinghaus_prune_threshold: 0.1,
    ebbinghaus_review_threshold: 0.5,
    ebbinghaus_strengthening_alpha: 0.1,
    ebbinghaus_repetition_beta: 0.1,
    ebbinghaus_salience_weight: 0.5,
    ebbinghaus_importance_weight: 0.3,
    memory_build_timeout_ms: 5000,
    memory_track_session_timeout_ms: 1500,
    llm_entity_extraction_enabled: true,
    llm_summarization_enabled: true,
    llm_importance_scoring_enabled: true,
    llm_post_action_memory_enabled: true,
    llm_calls_per_hour_limit: 60,
    llm_tokens_per_hour_limit: 500000,
    preferred_summary_detail: "detailed",
    auto_checkpoint_interval: 5,
  };

  // ── Database Lifecycle ─────────────────────────────────────────────────────

  // Single in-flight init promise so concurrent first callers share one
  // connection instead of racing to open several.
  private static initPromise: Promise<DatabaseConnection> | null = null;

  /** True after a successful open. Does not open sqlite. */
  static isOpen(): boolean {
    return BrainStore.db != null;
  }

  static async get(): Promise<DatabaseConnection> {
    const dbPath = getMemoryBrainSqlitePath();
    if (BrainStore.db && fs.existsSync(dbPath)) {
      return BrainStore.db;
    }
    if (BrainStore.initPromise) {
      return BrainStore.initPromise;
    }

    BrainStore.initPromise = (async () => {
      try {
        const db = await open({
          filename: dbPath,
          driver: sqlite3.Database,
        });

        await db.exec("PRAGMA busy_timeout = 5000;");
        await db.exec("PRAGMA journal_mode = WAL;");
        await db.exec("PRAGMA foreign_keys = ON;");
        await BrainStore.createTables(db);
        await BrainStore.migrateSchema(db);
        await RetrievalFusion.initFts5Tables(db).catch(() => {
          // FTS5 might not be available in all SQLite builds — degrade gracefully
        });
        // Publish only after the schema is ready so concurrent callers never
        // see a half-initialized database.
        BrainStore.db = db;
        await BrainStore.loadConfig();
        const { KnowledgeGraph } = await import("./KnowledgeGraph.js");
        await KnowledgeGraph.enforceEntityCap().catch(() => {});
        // T7.2: consolidation starts on first real open (chat / Memory view),
        // not during extension activate.
        void import("./BrainManager.js")
          .then(({ BrainManager }) => {
            BrainManager.startAutoConsolidation();
          })
          .catch(() => {});

        return db;
      } finally {
        BrainStore.initPromise = null;
      }
    })();

    return BrainStore.initPromise;
  }

  private static async createTables(db: DatabaseConnection): Promise<void> {
    // Sessions table — tracks every conversation session
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Untitled Session',
        workspace_directory TEXT NOT NULL DEFAULT '',
        project_id TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        message_count INTEGER NOT NULL DEFAULT 0,
        summary TEXT DEFAULT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Episodic memory — raw conversation turns and events
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_episodic (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'user_message',
        role TEXT NOT NULL DEFAULT 'user',
        content TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        importance_score REAL NOT NULL DEFAULT 0.5,
        emotional_valence TEXT NOT NULL DEFAULT 'neutral',
        salience REAL NOT NULL DEFAULT 0.5,
        tier TEXT NOT NULL DEFAULT 'hot',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES brain_sessions(id) ON DELETE CASCADE
      )
    `);

    // Semantic memory — extracted facts, decisions, patterns
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_semantic (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL DEFAULT 'fact',
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_session_id TEXT DEFAULT NULL,
        keywords TEXT NOT NULL DEFAULT '',
        importance_score REAL NOT NULL DEFAULT 0.5,
        emotional_valence TEXT NOT NULL DEFAULT 'neutral',
        salience REAL NOT NULL DEFAULT 0.5,
        retrieval_count INTEGER NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'hot',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME DEFAULT NULL,
        topic_id INTEGER DEFAULT NULL,
        task_id TEXT DEFAULT NULL,
        mismatch_count INTEGER NOT NULL DEFAULT 0,
        mismatch_until DATETIME DEFAULT NULL,
        mismatch_topic_id INTEGER DEFAULT NULL,
        FOREIGN KEY (source_session_id) REFERENCES brain_sessions(id) ON DELETE SET NULL
      )
    `);

    // Associations — cross-memory links (knowledge graph edges)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        relationship TEXT NOT NULL DEFAULT 'related',
        strength REAL NOT NULL DEFAULT 0.5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Knowledge Graph: Entities
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL DEFAULT 'custom',
        description TEXT NOT NULL DEFAULT '',
        properties TEXT NOT NULL DEFAULT '{}',
        confidence REAL NOT NULL DEFAULT 0.8,
        mention_count INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Knowledge Graph: Edges
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_graph_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_entity_id INTEGER NOT NULL,
        target_entity_id INTEGER NOT NULL,
        relationship TEXT NOT NULL DEFAULT 'related',
        weight REAL NOT NULL DEFAULT 0.5,
        properties TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_entity_id) REFERENCES brain_entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES brain_entities(id) ON DELETE CASCADE
      )
    `);

    // Learning Patterns
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_learning_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_type TEXT NOT NULL DEFAULT 'other',
        pattern_signature TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0.5,
        avg_tokens_used REAL NOT NULL DEFAULT 0,
        last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);

    // Procedural Memory — workflows and step sequences
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_procedures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        steps TEXT NOT NULL DEFAULT '[]',
        trigger_pattern TEXT NOT NULL DEFAULT '',
        success_rate REAL NOT NULL DEFAULT 0.0,
        execution_count INTEGER NOT NULL DEFAULT 0,
        last_executed_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        category TEXT NOT NULL DEFAULT 'general'
      )
    `);

    // Tags — flexible tagging for all memory types
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_type TEXT NOT NULL,
        memory_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(memory_type, memory_id, tag)
      )
    `);

    // Collections — grouped memories
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Collection items
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_collection_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER NOT NULL,
        memory_type TEXT NOT NULL,
        memory_id INTEGER NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (collection_id) REFERENCES brain_collections(id) ON DELETE CASCADE,
        UNIQUE(collection_id, memory_type, memory_id)
      )
    `);

    // Configuration table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Indexes — original
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_session ON brain_episodic(session_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_tier ON brain_episodic(tier)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_importance ON brain_episodic(importance_score DESC)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_category ON brain_semantic(category)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_keywords ON brain_semantic(keywords)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_tier ON brain_semantic(tier)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_importance ON brain_semantic(importance_score DESC)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_assoc_source ON brain_associations(source_type, source_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_assoc_target ON brain_associations(target_type, target_id)`);

    // Indexes — knowledge graph
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_name ON brain_entities(name)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_type ON brain_entities(entity_type)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_confidence ON brain_entities(confidence DESC)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_graph_edge_source ON brain_graph_edges(source_entity_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_graph_edge_target ON brain_graph_edges(target_entity_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_graph_edge_rel ON brain_graph_edges(relationship)`);

    // Indexes — learning
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_pattern_goal ON brain_learning_patterns(goal_type)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_pattern_confidence ON brain_learning_patterns(confidence DESC)`);

    // Indexes — procedures
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_procedure_category ON brain_procedures(category)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_procedure_trigger ON brain_procedures(trigger_pattern)`);

    // Indexes — tags
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_tag_tag ON brain_tags(tag)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_tag_memory ON brain_tags(memory_type, memory_id)`);

    // Indexes — collections
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_coll_item_coll ON brain_collection_items(collection_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_coll_item_mem ON brain_collection_items(memory_type, memory_id)`);

    // Checkpoints table — memory state snapshots for rollback
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        semantic_count INTEGER NOT NULL DEFAULT 0,
        entity_count INTEGER NOT NULL DEFAULT 0,
        pattern_count INTEGER NOT NULL DEFAULT 0,
        snapshot_path TEXT NOT NULL DEFAULT '',
        workspace_checkpoint_id TEXT
      )
    `);

    // Rate limit tracking table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_rate_limits (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        calls_this_hour INTEGER NOT NULL DEFAULT 0,
        tokens_this_hour INTEGER NOT NULL DEFAULT 0,
        hour_start INTEGER NOT NULL DEFAULT 0,
        denied_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    await db.exec(`INSERT OR IGNORE INTO brain_rate_limits (id, calls_this_hour, tokens_this_hour, hour_start, denied_count) VALUES (1, 0, 0, 0, 0)`);

    // Audit log table — tracks all CRUD operations
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT DEFAULT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Session topics table — detected topic shifts per session
    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_session_topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        keywords TEXT NOT NULL DEFAULT '',
        message_range_start INTEGER NOT NULL DEFAULT 0,
        message_range_end INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0.5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES brain_sessions(id) ON DELETE CASCADE
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS brain_tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        topic_id INTEGER DEFAULT NULL,
        title TEXT NOT NULL,
        opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME DEFAULT NULL,
        FOREIGN KEY (session_id) REFERENCES brain_sessions(id) ON DELETE CASCADE
      )
    `);

    // Indexes — cross-session backlog search optimization
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_content ON brain_episodic(content)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_created ON brain_episodic(created_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_episodic_role ON brain_episodic(role)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_created ON brain_semantic(created_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_session ON brain_semantic(source_session_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_topic ON brain_semantic(topic_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_task ON brain_semantic(task_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_checkpoint_label ON brain_checkpoints(label)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_action ON brain_audit_log(action)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_target ON brain_audit_log(target_type, target_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_created ON brain_audit_log(created_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_session_topics_session ON brain_session_topics(session_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON brain_tasks(session_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_open ON brain_tasks(session_id, closed_at)`);
  }

  // ── Session Operations ─────────────────────────────────────────────────────

  static async createSession(id: string, title: string, workspaceDir: string): Promise<void> {
    const db = await BrainStore.get();
    const { hashProjectId } = await import("./projectScope.js");
    const projectId = hashProjectId(workspaceDir);
    await db.run(
      `INSERT OR REPLACE INTO brain_sessions (id, title, workspace_directory, project_id, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [id, title, workspaceDir, projectId],
    );
  }

  /** Backfill project_id and workspace_directory when a session is re-tracked (IMP-25). */
  static async ensureSessionProjectId(sessionId: string, workspaceDir: string): Promise<void> {
    if (!workspaceDir) return;
    const db = await BrainStore.get();
    const { hashProjectId } = await import("./projectScope.js");
    const projectId = hashProjectId(workspaceDir);
    await db.run(
      `UPDATE brain_sessions
       SET workspace_directory = CASE WHEN workspace_directory = '' OR workspace_directory IS NULL THEN ? ELSE workspace_directory END,
           project_id = CASE WHEN project_id = '' OR project_id IS NULL THEN ? ELSE project_id END,
           updated_at = datetime('now')
       WHERE id = ?`,
      [workspaceDir, projectId, sessionId],
    );
  }

  static async listSessionIdsByProject(projectId: string): Promise<string[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      "SELECT id FROM brain_sessions WHERE project_id = ?",
      [projectId],
    );
    return rows.map((r: any) => r.id as string);
  }

  /**
   * Estimate token counts per memory tier for C_effective calculation.
   */
  static async getTierTokenCounts(): Promise<Record<string, number>> {
    const db = await BrainStore.get();
    const tiers = ["active", "hot", "warm", "cold", "frozen"];
    const counts: Record<string, number> = Object.fromEntries(tiers.map((t) => [t, 0]));

    const semRows = await db.all(`
      SELECT tier,
        SUM(CAST((LENGTH(title) + LENGTH(content) + LENGTH(keywords)) / 4 AS INTEGER)) AS tokens
      FROM brain_semantic
      GROUP BY tier
    `);
    for (const r of semRows) {
      const tier = (r as any).tier;
      if (counts[tier] !== undefined) {
        counts[tier] += (r as any).tokens ?? 0;
      }
    }

    const epRows = await db.all(`
      SELECT tier,
        SUM(CASE WHEN token_count > 0 THEN token_count
             ELSE CAST(LENGTH(content) / 4 AS INTEGER) END) AS tokens
      FROM brain_episodic
      GROUP BY tier
    `);
    for (const r of epRows) {
      const tier = (r as any).tier;
      if (counts[tier] !== undefined) {
        counts[tier] += (r as any).tokens ?? 0;
      }
    }

    return counts;
  }

  static async updateSession(id: string, updates: Partial<Pick<BrainSession, "title" | "summary" | "is_active" | "message_count">>): Promise<void> {
    const db = await BrainStore.get();
    const sets: string[] = ["updated_at = datetime('now')"];
    const params: any[] = [];

    if (updates.title !== undefined) { sets.push("title = ?"); params.push(updates.title); }
    if (updates.summary !== undefined) { sets.push("summary = ?"); params.push(updates.summary); }
    if (updates.is_active !== undefined) { sets.push("is_active = ?"); params.push(updates.is_active ? 1 : 0); }
    if (updates.message_count !== undefined) { sets.push("message_count = ?"); params.push(updates.message_count); }

    params.push(id);
    await db.run(`UPDATE brain_sessions SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  static async getSession(id: string): Promise<BrainSession | null> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT * FROM brain_sessions WHERE id = ?", [id]);
    return row ? BrainStore.rowToSession(row) : null;
  }

  static async listSessions(limit = 50, workspaceDir?: string): Promise<BrainSession[]> {
    const db = await BrainStore.get();
    let sql = "SELECT * FROM brain_sessions";
    const params: any[] = [];

    if (workspaceDir) {
      sql += " WHERE workspace_directory = ?";
      params.push(workspaceDir);
    }

    sql += " ORDER BY updated_at DESC LIMIT ?";
    params.push(limit);

    const rows = await db.all(sql, params);
    return rows.map(BrainStore.rowToSession);
  }

  static async deleteSession(id: string): Promise<boolean> {
    const db = await BrainStore.get();
    const result = await db.run("DELETE FROM brain_sessions WHERE id = ?", [id]);
    return (result.changes ?? 0) > 0;
  }

  // ── Episodic Memory Operations ─────────────────────────────────────────────

  static async addEpisodic(
    sessionId: string,
    type: EpisodicType,
    role: string,
    content: string,
    tokenCount: number = 0,
    importanceScore: number = 0.5,
    metadata: Record<string, any> = {},
    emotionalValence?: EmotionalValence,
    salience?: number,
  ): Promise<number> {
    const db = await BrainStore.get();

    // Security scan episodic content (scan only, don't block conversation tracking)
    const scanResult = InputSanitizer.scan(content);
    const cleanedContent = scanResult.cleaned;

    // Ensure session exists
    const session = await BrainStore.getSession(sessionId);
    if (!session) {
      await BrainStore.createSession(sessionId, "Auto-created session", "");
    }

    // Auto-detect emotional valence if not provided
    const valence = emotionalValence ?? BrainStore.detectEmotionalValence(cleanedContent, role);
    const sal = salience ?? BrainStore.computeSalience(cleanedContent, role, importanceScore);

    const result = await db.run(
      `INSERT INTO brain_episodic (session_id, type, role, content, token_count, importance_score, emotional_valence, salience, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, type, role, cleanedContent, tokenCount, importanceScore, valence, sal, JSON.stringify(metadata)],
    );

    // Update session message count
    await db.run(
      `UPDATE brain_sessions SET message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?`,
      [sessionId],
    );

    return result.lastID!;
  }

  static async getEpisodicBySession(sessionId: string, limit = 100): Promise<EpisodicMemory[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT * FROM brain_episodic WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
      [sessionId, limit],
    );
    return rows.map(BrainStore.rowToEpisodic);
  }

  static async getRecentEpisodic(limit = 50): Promise<EpisodicMemory[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT * FROM brain_episodic WHERE tier IN ('hot', 'warm')
       ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map(BrainStore.rowToEpisodic);
  }

  /** Most recent user turns for a session (newest first). Used by REL-01 query expansion. */
  static async getRecentUserMessages(sessionId: string, limit = 8): Promise<string[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT content FROM brain_episodic
       WHERE session_id = ? AND role = 'user'
       ORDER BY created_at DESC LIMIT ?`,
      [sessionId, limit],
    );
    return rows.map((r: { content: string }) => r.content);
  }

  // ── Semantic Memory Operations ─────────────────────────────────────────────

  static async getSemanticBySession(sessionId: string, limit = 200): Promise<SemanticMemory[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT * FROM brain_semantic WHERE source_session_id = ? ORDER BY created_at ASC LIMIT ?`,
      [sessionId, limit],
    );
    return rows.map(BrainStore.rowToSemantic);
  }

  static async estimateSessionTokens(sessionId: string): Promise<number> {
    const db = await BrainStore.get();
    const row = await db.get(
      `SELECT COALESCE(SUM(CASE WHEN token_count > 0 THEN token_count
           ELSE CAST(LENGTH(content) / 4 AS INTEGER) END), 0) AS tokens
       FROM brain_episodic WHERE session_id = ?`,
      [sessionId],
    );
    return (row as any)?.tokens ?? 0;
  }

  static async getSemanticById(id: number): Promise<SemanticMemory | null> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT * FROM brain_semantic WHERE id = ?", [id]);
    return row ? BrainStore.rowToSemantic(row) : null;
  }

  /**
   * REL-12: increment retrieval_count only for memories that were actually
   * used (fusion hits that passed the gate and θ, or LIKE items assembled
   * into context). Candidate lists must not call this.
   */
  static async touchSemanticRetrieval(ids: number[]): Promise<void> {
    const unique = [
      ...new Set(
        ids.map((id) => Math.trunc(Number(id))).filter((id) => id > 0),
      ),
    ];
    if (unique.length === 0) return;
    const db = await BrainStore.get();
    const placeholders = unique.map(() => "?").join(",");
    await db.run(
      `UPDATE brain_semantic
       SET retrieval_count = retrieval_count + 1,
           last_accessed_at = datetime('now')
       WHERE id IN (${placeholders})`,
      unique,
    );
  }

  static async isPinned(memoryId: number): Promise<boolean> {
    const db = await BrainStore.get();
    const row = await db.get(
      `SELECT 1 FROM brain_tags
       WHERE memory_type = 'semantic' AND memory_id = ? AND tag = 'pinned'
       LIMIT 1`,
      [memoryId],
    );
    return !!row;
  }

  static async storeSemantic(input: StoreInput): Promise<number> {
    const db = await BrainStore.get();

    // Security scanning on all memory writes (P1.1)
    const cleanedTitle = InputSanitizer.enforce(input.title, "semantic.title");
    const cleanedContent = InputSanitizer.enforce(input.content, "semantic.content");

    const expiresAt = input.ttl_days
      ? new Date(Date.now() + input.ttl_days * 86400000).toISOString()
      : null;

    const valence = input.emotional_valence ?? BrainStore.detectEmotionalValence(cleanedContent, "assistant");
    const sal = input.salience ?? BrainStore.computeSalience(cleanedContent, "assistant", input.importance ?? 0.5);

    let topicId = input.topic_id ?? null;
    if (topicId == null && input.session_id) {
      const existing = await BrainStore.getLatestSessionTopic(input.session_id);
      topicId = existing?.id ?? null;
    }

    let taskId = input.task_id ?? null;
    if (taskId == null && input.session_id) {
      const open = await BrainStore.getOpenTask(input.session_id);
      taskId = open?.id ?? null;
    }

    const result = await db.run(
      `INSERT INTO brain_semantic (category, title, content, source_session_id, keywords, importance_score, emotional_valence, salience, expires_at, topic_id, task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.category,
        cleanedTitle,
        cleanedContent,
        input.session_id ?? null,
        input.keywords ?? "",
        input.importance ?? 0.5,
        valence,
        sal,
        expiresAt,
        topicId,
        taskId,
      ],
    );

    return result.lastID!;
  }

  /**
   * REL-08: insert or boost a near-duplicate. Auto-extract and BrainManager.store
   * share this so heuristic dumps do not create a second row.
   */
  static readonly DEDUP_SIMILARITY = 0.7;

  static async storeSemanticDeduped(
    input: StoreInput,
  ): Promise<{ id: number; deduplicated: boolean }> {
    const duplicates = await BrainStore.findDuplicates(
      input.title,
      input.keywords ?? "",
      input.category,
    );
    if (duplicates.length > 0 && duplicates[0].similarity >= BrainStore.DEDUP_SIMILARITY) {
      await BrainStore.boostDuplicate(duplicates[0].id, input.content);
      return { id: duplicates[0].id, deduplicated: true };
    }
    const id = await BrainStore.storeSemantic(input);
    return { id, deduplicated: false };
  }

  static async searchSemantic(query: string, category?: SemanticCategory, limit: number = 10): Promise<SemanticMemory[]> {
    const db = await BrainStore.get();

    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

    const conditions: string[] = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
    const params: any[] = [];

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    if (terms.length > 0) {
      const termConditions = terms.map(() =>
        "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)",
      );
      conditions.push(`(${termConditions.join(" OR ")})`);
      for (const term of terms) {
        const like = `%${term}%`;
        params.push(like, like, like);
      }
    }

    // Fetch more candidates for re-ranking
    const fetchLimit = Math.max(limit * 3, 30);
    params.push(fetchLimit);

    const sql = `
      SELECT * FROM brain_semantic
      WHERE ${conditions.join(" AND ")}
      ORDER BY importance_score DESC, retrieval_count DESC, last_accessed_at DESC
      LIMIT ?
    `;

    const rows = await db.all(sql, params);

    // BM25-inspired re-ranking
    if (terms.length > 0 && rows.length > 1) {
      const totalDocs = rows.length;
      const avgDocLen = rows.reduce((sum: number, r: any) =>
        sum + (r.title.length + r.content.length + r.keywords.length), 0) / totalDocs;
      const k1 = 1.5;
      const b = 0.75;

      // Compute IDF for each term
      const idf = new Map<string, number>();
      for (const term of terms) {
        let docsWithTerm = 0;
        for (const r of rows) {
          const doc = `${(r as any).title} ${(r as any).content} ${(r as any).keywords}`.toLowerCase();
          if (doc.includes(term)) docsWithTerm++;
        }
        const idfScore = Math.log((totalDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
        idf.set(term, Math.max(idfScore, 0));
      }

      // Prefetch pinned IDs among candidates for ranking boost
      const candidateIds = rows.map((r: any) => r.id as number);
      const pinnedIdSet = new Set<number>();
      if (candidateIds.length > 0) {
        const placeholders = candidateIds.map(() => "?").join(",");
        const pinnedRows = await db.all(
          `SELECT memory_id FROM brain_tags
           WHERE memory_type = 'semantic' AND tag = 'pinned'
           AND memory_id IN (${placeholders})`,
          candidateIds,
        );
        for (const pr of pinnedRows) {
          pinnedIdSet.add((pr as any).memory_id);
        }
      }

      // Score each row
      const scored = rows.map((r: any) => {
        const doc = `${r.title} ${r.content} ${r.keywords}`.toLowerCase();
        const docLen = doc.length;
        let bm25Score = 0;

        for (const term of terms) {
          // Count term frequency
          let tf = 0;
          let pos = 0;
          while ((pos = doc.indexOf(term, pos)) !== -1) {
            tf++;
            pos += term.length;
          }
          // Title matches count 3x
          const titleDoc = r.title.toLowerCase();
          let titleTf = 0;
          pos = 0;
          while ((pos = titleDoc.indexOf(term, pos)) !== -1) {
            titleTf++;
            pos += term.length;
          }
          tf += titleTf * 2; // Boost title matches

          const termIdf = idf.get(term) ?? 0;
          const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
          bm25Score += termIdf * tfNorm;
        }

        // Blend BM25 with importance and recency; pinned memories win ties.
        const importanceBoost = r.importance_score * 0.3;
        const retrievalBoost = Math.min(r.retrieval_count * 0.02, 0.2);
        const pinnedBoost = pinnedIdSet.has(r.id) ? 2.0 : 0;
        const finalScore = bm25Score + importanceBoost + retrievalBoost + pinnedBoost;

        return { row: r, score: finalScore };
      });

      scored.sort((a, b) => b.score - a.score);
      const topRows = scored.slice(0, limit).map((s) => s.row);
      // REL-12: LIKE is a candidate hunt — do not bump retrieval_count here.
      return topRows.map(BrainStore.rowToSemantic);
    }

    // No terms or single result — just return as-is
    const topRows = rows.slice(0, limit);
    return topRows.map(BrainStore.rowToSemantic);
  }

  static async searchEpisodic(query: string, sessionId?: string, limit: number = 20): Promise<EpisodicMemory[]> {
    const db = await BrainStore.get();

    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    const conditions: string[] = [];
    const params: any[] = [];

    if (sessionId) {
      conditions.push("session_id = ?");
      params.push(sessionId);
    }

    if (terms.length > 0) {
      const termConditions = terms.map(() => "LOWER(content) LIKE ?");
      conditions.push(`(${termConditions.join(" OR ")})`);
      for (const term of terms) {
        params.push(`%${term}%`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const fetchLimit = Math.max(limit * 3, 30);
    params.push(fetchLimit);

    const rows = await db.all(
      `SELECT * FROM brain_episodic ${whereClause}
       ORDER BY importance_score DESC, created_at DESC LIMIT ?`,
      params,
    );

    // BM25-inspired re-ranking for episodic results
    if (terms.length > 0 && rows.length > 1) {
      const totalDocs = rows.length;
      const avgDocLen = rows.reduce((sum: number, r: any) => sum + r.content.length, 0) / totalDocs;
      const k1 = 1.5;
      const b = 0.75;

      const idf = new Map<string, number>();
      for (const term of terms) {
        let docsWithTerm = 0;
        for (const r of rows) {
          if ((r as any).content.toLowerCase().includes(term)) docsWithTerm++;
        }
        idf.set(term, Math.max(Math.log((totalDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1), 0));
      }

      const scored = rows.map((r: any) => {
        const doc = r.content.toLowerCase();
        const docLen = doc.length;
        let bm25Score = 0;

        for (const term of terms) {
          let tf = 0;
          let pos = 0;
          while ((pos = doc.indexOf(term, pos)) !== -1) { tf++; pos += term.length; }

          const termIdf = idf.get(term) ?? 0;
          const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
          bm25Score += termIdf * tfNorm;
        }

        const importanceBoost = r.importance_score * 0.2;
        return { row: r, score: bm25Score + importanceBoost };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => BrainStore.rowToEpisodic(s.row));
    }

    return rows.slice(0, limit).map(BrainStore.rowToEpisodic);
  }

  static async deleteSemantic(id: number): Promise<boolean> {
    const db = await BrainStore.get();
    const result = await db.run("DELETE FROM brain_semantic WHERE id = ?", [id]);
    // Also remove associations and tags so bulk/single delete stay consistent
    await db.run(
      "DELETE FROM brain_associations WHERE (source_type = 'semantic' AND source_id = ?) OR (target_type = 'semantic' AND target_id = ?)",
      [id, id],
    );
    await db.run(
      "DELETE FROM brain_tags WHERE memory_type = 'semantic' AND memory_id = ?",
      [id],
    );
    return (result.changes ?? 0) > 0;
  }

  /**
   * REL-14: demote a semantic memory without deleting it.
   * Increments mismatch_count, tags `mismatch`, and sets an expiry window.
   */
  static async recordMismatch(
    id: number,
    topicId: number | null = null,
    ttlDays = 7,
  ): Promise<boolean> {
    const mem = await BrainStore.getSemanticById(id);
    if (!mem) return false;
    const db = await BrainStore.get();
    const until = new Date(Date.now() + ttlDays * 86400000).toISOString();
    const result = await db.run(
      `UPDATE brain_semantic
       SET mismatch_count = COALESCE(mismatch_count, 0) + 1,
           mismatch_until = ?,
           mismatch_topic_id = ?
       WHERE id = ?`,
      [until, topicId, id],
    );
    await BrainStore.addTag("semantic", id, "mismatch");
    return (result.changes ?? 0) > 0;
  }

  // ── Association Operations ─────────────────────────────────────────────────

  static async createAssociation(input: AssociateInput): Promise<number> {
    const db = await BrainStore.get();
    const result = await db.run(
      `INSERT INTO brain_associations (source_type, source_id, target_type, target_id, relationship, strength)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.source_type, input.source_id, input.target_type, input.target_id, input.relationship, input.strength ?? 0.5],
    );
    return result.lastID!;
  }

  static async getAssociations(type: "episodic" | "semantic", id: number): Promise<MemoryAssociation[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT * FROM brain_associations
       WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)
       ORDER BY strength DESC`,
      [type, id, type, id],
    );
    return rows.map(BrainStore.rowToAssociation);
  }

  // ── Consolidation (Knox-MS Memory Tiering Pattern) ─────────────────────────

  /**
   * Consolidate memories using Ebbinghaus-inspired decay.
   * - Hot memories older than 24h with low importance → warm
   * - Warm memories older than 7 days with low importance → cold
   * - Cold memories older than 90 days with no retrievals → pruned
   * - Expired semantic memories → pruned
   */
  static async consolidate(): Promise<ConsolidationResult> {
    const db = await BrainStore.get();
    const result: ConsolidationResult = { promoted: 0, demoted: 0, pruned: 0, summaries_created: 0 };

    // Hot → Warm (episodic older than 24h, importance < 0.7)
    const hotToWarm = await db.run(
      `UPDATE brain_episodic SET tier = 'warm'
       WHERE tier = 'hot' AND importance_score < 0.7
       AND created_at < datetime('now', '-1 day')`,
    );
    result.demoted += hotToWarm.changes ?? 0;

    // Warm → Cold (episodic older than 7 days, importance < 0.5)
    const warmToCold = await db.run(
      `UPDATE brain_episodic SET tier = 'cold'
       WHERE tier = 'warm' AND importance_score < 0.5
       AND created_at < datetime('now', '-7 days')`,
    );
    result.demoted += warmToCold.changes ?? 0;

    // Prune cold episodic older than 90 days with very low importance
    const prunedEpisodic = await db.run(
      `DELETE FROM brain_episodic
       WHERE tier = 'cold' AND importance_score < 0.3
       AND created_at < datetime('now', '-90 days')`,
    );
    result.pruned += prunedEpisodic.changes ?? 0;

    // Hot → Warm (semantic older than 7 days, importance < 0.6, no recent access)
    // Pinned memories are exempt from demotion/pruning.
    const notPinned = `id NOT IN (SELECT memory_id FROM brain_tags WHERE memory_type = 'semantic' AND tag = 'pinned')`;
    const semHotToWarm = await db.run(
      `UPDATE brain_semantic SET tier = 'warm'
       WHERE tier = 'hot' AND importance_score < 0.6
       AND last_accessed_at < datetime('now', '-7 days')
       AND ${notPinned}`,
    );
    result.demoted += semHotToWarm.changes ?? 0;

    // Warm → Cold (semantic older than 30 days, low retrieval count)
    const semWarmToCold = await db.run(
      `UPDATE brain_semantic SET tier = 'cold'
       WHERE tier = 'warm' AND retrieval_count < 3
       AND last_accessed_at < datetime('now', '-30 days')
       AND ${notPinned}`,
    );
    result.demoted += semWarmToCold.changes ?? 0;

    // Prune expired semantic memories (never prune pinned)
    const prunedSemantic = await db.run(
      `DELETE FROM brain_semantic
       WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
       AND ${notPinned}`,
    );
    result.pruned += prunedSemantic.changes ?? 0;

    // Promote frequently accessed memories (cold/warm → hot)
    const promoted = await db.run(
      `UPDATE brain_semantic SET tier = 'hot'
       WHERE tier IN ('warm', 'cold') AND retrieval_count >= 5
       AND last_accessed_at > datetime('now', '-3 days')`,
    );
    result.promoted += promoted.changes ?? 0;

    // Compress cold-tier content to save space
    await BrainStore.compressColdTier().catch(() => {});

    // Decompress promoted memories (cold → hot)
    if ((promoted.changes ?? 0) > 0) {
      const hotRows = await db.all(
        `SELECT id, content FROM brain_semantic WHERE tier = 'hot' AND content LIKE 'z:%'`,
      );
      for (const r of hotRows) {
        const decompressed = BrainStore.decompressContent((r as any).content);
        if (decompressed !== (r as any).content) {
          await db.run("UPDATE brain_semantic SET content = ? WHERE id = ?", [decompressed, (r as any).id]);
        }
      }
    }

    return result;
  }

  // ── Statistics ─────────────────────────────────────────────────────────────

  static async getStats(): Promise<BrainStats> {
    const db = await BrainStore.get();
    const dbPath = getMemoryBrainSqlitePath();

    const sessionCount = await db.get("SELECT COUNT(*) as c FROM brain_sessions");
    const episodicCount = await db.get("SELECT COUNT(*) as c FROM brain_episodic");
    const semanticCount = await db.get("SELECT COUNT(*) as c FROM brain_semantic");
    const assocCount = await db.get("SELECT COUNT(*) as c FROM brain_associations");
    const entityCount = await db.get("SELECT COUNT(*) as c FROM brain_entities");
    const edgeCount = await db.get("SELECT COUNT(*) as c FROM brain_graph_edges");
    const patternCount = await db.get("SELECT COUNT(*) as c FROM brain_learning_patterns");
    const procedureCount = await db.get("SELECT COUNT(*) as c FROM brain_procedures");
    const tagCount = await db.get("SELECT COUNT(*) as c FROM brain_tags");
    const collectionCount = await db.get("SELECT COUNT(*) as c FROM brain_collections");

    const tierCounts = await db.all(
      `SELECT tier, COUNT(*) as c FROM (
        SELECT tier FROM brain_episodic UNION ALL SELECT tier FROM brain_semantic
      ) GROUP BY tier`,
    );

    const categoryCounts = await db.all(
      "SELECT category, COUNT(*) as c FROM brain_semantic GROUP BY category",
    );

    const entityTypeCounts = await db.all(
      "SELECT entity_type, COUNT(*) as c FROM brain_entities GROUP BY entity_type",
    );

    const oldest = await db.get(
      `SELECT MIN(created_at) as m FROM (
        SELECT created_at FROM brain_episodic UNION ALL SELECT created_at FROM brain_semantic
      )`,
    );
    const newest = await db.get(
      `SELECT MAX(created_at) as m FROM (
        SELECT created_at FROM brain_episodic UNION ALL SELECT created_at FROM brain_semantic
      )`,
    );

    let dbSizeBytes = 0;
    try {
      const stat = fs.statSync(dbPath);
      dbSizeBytes = stat.size;
    } catch {}

    const tierMap: Record<string, number> = { hot: 0, warm: 0, cold: 0 };
    for (const row of tierCounts) {
      tierMap[(row as any).tier] = (row as any).c;
    }

    const catMap: Record<string, number> = {};
    for (const row of categoryCounts) {
      catMap[(row as any).category] = (row as any).c;
    }

    const entityTypeMap: Record<string, number> = {};
    for (const row of entityTypeCounts) {
      entityTypeMap[(row as any).entity_type] = (row as any).c;
    }

    return {
      total_sessions: (sessionCount as any)?.c ?? 0,
      total_episodic: (episodicCount as any)?.c ?? 0,
      total_semantic: (semanticCount as any)?.c ?? 0,
      total_associations: (assocCount as any)?.c ?? 0,
      total_entities: (entityCount as any)?.c ?? 0,
      total_edges: (edgeCount as any)?.c ?? 0,
      total_patterns: (patternCount as any)?.c ?? 0,
      total_procedures: (procedureCount as any)?.c ?? 0,
      total_tags: (tagCount as any)?.c ?? 0,
      total_collections: (collectionCount as any)?.c ?? 0,
      tier_counts: tierMap as any,
      category_counts: catMap,
      entity_type_counts: entityTypeMap,
      oldest_memory: (oldest as any)?.m ?? null,
      newest_memory: (newest as any)?.m ?? null,
      db_size_bytes: dbSizeBytes,
    };
  }

  // ── Knowledge Graph: Entity Operations ─────────────────────────────────────

  static async addEntity(input: {
    name: string;
    entity_type: EntityType;
    description: string;
    properties: Record<string, any>;
    confidence: number;
  }): Promise<number> {
    const db = await BrainStore.get();
    const result = await db.run(
      `INSERT INTO brain_entities (name, entity_type, description, properties, confidence)
       VALUES (?, ?, ?, ?, ?)`,
      [input.name, input.entity_type, input.description, JSON.stringify(input.properties), input.confidence],
    );
    return result.lastID!;
  }

  static async countEntities(): Promise<number> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT COUNT(*) as c FROM brain_entities") as any;
    return row?.c ?? 0;
  }

  /**
   * Remove lowest-value entities (low mention_count, oldest updated_at).
   */
  static async pruneEntities(count: number): Promise<number> {
    if (count <= 0) return 0;
    const db = await BrainStore.get();
    const victims = await db.all(
      `SELECT id FROM brain_entities
       ORDER BY mention_count ASC, updated_at ASC
       LIMIT ?`,
      [count],
    );
    let pruned = 0;
    for (const row of victims) {
      const id = (row as any).id;
      await db.run("DELETE FROM brain_graph_edges WHERE source_entity_id = ? OR target_entity_id = ?", [id, id]);
      const result = await db.run("DELETE FROM brain_entities WHERE id = ?", [id]);
      pruned += result.changes ?? 0;
    }
    return pruned;
  }

  static async getEntity(id: number): Promise<GraphEntity | null> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT * FROM brain_entities WHERE id = ?", [id]);
    return row ? BrainStore.rowToEntity(row) : null;
  }

  static async findEntity(normalizedName: string, entityType: EntityType): Promise<GraphEntity | null> {
    const db = await BrainStore.get();
    const row = await db.get(
      "SELECT * FROM brain_entities WHERE LOWER(name) = ? AND entity_type = ?",
      [normalizedName, entityType],
    );
    return row ? BrainStore.rowToEntity(row) : null;
  }

  static async incrementEntityMention(id: number): Promise<void> {
    await BrainStore.touchEntity(id, { incrementMention: true });
  }

  /** LRU refresh — bump updated_at (and optionally mention_count). IMP-11 */
  static async touchEntity(
    id: number,
    options?: { incrementMention?: boolean },
  ): Promise<void> {
    const db = await BrainStore.get();
    if (options?.incrementMention) {
      await db.run(
        "UPDATE brain_entities SET mention_count = mention_count + 1, updated_at = datetime('now') WHERE id = ?",
        [id],
      );
    } else {
      await db.run(
        "UPDATE brain_entities SET updated_at = datetime('now') WHERE id = ?",
        [id],
      );
    }
  }

  static async updateEntity(id: number, updates: Partial<Pick<GraphEntity, "description" | "properties" | "confidence">>): Promise<void> {
    const db = await BrainStore.get();
    const sets: string[] = ["updated_at = datetime('now')"];
    const params: any[] = [];

    if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
    if (updates.properties !== undefined) { sets.push("properties = ?"); params.push(typeof updates.properties === "string" ? updates.properties : JSON.stringify(updates.properties)); }
    if (updates.confidence !== undefined) { sets.push("confidence = ?"); params.push(updates.confidence); }

    params.push(id);
    await db.run(`UPDATE brain_entities SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  static async searchEntities(query: string, entityType?: EntityType, limit: number = 20): Promise<GraphEntity[]> {
    const db = await BrainStore.get();
    const trimmed = (query ?? "").trim();
    const terms = trimmed ? entitySearchTerms(trimmed) : [];
    const conditions: string[] = [];
    const params: any[] = [];

    if (entityType) {
      conditions.push("entity_type = ?");
      params.push(entityType);
    }

    // Non-empty query with no entity-like terms must not fall through to "list all".
    if (trimmed && terms.length === 0) {
      return [];
    }

    if (terms.length > 0) {
      const termConditions: string[] = [];
      for (const term of terms) {
        if (requiresBoundedEntityMatch(term)) {
          termConditions.push("LOWER(name) = ?");
          params.push(term.toLowerCase());
        } else {
          termConditions.push("(LOWER(name) LIKE ? OR LOWER(description) LIKE ?)");
          const like = `%${term.toLowerCase()}%`;
          params.push(like, like);
        }
      }
      conditions.push(`(${termConditions.join(" OR ")})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const rows = await db.all(
      `SELECT * FROM brain_entities ${whereClause} ORDER BY mention_count DESC, confidence DESC LIMIT ?`,
      params,
    );
    return rows.map(BrainStore.rowToEntity);
  }

  static async deleteEntity(id: number): Promise<boolean> {
    const db = await BrainStore.get();
    // Also delete connected edges
    await db.run("DELETE FROM brain_graph_edges WHERE source_entity_id = ? OR target_entity_id = ?", [id, id]);
    const result = await db.run("DELETE FROM brain_entities WHERE id = ?", [id]);
    return (result.changes ?? 0) > 0;
  }

  // ── Knowledge Graph: Edge Operations ───────────────────────────────────────

  static async addEdge(input: AddEdgeInput): Promise<number> {
    const db = await BrainStore.get();
    const result = await db.run(
      `INSERT INTO brain_graph_edges (source_entity_id, target_entity_id, relationship, weight, properties)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.source_entity_id,
        input.target_entity_id,
        input.relationship,
        input.weight ?? 0.5,
        JSON.stringify(input.properties ?? {}),
      ],
    );
    return result.lastID!;
  }

  static async findEdge(sourceId: number, targetId: number, relationship: string): Promise<GraphEdge | null> {
    const db = await BrainStore.get();
    const row = await db.get(
      `SELECT * FROM brain_graph_edges
       WHERE ((source_entity_id = ? AND target_entity_id = ?) OR (source_entity_id = ? AND target_entity_id = ?))
       AND relationship = ?`,
      [sourceId, targetId, targetId, sourceId, relationship],
    );
    return row ? BrainStore.rowToEdge(row) : null;
  }

  static async updateEdgeWeight(id: number, weight: number): Promise<void> {
    const db = await BrainStore.get();
    await db.run("UPDATE brain_graph_edges SET weight = ? WHERE id = ?", [weight, id]);
  }

  static async getEntityEdges(entityId: number): Promise<GraphEdge[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT * FROM brain_graph_edges
       WHERE source_entity_id = ? OR target_entity_id = ?
       ORDER BY weight DESC`,
      [entityId, entityId],
    );
    return rows.map(BrainStore.rowToEdge);
  }

  static async getGraphStats(): Promise<{ entities: number; edges: number; entityTypes: Record<string, number> }> {
    const db = await BrainStore.get();
    const entityCount = await db.get("SELECT COUNT(*) as c FROM brain_entities");
    const edgeCount = await db.get("SELECT COUNT(*) as c FROM brain_graph_edges");
    const typeCounts = await db.all("SELECT entity_type, COUNT(*) as c FROM brain_entities GROUP BY entity_type");

    const typeMap: Record<string, number> = {};
    for (const row of typeCounts) {
      typeMap[(row as any).entity_type] = (row as any).c;
    }

    return {
      entities: (entityCount as any)?.c ?? 0,
      edges: (edgeCount as any)?.c ?? 0,
      entityTypes: typeMap,
    };
  }

  // ── Learning Pattern Operations ────────────────────────────────────────────

  static async addPattern(input: {
    goal_type: GoalType;
    pattern_signature: string;
    description: string;
    success: boolean;
    tokens_used: number;
    metadata: Record<string, any>;
  }): Promise<number> {
    const db = await BrainStore.get();
    const result = await db.run(
      `INSERT INTO brain_learning_patterns (goal_type, pattern_signature, description, success_count, failure_count, confidence, avg_tokens_used, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.goal_type,
        input.pattern_signature,
        input.description,
        input.success ? 1 : 0,
        input.success ? 0 : 1,
        input.success ? 0.6 : 0.3,
        input.tokens_used,
        JSON.stringify(input.metadata),
      ],
    );
    return result.lastID!;
  }

  static async findPattern(goalType: GoalType, signature: string): Promise<LearningPattern | null> {
    const db = await BrainStore.get();
    const row = await db.get(
      "SELECT * FROM brain_learning_patterns WHERE goal_type = ? AND pattern_signature = ?",
      [goalType, signature],
    );
    return row ? BrainStore.rowToPattern(row) : null;
  }

  static async updatePatternStats(id: number, success: boolean, tokensUsed: number): Promise<void> {
    const db = await BrainStore.get();
    if (success) {
      await db.run(
        `UPDATE brain_learning_patterns SET
           success_count = success_count + 1,
           confidence = MIN(1.0, confidence + 0.05),
           avg_tokens_used = (avg_tokens_used * (success_count + failure_count) + ?) / (success_count + failure_count + 1),
           last_used_at = datetime('now')
         WHERE id = ?`,
        [tokensUsed, id],
      );
    } else {
      await db.run(
        `UPDATE brain_learning_patterns SET
           failure_count = failure_count + 1,
           confidence = MAX(0.0, confidence - 0.1),
           last_used_at = datetime('now')
         WHERE id = ?`,
        [id],
      );
    }
  }

  static async getPatterns(goalType?: GoalType, limit: number = 20): Promise<LearningPattern[]> {
    const db = await BrainStore.get();
    const conditions: string[] = [];
    const params: any[] = [];

    if (goalType) {
      conditions.push("goal_type = ?");
      params.push(goalType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const rows = await db.all(
      `SELECT * FROM brain_learning_patterns ${whereClause} ORDER BY confidence DESC, success_count DESC LIMIT ?`,
      params,
    );
    return rows.map(BrainStore.rowToPattern);
  }

  // ── Procedural Memory Operations ───────────────────────────────────────────

  static async addProcedure(input: {
    name: string;
    description: string;
    steps: string[];
    trigger_pattern: string;
    category: string;
  }): Promise<number> {
    const db = await BrainStore.get();
    const result = await db.run(
      `INSERT INTO brain_procedures (name, description, steps, trigger_pattern, category)
       VALUES (?, ?, ?, ?, ?)`,
      [input.name, input.description, JSON.stringify(input.steps), input.trigger_pattern, input.category],
    );
    return result.lastID!;
  }

  static async getProcedure(id: number): Promise<ProceduralMemory | null> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT * FROM brain_procedures WHERE id = ?", [id]);
    return row ? BrainStore.rowToProcedure(row) : null;
  }

  static async searchProcedures(query: string, limit: number = 10): Promise<ProceduralMemory[]> {
    const db = await BrainStore.get();
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    const conditions: string[] = [];
    const params: any[] = [];

    if (terms.length > 0) {
      const termConditions = terms.map(() => "(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(trigger_pattern) LIKE ?)");
      conditions.push(`(${termConditions.join(" OR ")})`);
      for (const term of terms) {
        const like = `%${term}%`;
        params.push(like, like, like);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const rows = await db.all(
      `SELECT * FROM brain_procedures ${whereClause} ORDER BY execution_count DESC, success_rate DESC LIMIT ?`,
      params,
    );
    return rows.map(BrainStore.rowToProcedure);
  }

  static async getAllProcedures(category?: string, limit: number = 50): Promise<ProceduralMemory[]> {
    const db = await BrainStore.get();
    const conditions: string[] = [];
    const params: any[] = [];

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const rows = await db.all(
      `SELECT * FROM brain_procedures ${whereClause} ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    return rows.map(BrainStore.rowToProcedure);
  }

  static async recordProcedureExecution(id: number, success: boolean): Promise<void> {
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_procedures SET
         execution_count = execution_count + 1,
         success_rate = (success_rate * execution_count + ?) / (execution_count + 1),
         last_executed_at = datetime('now')
       WHERE id = ?`,
      [success ? 1.0 : 0.0, id],
    );
  }

  // ── Tag Operations ─────────────────────────────────────────────────────────

  static async addTag(memoryType: string, memoryId: number, tag: string): Promise<number> {
    const db = await BrainStore.get();
    const result = await db.run(
      `INSERT OR IGNORE INTO brain_tags (memory_type, memory_id, tag) VALUES (?, ?, ?)`,
      [memoryType, memoryId, tag.toLowerCase().trim()],
    );
    return result.lastID!;
  }

  static async removeTag(memoryType: string, memoryId: number, tag: string): Promise<boolean> {
    const db = await BrainStore.get();
    const result = await db.run(
      "DELETE FROM brain_tags WHERE memory_type = ? AND memory_id = ? AND tag = ?",
      [memoryType, memoryId, tag.toLowerCase().trim()],
    );
    return (result.changes ?? 0) > 0;
  }

  static async getTagsForMemory(memoryType: string, memoryId: number): Promise<MemoryTag[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      "SELECT * FROM brain_tags WHERE memory_type = ? AND memory_id = ?",
      [memoryType, memoryId],
    );
    return rows.map(BrainStore.rowToTag);
  }

  static async searchByTag(tag: string, memoryType?: string, limit: number = 50): Promise<MemoryTag[]> {
    const db = await BrainStore.get();
    const conditions = ["tag = ?"];
    const params: any[] = [tag.toLowerCase().trim()];

    if (memoryType) {
      conditions.push("memory_type = ?");
      params.push(memoryType);
    }

    params.push(limit);

    const rows = await db.all(
      `SELECT * FROM brain_tags WHERE ${conditions.join(" AND ")} LIMIT ?`,
      params,
    );
    return rows.map(BrainStore.rowToTag);
  }

  // ── Collection Operations ──────────────────────────────────────────────────

  static async createCollection(name: string, description: string = ""): Promise<number> {
    const db = await BrainStore.get();
    const result = await db.run(
      "INSERT INTO brain_collections (name, description) VALUES (?, ?)",
      [name, description],
    );
    return result.lastID!;
  }

  static async listCollections(limit: number = 50): Promise<MemoryCollection[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT c.*, COUNT(ci.id) as item_count
       FROM brain_collections c
       LEFT JOIN brain_collection_items ci ON c.id = ci.collection_id
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map(BrainStore.rowToCollection);
  }

  static async addToCollection(collectionId: number, memoryType: string, memoryId: number): Promise<number> {
    const db = await BrainStore.get();
    const result = await db.run(
      `INSERT OR IGNORE INTO brain_collection_items (collection_id, memory_type, memory_id) VALUES (?, ?, ?)`,
      [collectionId, memoryType, memoryId],
    );
    await db.run("UPDATE brain_collections SET updated_at = datetime('now') WHERE id = ?", [collectionId]);
    return result.lastID!;
  }

  static async getCollectionItems(collectionId: number): Promise<CollectionItem[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      "SELECT * FROM brain_collection_items WHERE collection_id = ? ORDER BY added_at DESC",
      [collectionId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      collection_id: r.collection_id,
      memory_type: r.memory_type,
      memory_id: r.memory_id,
      added_at: r.added_at,
    }));
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  static getConfig(): MemoryConfig {
    return { ...BrainStore.config };
  }

  /** Reset in-memory config to defaults, then overlay brain_config rows. */
  static async reloadConfig(): Promise<void> {
    await BrainStore.loadConfig();
  }

  private static getDefaultConfig(): MemoryConfig {
    if (!BrainStore.defaultConfigSnapshot) {
      BrainStore.defaultConfigSnapshot = { ...BrainStore.config };
    }
    return { ...BrainStore.defaultConfigSnapshot };
  }

  static async saveConfig(key: string, value: string): Promise<void> {
    const db = await BrainStore.get();
    await db.run(
      `INSERT INTO brain_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
      [key, value, value],
    );

    // Update in-memory config
    if (key in BrainStore.config) {
      const cfg = BrainStore.config as any;
      if (typeof cfg[key] === "boolean") {
        cfg[key] = value === "true";
      } else if (typeof cfg[key] === "number") {
        cfg[key] = Number(value);
      } else {
        cfg[key] = value;
      }
    }
  }

  private static async loadConfig(): Promise<void> {
    BrainStore.config = BrainStore.getDefaultConfig();
    try {
      const db = BrainStore.db!;
      const rows = await db.all("SELECT key, value FROM brain_config");
      for (const row of rows) {
        const key = (row as any).key;
        const value = (row as any).value;
        if (key in BrainStore.config) {
          const cfg = BrainStore.config as any;
          if (typeof cfg[key] === "boolean") {
            cfg[key] = value === "true";
          } else if (typeof cfg[key] === "number") {
            cfg[key] = Number(value);
          } else {
            cfg[key] = value;
          }
        }
      }
    } catch {
      // Config table might not exist yet on first run
    }
  }

  // ── Health & Optimization ──────────────────────────────────────────────────

  static async getHealth(): Promise<HealthStatus> {
    const db = await BrainStore.get();
    const dbPath = getMemoryBrainSqlitePath();

    let dbSizeBytes = 0;
    try {
      const stat = fs.statSync(dbPath);
      dbSizeBytes = stat.size;
    } catch {}

    const totalMemories = await db.get(
      `SELECT COUNT(*) as c FROM (
        SELECT id FROM brain_episodic UNION ALL SELECT id FROM brain_semantic
      )`,
    );
    const total = (totalMemories as any)?.c ?? 0;

    // Check fragmentation (ratio of free pages)
    const pageCount = await db.get("PRAGMA page_count");
    const freePageCount = await db.get("PRAGMA freelist_count");
    const fragRatio = (pageCount as any)?.page_count > 0
      ? ((freePageCount as any)?.freelist_count ?? 0) / (pageCount as any).page_count
      : 0;

    // Check oldest unaccessed semantic memory
    const oldestUnaccessed = await db.get(
      `SELECT MIN(last_accessed_at) as m FROM brain_semantic WHERE tier != 'cold'`,
    );
    const oldestDate = (oldestUnaccessed as any)?.m;
    const oldestDays = oldestDate
      ? (Date.now() - new Date(oldestDate).getTime()) / 86400000
      : 0;

    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for issues
    if (dbSizeBytes > 100 * 1024 * 1024) {
      issues.push("Database exceeds 100MB");
      recommendations.push("Run 'consolidate' to prune old memories and 'optimize' to compact the database");
    }

    if (fragRatio > 0.2) {
      issues.push(`Database fragmentation is ${(fragRatio * 100).toFixed(1)}%`);
      recommendations.push("Run 'optimize' to vacuum the database");
    }

    const hotCount = await db.get(
      `SELECT COUNT(*) as c FROM (
        SELECT id FROM brain_episodic WHERE tier = 'hot' UNION ALL SELECT id FROM brain_semantic WHERE tier = 'hot'
      )`,
    );
    if ((hotCount as any)?.c > BrainStore.config.max_hot_memories) {
      issues.push(`Too many hot memories (${(hotCount as any).c}/${BrainStore.config.max_hot_memories})`);
      recommendations.push("Run 'consolidate' to tier down old hot memories");
    }

    if (oldestDays > 30) {
      issues.push(`Some memories haven't been accessed in ${oldestDays.toFixed(0)} days`);
      recommendations.push("Run 'consolidate' to review and tier down unused memories");
    }

    let status: "healthy" | "degraded" | "critical" = "healthy";
    if (issues.length >= 3) status = "critical";
    else if (issues.length >= 1) status = "degraded";

    return {
      status,
      db_size_bytes: dbSizeBytes,
      total_memories: total,
      fragmentation_ratio: fragRatio,
      oldest_unaccessed_days: oldestDays,
      issues,
      recommendations,
    };
  }

  static async optimize(): Promise<string> {
    const db = await BrainStore.get();
    const results: string[] = [];

    // 1. Run VACUUM to compact database
    await db.exec("VACUUM");
    results.push("Database vacuumed (compacted)");

    // 2. Rebuild indexes
    await db.exec("REINDEX");
    results.push("Indexes rebuilt");

    // 3. Analyze for query optimizer
    await db.exec("ANALYZE");
    results.push("Query statistics updated");

    // 4. Integrity check
    const intResult = await db.get("PRAGMA integrity_check");
    const intStatus = (intResult as any)?.integrity_check ?? "unknown";
    results.push(`Integrity check: ${intStatus}`);

    return results.join("\n");
  }

  // ── Import/Export ──────────────────────────────────────────────────────────

  static async exportAll(): Promise<MemoryExport> {
    const db = await BrainStore.get();

    const sessions = (await db.all("SELECT * FROM brain_sessions")).map(BrainStore.rowToSession);
    const semantic = (await db.all("SELECT * FROM brain_semantic")).map(BrainStore.rowToSemantic);
    const episodic = (await db.all("SELECT * FROM brain_episodic")).map(BrainStore.rowToEpisodic);
    const associations = (await db.all("SELECT * FROM brain_associations")).map(BrainStore.rowToAssociation);
    const entities = (await db.all("SELECT * FROM brain_entities")).map(BrainStore.rowToEntity);
    const edges = (await db.all("SELECT * FROM brain_graph_edges")).map(BrainStore.rowToEdge);
    const patterns = (await db.all("SELECT * FROM brain_learning_patterns")).map(BrainStore.rowToPattern);
    const procedures = (await db.all("SELECT * FROM brain_procedures")).map(BrainStore.rowToProcedure);
    const tags = (await db.all("SELECT * FROM brain_tags")).map(BrainStore.rowToTag);
    const collections = (await db.all(
      `SELECT c.*, COUNT(ci.id) as item_count
       FROM brain_collections c
       LEFT JOIN brain_collection_items ci ON c.id = ci.collection_id
       GROUP BY c.id`,
    )).map(BrainStore.rowToCollection);
    const collectionItems = (await db.all("SELECT * FROM brain_collection_items")).map(BrainStore.rowToCollectionItem);
    const auditLog = (await db.all("SELECT * FROM brain_audit_log ORDER BY id ASC")).map(BrainStore.rowToAuditLogEntry);
    const sessionTopics = (await db.all("SELECT * FROM brain_session_topics ORDER BY id ASC")).map(BrainStore.rowToSessionTopic);
    const tasks = (await db.all("SELECT * FROM brain_tasks ORDER BY opened_at ASC")).map(BrainStore.rowToTask);
    const configRows = await db.all("SELECT key, value FROM brain_config");
    const config: Record<string, string> = {};
    for (const row of configRows) {
      config[(row as any).key] = (row as any).value;
    }

    return {
      version: "1.0.0",
      exported_at: new Date().toISOString(),
      sessions,
      semantic,
      episodic,
      associations,
      entities,
      edges,
      patterns,
      procedures,
      tags,
      collections,
      collection_items: collectionItems,
      audit_log: auditLog,
      session_topics: sessionTopics,
      tasks,
      config,
    };
  }

  static async importData(data: MemoryExport): Promise<{ imported: Record<string, number> }> {
    const db = await BrainStore.get();
    const imported: Record<string, number> = {};

    await db.exec("BEGIN TRANSACTION");
    try {
      let count = 0;
      for (const session of data.sessions ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_sessions (id, title, workspace_directory, project_id, created_at, updated_at, message_count, summary, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            session.id,
            session.title,
            session.workspace_directory,
            session.project_id ?? "",
            session.created_at,
            session.updated_at,
            session.message_count,
            session.summary,
            session.is_active ? 1 : 0,
          ],
        );
        count += result.changes ?? 0;
      }
      imported.sessions = count;

      count = 0;
      for (const mem of data.semantic ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_semantic (id, category, title, content, source_session_id, keywords, importance_score, emotional_valence, salience, retrieval_count, tier, created_at, last_accessed_at, expires_at, topic_id, task_id, mismatch_count, mismatch_until, mismatch_topic_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [mem.id, mem.category, mem.title, mem.content, mem.source_session_id, mem.keywords, mem.importance_score, mem.emotional_valence ?? "neutral", mem.salience ?? 0.5, mem.retrieval_count, mem.tier, mem.created_at, mem.last_accessed_at, mem.expires_at, mem.topic_id ?? null, mem.task_id ?? null, mem.mismatch_count ?? 0, mem.mismatch_until ?? null, mem.mismatch_topic_id ?? null],
        );
        count += result.changes ?? 0;
      }
      imported.semantic = count;

      count = 0;
      for (const mem of data.episodic ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_episodic (id, session_id, type, role, content, token_count, importance_score, emotional_valence, salience, tier, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [mem.id, mem.session_id, mem.type, mem.role, mem.content, mem.token_count, mem.importance_score, mem.emotional_valence ?? "neutral", mem.salience ?? 0.5, mem.tier, mem.metadata, mem.created_at],
        );
        count += result.changes ?? 0;
      }
      imported.episodic = count;

      count = 0;
      for (const assoc of data.associations ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_associations (id, source_type, source_id, target_type, target_id, relationship, strength, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [assoc.id, assoc.source_type, assoc.source_id, assoc.target_type, assoc.target_id, assoc.relationship, assoc.strength, assoc.created_at],
        );
        count += result.changes ?? 0;
      }
      imported.associations = count;

      count = 0;
      for (const entity of data.entities ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_entities (id, name, entity_type, description, properties, confidence, mention_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entity.id, entity.name, entity.entity_type, entity.description, entity.properties, entity.confidence, entity.mention_count, entity.created_at, entity.updated_at],
        );
        count += result.changes ?? 0;
      }
      imported.entities = count;

      count = 0;
      for (const edge of data.edges ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_graph_edges (id, source_entity_id, target_entity_id, relationship, weight, properties, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [edge.id, edge.source_entity_id, edge.target_entity_id, edge.relationship, edge.weight, edge.properties, edge.created_at],
        );
        count += result.changes ?? 0;
      }
      imported.edges = count;

      count = 0;
      for (const pattern of data.patterns ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_learning_patterns (id, goal_type, pattern_signature, description, success_count, failure_count, confidence, avg_tokens_used, last_used_at, created_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [pattern.id, pattern.goal_type, pattern.pattern_signature, pattern.description, pattern.success_count, pattern.failure_count, pattern.confidence, pattern.avg_tokens_used, pattern.last_used_at, pattern.created_at, pattern.metadata],
        );
        count += result.changes ?? 0;
      }
      imported.patterns = count;

      count = 0;
      for (const proc of data.procedures ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_procedures (id, name, description, steps, trigger_pattern, success_rate, execution_count, last_executed_at, created_at, category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [proc.id, proc.name, proc.description, proc.steps, proc.trigger_pattern, proc.success_rate, proc.execution_count, proc.last_executed_at, proc.created_at, proc.category],
        );
        count += result.changes ?? 0;
      }
      imported.procedures = count;

      count = 0;
      for (const tag of data.tags ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_tags (id, memory_type, memory_id, tag, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [tag.id, tag.memory_type, tag.memory_id, tag.tag, tag.created_at],
        );
        count += result.changes ?? 0;
      }
      imported.tags = count;

      count = 0;
      for (const collection of data.collections ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_collections (id, name, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [collection.id, collection.name, collection.description, collection.created_at, collection.updated_at],
        );
        count += result.changes ?? 0;
      }
      imported.collections = count;

      count = 0;
      for (const item of data.collection_items ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_collection_items (id, collection_id, memory_type, memory_id, added_at)
           VALUES (?, ?, ?, ?, ?)`,
          [item.id, item.collection_id, item.memory_type, item.memory_id, item.added_at],
        );
        count += result.changes ?? 0;
      }
      imported.collection_items = count;

      count = 0;
      for (const topic of data.session_topics ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_session_topics (id, session_id, topic, keywords, message_range_start, message_range_end, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [topic.id, topic.session_id, topic.topic, topic.keywords, topic.message_range_start, topic.message_range_end, topic.confidence, topic.created_at],
        );
        count += result.changes ?? 0;
      }
      imported.session_topics = count;

      count = 0;
      for (const task of data.tasks ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_tasks (id, session_id, topic_id, title, opened_at, closed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [task.id, task.session_id, task.topic_id ?? null, task.title, task.opened_at, task.closed_at ?? null],
        );
        count += result.changes ?? 0;
      }
      imported.tasks = count;

      count = 0;
      for (const entry of data.audit_log ?? []) {
        const result = await db.run(
          `INSERT OR IGNORE INTO brain_audit_log (id, action, target_type, target_id, details, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [entry.id, entry.action, entry.target_type, String(entry.target_id ?? ""), entry.details, entry.created_at],
        );
        count += result.changes ?? 0;
      }
      imported.audit_log = count;

      count = 0;
      for (const [key, value] of Object.entries(data.config ?? {})) {
        const result = await db.run(
          `INSERT OR REPLACE INTO brain_config (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
          [key, value],
        );
        count += result.changes ?? 0;
      }
      imported.config = count;

      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }

    await RetrievalFusion.rebuildFts5(db).catch(() => {});
    await BrainStore.loadConfig();

    return { imported };
  }

  // ── Cross-Session Backlog Search ───────────────────────────────────────────

  /**
   * Search across ALL sessions for matching episodic and semantic memories.
   * Supports date range, role filters, and session ID filters.
   */
  static async searchBacklogs(
    query: string,
    options: {
      limit?: number;
      session_ids?: string[];
      date_from?: string;
      date_to?: string;
      roles?: string[];
      include_semantic?: boolean;
      include_episodic?: boolean;
    } = {},
  ): Promise<BacklogSearchResult> {
    const db = await BrainStore.get();
    const limit = options.limit ?? 30;

    // Project scope with no sessions → no cross-project matches (IMP-25)
    if (options.session_ids !== undefined && options.session_ids.length === 0) {
      return {
        semantic: [],
        episodic: [],
        sessions_searched: 0,
        total_matches: 0,
      };
    }

    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

    let episodic: EpisodicMemory[] = [];
    let semantic: SemanticMemory[] = [];
    let sessionsSearched = 0;

    // Count sessions searched
    if (options.session_ids && options.session_ids.length > 0) {
      sessionsSearched = options.session_ids.length;
    } else {
      const countRow = await db.get("SELECT COUNT(DISTINCT id) as cnt FROM brain_sessions");
      sessionsSearched = (countRow as any)?.cnt ?? 0;
    }

    // Episodic search across all sessions
    if (options.include_episodic !== false) {
      const epConditions: string[] = [];
      const epParams: any[] = [];

      if (terms.length > 0) {
        const termConds = terms.map(() => "LOWER(e.content) LIKE ?");
        epConditions.push(`(${termConds.join(" OR ")})`);
        for (const term of terms) {
          epParams.push(`%${term}%`);
        }
      }

      if (options.session_ids && options.session_ids.length > 0) {
        epConditions.push(`e.session_id IN (${options.session_ids.map(() => "?").join(",")})`);
        epParams.push(...options.session_ids);
      }

      if (options.date_from) {
        epConditions.push("e.created_at >= ?");
        epParams.push(options.date_from);
      }
      if (options.date_to) {
        epConditions.push("e.created_at <= ?");
        epParams.push(options.date_to);
      }

      if (options.roles && options.roles.length > 0) {
        epConditions.push(`e.role IN (${options.roles.map(() => "?").join(",")})`);
        epParams.push(...options.roles);
      }

      const epWhere = epConditions.length > 0 ? `WHERE ${epConditions.join(" AND ")}` : "";
      epParams.push(limit);

      const epRows = await db.all(
        `SELECT e.*, s.title as session_title FROM brain_episodic e
         LEFT JOIN brain_sessions s ON e.session_id = s.id
         ${epWhere}
         ORDER BY e.importance_score DESC, e.created_at DESC LIMIT ?`,
        epParams,
      );
      episodic = epRows.map(BrainStore.rowToEpisodic);
    }

    // Semantic search across all sessions
    if (options.include_semantic !== false) {
      const semConditions: string[] = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
      const semParams: any[] = [];

      if (terms.length > 0) {
        const termConds = terms.map(() =>
          "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)",
        );
        semConditions.push(`(${termConds.join(" OR ")})`);
        for (const term of terms) {
          const like = `%${term}%`;
          semParams.push(like, like, like);
        }
      }

      if (options.session_ids && options.session_ids.length > 0) {
        semConditions.push(`source_session_id IN (${options.session_ids.map(() => "?").join(",")})`);
        semParams.push(...options.session_ids);
      } else if (options.session_ids !== undefined) {
        semConditions.push("1 = 0");
      }

      if (options.date_from) {
        semConditions.push("created_at >= ?");
        semParams.push(options.date_from);
      }
      if (options.date_to) {
        semConditions.push("created_at <= ?");
        semParams.push(options.date_to);
      }

      semParams.push(limit);

      const semRows = await db.all(
        `SELECT * FROM brain_semantic
         WHERE ${semConditions.join(" AND ")}
         ORDER BY importance_score DESC, retrieval_count DESC, last_accessed_at DESC LIMIT ?`,
        semParams,
      );
      semantic = semRows.map(BrainStore.rowToSemantic);

      // Update retrieval stats
      if (semantic.length > 0) {
        const ids = semantic.map((r) => r.id).join(",");
        await db.exec(`
          UPDATE brain_semantic
          SET retrieval_count = retrieval_count + 1,
              last_accessed_at = datetime('now')
          WHERE id IN (${ids})
        `);
      }
    }

    return {
      semantic,
      episodic,
      sessions_searched: sessionsSearched,
      total_matches: semantic.length + episodic.length,
    };
  }

  // ── Checkpoint / Rollback ──────────────────────────────────────────────────

  /**
   * Create a checkpoint snapshot of the current memory state.
   * Saves semantic, entities, and patterns to a JSON file.
   */
  static async createCheckpoint(
    label: string,
    workspaceCheckpointId?: string,
  ): Promise<MemoryCheckpoint> {
    const db = await BrainStore.get();

    const semanticRows = await db.all("SELECT * FROM brain_semantic");
    const entityRows = await db.all("SELECT * FROM brain_entities");
    const patternRows = await db.all("SELECT * FROM brain_learning_patterns");
    const edgeRows = await db.all("SELECT * FROM brain_graph_edges");
    const procRows = await db.all("SELECT * FROM brain_procedures");

    let linkedWorkspaceId = workspaceCheckpointId;
    if (!linkedWorkspaceId) {
      try {
        const { resolveLinkedWorkspaceCheckpointId } = await import(
          "../../soul/recordSoulEvent.js"
        );
        linkedWorkspaceId = resolveLinkedWorkspaceCheckpointId();
      } catch {
        // Linking is best-effort.
      }
    }

    const snapshot = {
      created_at: new Date().toISOString(),
      label,
      semantic: semanticRows,
      entities: entityRows,
      patterns: patternRows,
      edges: edgeRows,
      procedures: procRows,
      workspace_checkpoint_id: linkedWorkspaceId,
    };

    const brainDir = getMemoryBrainPath();
    if (!fs.existsSync(brainDir)) {
      fs.mkdirSync(brainDir, { recursive: true });
    }
    const snapshotPath = path.join(brainDir, `checkpoint-${Date.now()}.json`);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    const result = await db.run(
      `INSERT INTO brain_checkpoints (label, semantic_count, entity_count, pattern_count, snapshot_path, workspace_checkpoint_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        label,
        semanticRows.length,
        entityRows.length,
        patternRows.length,
        snapshotPath,
        linkedWorkspaceId ?? null,
      ],
    );

    return {
      id: result.lastID!,
      label,
      created_at: new Date().toISOString(),
      semantic_count: semanticRows.length,
      entity_count: entityRows.length,
      pattern_count: patternRows.length,
      snapshot_path: snapshotPath,
      workspace_checkpoint_id: linkedWorkspaceId,
    };
  }

  /**
   * List all checkpoints ordered by creation date.
   */
  static async listCheckpoints(limit: number = 20): Promise<MemoryCheckpoint[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      "SELECT * FROM brain_checkpoints ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
    return rows.map((row: any) => BrainStore.mapCheckpointRow(row));
  }

  /** Latest brain checkpoint linked to a workspace file checkpoint. */
  static async findCheckpointByWorkspaceId(
    workspaceCheckpointId: string,
  ): Promise<MemoryCheckpoint | undefined> {
    if (!workspaceCheckpointId.trim()) {
      return undefined;
    }
    const db = await BrainStore.get();
    const row = await db.get(
      "SELECT * FROM brain_checkpoints WHERE workspace_checkpoint_id = ? ORDER BY id DESC LIMIT 1",
      [workspaceCheckpointId],
    );
    return row ? BrainStore.mapCheckpointRow(row) : undefined;
  }

  /**
   * Drop episodic turns recorded after a workspace restore point.
   * Conversation history before that timestamp is kept.
   */
  static async trimEpisodicAfter(
    sessionId: string,
    createdAt: string,
  ): Promise<number> {
    if (!sessionId || !createdAt) {
      return 0;
    }
    const db = await BrainStore.get();
    const result = await db.run(
      `DELETE FROM brain_episodic
       WHERE session_id = ? AND datetime(created_at) > datetime(?)`,
      [sessionId, createdAt],
    );
    return result.changes ?? 0;
  }

  private static mapCheckpointRow(row: any): MemoryCheckpoint {
    return {
      id: row.id,
      label: row.label,
      created_at: row.created_at,
      semantic_count: row.semantic_count,
      entity_count: row.entity_count,
      pattern_count: row.pattern_count,
      snapshot_path: row.snapshot_path,
      workspace_checkpoint_id: row.workspace_checkpoint_id || undefined,
    };
  }

  /**
   * Rollback memory to a checkpoint state.
   * Replaces semantic, entities, patterns, edges, procedures with snapshot data.
   * Episodic memory and sessions are NOT rolled back (conversation history is preserved).
   */
  static async rollbackCheckpoint(checkpointId: number): Promise<string> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT * FROM brain_checkpoints WHERE id = ?", [checkpointId]);
    if (!row) throw new Error(`Checkpoint #${checkpointId} not found`);

    const snapshotPath = (row as any).snapshot_path;
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(`Checkpoint snapshot file not found: ${snapshotPath}`);
    }

    // Handle both plain JSON and gzip-compressed snapshots
    const { CheckpointManager } = await import("./CheckpointManager.js");
    const snapshot = CheckpointManager.readSnapshot(snapshotPath);

    // Clear current data (preserve sessions and episodic)
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_entities");
    await db.exec("DELETE FROM brain_learning_patterns");
    await db.exec("DELETE FROM brain_graph_edges");
    await db.exec("DELETE FROM brain_procedures");

    // Restore from snapshot
    for (const mem of snapshot.semantic ?? []) {
      await db.run(
        `INSERT INTO brain_semantic (id, category, title, content, source_session_id, keywords, importance_score, retrieval_count, tier, created_at, last_accessed_at, expires_at, emotional_valence, salience, topic_id, task_id, mismatch_count, mismatch_until, mismatch_topic_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mem.id, mem.category, mem.title, mem.content, mem.source_session_id, mem.keywords, mem.importance_score, mem.retrieval_count, mem.tier, mem.created_at, mem.last_accessed_at, mem.expires_at, mem.emotional_valence ?? "neutral", mem.salience ?? 0.5, mem.topic_id ?? null, mem.task_id ?? null, mem.mismatch_count ?? 0, mem.mismatch_until ?? null, mem.mismatch_topic_id ?? null],
      );
    }

    for (const entity of snapshot.entities ?? []) {
      await db.run(
        `INSERT INTO brain_entities (id, name, entity_type, description, properties, confidence, mention_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [entity.id, entity.name, entity.entity_type, entity.description, entity.properties, entity.confidence, entity.mention_count, entity.created_at, entity.updated_at],
      );
    }

    for (const edge of snapshot.edges ?? []) {
      await db.run(
        `INSERT INTO brain_graph_edges (id, source_entity_id, target_entity_id, relationship, weight, properties, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [edge.id, edge.source_entity_id, edge.target_entity_id, edge.relationship, edge.weight, edge.properties, edge.created_at],
      );
    }

    for (const pattern of snapshot.patterns ?? []) {
      await db.run(
        `INSERT INTO brain_learning_patterns (id, goal_type, pattern_signature, description, success_count, failure_count, confidence, avg_tokens_used, last_used_at, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pattern.id, pattern.goal_type, pattern.pattern_signature, pattern.description, pattern.success_count, pattern.failure_count, pattern.confidence, pattern.avg_tokens_used, pattern.last_used_at, pattern.created_at, pattern.metadata],
      );
    }

    for (const proc of snapshot.procedures ?? []) {
      await db.run(
        `INSERT INTO brain_procedures (id, name, description, steps, trigger_pattern, success_rate, execution_count, last_executed_at, created_at, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [proc.id, proc.name, proc.description, proc.steps, proc.trigger_pattern, proc.success_rate, proc.execution_count, proc.last_executed_at, proc.created_at, proc.category],
      );
    }

    const label = (row as any).label;
    const linked = (row as any).workspace_checkpoint_id as string | undefined;
    const base = `Rolled back to checkpoint "${label}" — restored ${snapshot.semantic?.length ?? 0} semantic, ${snapshot.entities?.length ?? 0} entities, ${snapshot.patterns?.length ?? 0} patterns, ${snapshot.edges?.length ?? 0} edges, ${snapshot.procedures?.length ?? 0} procedures`;
    if (!linked) {
      return base;
    }
    try {
      const { formatLinkedRestoreOffer } = await import(
        "../../soul/extractToolFiles.js"
      );
      const offer = formatLinkedRestoreOffer(linked);
      return offer ? `${base}\n${offer}` : base;
    } catch {
      return `${base}\nLinked workspace checkpoint: ${linked}`;
    }
  }

  /**
   * Delete a checkpoint and its snapshot file.
   */
  static async deleteCheckpoint(checkpointId: number): Promise<boolean> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT snapshot_path FROM brain_checkpoints WHERE id = ?", [checkpointId]);
    if (!row) return false;

    const snapshotPath = (row as any).snapshot_path;
    if (snapshotPath && fs.existsSync(snapshotPath)) {
      fs.unlinkSync(snapshotPath);
    }

    await db.run("DELETE FROM brain_checkpoints WHERE id = ?", [checkpointId]);
    return true;
  }

  // ── Rate Limiting ──────────────────────────────────────────────────────────

  /**
   * Check if an LLM memory call is within rate limits.
   * Returns true if allowed, false if rate limited.
   */
  static async checkRateLimit(tokensNeeded: number = 0): Promise<boolean> {
    const db = await BrainStore.get();
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    const row = await db.get("SELECT * FROM brain_rate_limits WHERE id = 1") as any;
    if (!row) return true;

    // Reset if we're in a new hour
    if (now - row.hour_start > hourMs) {
      await db.run(
        "UPDATE brain_rate_limits SET calls_this_hour = 0, tokens_this_hour = 0, hour_start = ? WHERE id = 1",
        [now],
      );
      return true;
    }

    const config = BrainStore.config;
    if (row.calls_this_hour >= config.llm_calls_per_hour_limit) {
      await db.run("UPDATE brain_rate_limits SET denied_count = denied_count + 1 WHERE id = 1");
      return false;
    }
    if (row.tokens_this_hour + tokensNeeded > config.llm_tokens_per_hour_limit) {
      await db.run("UPDATE brain_rate_limits SET denied_count = denied_count + 1 WHERE id = 1");
      return false;
    }

    return true;
  }

  /**
   * Record an LLM memory call for rate limiting.
   */
  static async recordLlmCall(tokensUsed: number): Promise<void> {
    const db = await BrainStore.get();
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    const row = await db.get("SELECT hour_start FROM brain_rate_limits WHERE id = 1") as any;
    if (!row || now - row.hour_start > hourMs) {
      await db.run(
        "UPDATE brain_rate_limits SET calls_this_hour = 1, tokens_this_hour = ?, hour_start = ? WHERE id = 1",
        [tokensUsed, now],
      );
    } else {
      await db.run(
        "UPDATE brain_rate_limits SET calls_this_hour = calls_this_hour + 1, tokens_this_hour = tokens_this_hour + ? WHERE id = 1",
        [tokensUsed],
      );
    }
  }

  /**
   * Get rate limit state.
   */
  static async getRateLimitState(): Promise<RateLimitState> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT * FROM brain_rate_limits WHERE id = 1") as any;
    if (!row) {
      return { calls_this_hour: 0, tokens_this_hour: 0, hour_start: Date.now(), denied_count: 0 };
    }
    return {
      calls_this_hour: row.calls_this_hour,
      tokens_this_hour: row.tokens_this_hour,
      hour_start: row.hour_start,
      denied_count: row.denied_count,
    };
  }

  // ── Audit Trail ────────────────────────────────────────────────────────────

  /**
   * Record an audit log entry for any CRUD operation.
   */
  static async auditLog(action: string, targetType: string, targetId: number | string | null, details: Record<string, any> = {}): Promise<void> {
    try {
      const db = await BrainStore.get();
      await db.run(
        "INSERT INTO brain_audit_log (action, target_type, target_id, details) VALUES (?, ?, ?, ?)",
        [action, targetType, String(targetId ?? ""), JSON.stringify(details)],
      );
    } catch {
      // Never let audit logging break main operations
    }
  }

  /**
   * Query audit log entries.
   */
  static async getAuditLog(options: {
    action?: string;
    target_type?: string;
    target_id?: string;
    limit?: number;
    since?: string;
  } = {}): Promise<AuditLogEntry[]> {
    const db = await BrainStore.get();
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.action) {
      conditions.push("action = ?");
      params.push(options.action);
    }
    if (options.target_type) {
      conditions.push("target_type = ?");
      params.push(options.target_type);
    }
    if (options.target_id) {
      conditions.push("target_id = ?");
      params.push(options.target_id);
    }
    if (options.since) {
      conditions.push("created_at >= ?");
      params.push(options.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(options.limit ?? 50);

    const rows = await db.all(
      `SELECT * FROM brain_audit_log ${where} ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    return rows.map((r: any) => ({
      id: r.id,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      details: r.details,
      created_at: r.created_at,
    }));
  }

  // ── Session Topics ─────────────────────────────────────────────────────────

  /**
   * Store a detected topic for a session.
   */
  static async addSessionTopic(
    sessionId: string,
    topic: string,
    keywords: string,
    messageRangeStart: number,
    messageRangeEnd: number,
    confidence: number = 0.5,
  ): Promise<number> {
    const db = await BrainStore.get();
    const result = await db.run(
      `INSERT INTO brain_session_topics (session_id, topic, keywords, message_range_start, message_range_end, confidence)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, topic, keywords, messageRangeStart, messageRangeEnd, confidence],
    );
    return result.lastID!;
  }

  /**
   * Get topics for a session.
   */
  static async getSessionTopics(sessionId: string): Promise<SessionTopic[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      "SELECT * FROM brain_session_topics WHERE session_id = ? ORDER BY message_range_start ASC",
      [sessionId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      session_id: r.session_id,
      topic: r.topic,
      keywords: r.keywords,
      message_range_start: r.message_range_start,
      message_range_end: r.message_range_end,
      confidence: r.confidence,
      created_at: r.created_at,
    }));
  }

  /**
   * Get the latest topic for a session.
   */
  static async getLatestSessionTopic(sessionId: string): Promise<SessionTopic | null> {
    const db = await BrainStore.get();
    const row = await db.get(
      "SELECT * FROM brain_session_topics WHERE session_id = ? ORDER BY id DESC LIMIT 1",
      [sessionId],
    );
    if (!row) return null;
    return BrainStore.rowToSessionTopic(row);
  }

  // ── Tasks (REL-13) ─────────────────────────────────────────────────────────

  static async openTask(input: {
    sessionId: string;
    title: string;
    topicId?: number | null;
    id?: string;
  }): Promise<BrainTask> {
    const db = await BrainStore.get();
    const id = input.id ?? randomUUID();
    await db.run(
      `INSERT INTO brain_tasks (id, session_id, topic_id, title, opened_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [id, input.sessionId, input.topicId ?? null, input.title],
    );
    const row = await db.get("SELECT * FROM brain_tasks WHERE id = ?", [id]);
    return BrainStore.rowToTask(row);
  }

  static async getOpenTask(sessionId: string): Promise<BrainTask | null> {
    const db = await BrainStore.get();
    const row = await db.get(
      `SELECT * FROM brain_tasks
       WHERE session_id = ? AND closed_at IS NULL
       ORDER BY opened_at DESC LIMIT 1`,
      [sessionId],
    );
    return row ? BrainStore.rowToTask(row) : null;
  }

  static async closeTask(taskId: string): Promise<void> {
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_tasks SET closed_at = datetime('now') WHERE id = ? AND closed_at IS NULL`,
      [taskId],
    );
  }

  static async bindTaskTopic(taskId: string, topicId: number): Promise<void> {
    const db = await BrainStore.get();
    await db.run(`UPDATE brain_tasks SET topic_id = ? WHERE id = ?`, [topicId, taskId]);
  }

  static async listSessionTasks(sessionId: string): Promise<BrainTask[]> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT * FROM brain_tasks WHERE session_id = ? ORDER BY rowid ASC`,
      [sessionId],
    );
    return rows.map(BrainStore.rowToTask);
  }

  private static rowToTask(row: any): BrainTask {
    return {
      id: row.id,
      session_id: row.session_id,
      topic_id: row.topic_id ?? null,
      title: row.title,
      opened_at: row.opened_at,
      closed_at: row.closed_at ?? null,
    };
  }

  /**
   * REL-05: return the active topic, creating a lightweight current-topic
   * when this session has none yet so extracts can be tagged.
   */
  static async ensureCurrentTopic(
    sessionId: string,
    seed?: { topic?: string; keywords?: string },
  ): Promise<SessionTopic> {
    const existing = await BrainStore.getLatestSessionTopic(sessionId);
    if (existing) return existing;

    const keywords = (seed?.keywords ?? "").trim();
    const fromKw = keywords
      .split(/[,\s]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 2)
      .slice(0, 4);
    const topic =
      seed?.topic?.trim() ||
      (fromKw.length > 0
        ? fromKw.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" / ")
        : "Current");
    const id = await BrainStore.addSessionTopic(sessionId, topic, keywords, 0, 0, 0.4);
    return {
      id,
      session_id: sessionId,
      topic,
      keywords,
      message_range_start: 0,
      message_range_end: 0,
      confidence: 0.4,
      created_at: new Date().toISOString(),
    };
  }

  // ── Memory Deduplication ───────────────────────────────────────────────────

  /**
   * Find near-duplicate semantic memories based on title and keyword overlap.
   * Returns potential duplicates with their similarity scores.
   */
  static async findDuplicates(title: string, keywords: string, category?: SemanticCategory): Promise<{ id: number; title: string; similarity: number }[]> {
    const db = await BrainStore.get();
    const titleWords = new Set(title.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const kwSet = new Set(keywords.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 2));

    const conditions: string[] = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
    const params: any[] = [];

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }

    // Pre-filter candidates using OR-matched keywords
    if (kwSet.size > 0) {
      const kwConditions = Array.from(kwSet).slice(0, 5).map(() => "LOWER(keywords) LIKE ?");
      conditions.push(`(${kwConditions.join(" OR ")})`);
      for (const kw of Array.from(kwSet).slice(0, 5)) {
        params.push(`%${kw}%`);
      }
    }

    const rows = await db.all(
      `SELECT id, title, keywords FROM brain_semantic WHERE ${conditions.join(" AND ")} LIMIT 50`,
      params,
    );

    const duplicates: { id: number; title: string; similarity: number }[] = [];
    for (const row of rows) {
      const r = row as any;
      const rTitleWords = new Set(r.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2));
      const rKwSet = new Set(r.keywords.toLowerCase().split(/[,\s]+/).filter((w: string) => w.length > 2));

      // Jaccard similarity on title words
      const titleIntersection = new Set([...titleWords].filter((w) => rTitleWords.has(w)));
      const titleUnion = new Set([...titleWords, ...rTitleWords]);
      const titleSim = titleUnion.size > 0 ? titleIntersection.size / titleUnion.size : 0;

      // Jaccard similarity on keywords
      const kwIntersection = new Set([...kwSet].filter((w) => rKwSet.has(w)));
      const kwUnion = new Set([...kwSet, ...rKwSet]);
      const kwSim = kwUnion.size > 0 ? kwIntersection.size / kwUnion.size : 0;

      // Weighted average
      const similarity = titleSim * 0.6 + kwSim * 0.4;
      if (similarity >= 0.5) {
        duplicates.push({ id: r.id, title: r.title, similarity });
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Boost an existing memory that was identified as a near-duplicate.
   * Increases importance and updates content if new content is longer.
   */
  static async boostDuplicate(id: number, newContent: string): Promise<void> {
    const db = await BrainStore.get();
    await db.run(
      `UPDATE brain_semantic SET
         importance_score = MIN(1.0, importance_score + 0.1),
         last_accessed_at = datetime('now'),
         content = CASE WHEN length(?) > length(content) THEN ? ELSE content END
       WHERE id = ?`,
      [newContent, newContent, id],
    );
  }

  // ── Cold Tier Compression ──────────────────────────────────────────────────

  private static readonly COMPRESS_PREFIX = "z:";

  /**
   * Compress text content using gzip. Returns a base64-encoded string with prefix.
   */
  static compressContent(content: string): string {
    if (content.length < 200) return content; // Too small to benefit
    try {
      const compressed = zlib.gzipSync(Buffer.from(content, "utf-8") as Uint8Array);
      return BrainStore.COMPRESS_PREFIX + (compressed as Buffer).toString("base64");
    } catch {
      return content;
    }
  }

  /**
   * Decompress content if it was compressed.
   */
  static decompressContent(content: string): string {
    if (!content.startsWith(BrainStore.COMPRESS_PREFIX)) return content;
    try {
      const buf = Buffer.from(content.substring(BrainStore.COMPRESS_PREFIX.length), "base64");
      return zlib.gunzipSync(buf as Uint8Array).toString("utf-8");
    } catch {
      return content;
    }
  }

  /**
   * Compress cold-tier semantic memories during consolidation.
   * Only compresses content over 200 chars that isn't already compressed.
   */
  static async compressColdTier(): Promise<number> {
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT id, content FROM brain_semantic WHERE tier = 'cold' AND content NOT LIKE 'z:%' AND length(content) > 200`,
    );

    let compressed = 0;
    for (const row of rows) {
      const r = row as any;
      const compressedContent = BrainStore.compressContent(r.content);
      if (compressedContent !== r.content) {
        await db.run("UPDATE brain_semantic SET content = ? WHERE id = ?", [compressedContent, r.id]);
        compressed++;
      }
    }

    // Also compress cold episodic
    const epRows = await db.all(
      `SELECT id, content FROM brain_episodic WHERE tier = 'cold' AND content NOT LIKE 'z:%' AND length(content) > 200`,
    );
    for (const row of epRows) {
      const r = row as any;
      const compressedContent = BrainStore.compressContent(r.content);
      if (compressedContent !== r.content) {
        await db.run("UPDATE brain_episodic SET content = ? WHERE id = ?", [compressedContent, r.id]);
        compressed++;
      }
    }

    return compressed;
  }

  // ── Emotional Valence Detection ────────────────────────────────────────────

  /**
   * Auto-detect emotional valence from content using heuristic rules.
   * Mirrors Knox-MS amygdala salience markers.
   */
  static detectEmotionalValence(content: string, role: string): EmotionalValence {
    const lower = content.toLowerCase();

    // Urgency markers
    if (/\b(urgent|critical|asap|immediately|deadline|must fix|breaking|blocker|p0|p1)\b/.test(lower))
      return "urgency";

    // Negative markers (errors, frustration)
    if (/\b(error|bug|crash|fail|broken|wrong|issue|problem|annoying|frustrat|stuck|doesn'?t work|can'?t)\b/.test(lower))
      return "negative";

    // Surprise / discovery
    if (/\b(wow|interesting|didn'?t know|unexpected|surprising|actually|turns out|discovered|never knew|whoa)\b/.test(lower))
      return "surprise";

    // Positive markers (success, excitement)
    if (/\b(works|solved|fixed|success|perfect|great|excellent|awesome|thank|nice|done|finally|working)\b/.test(lower))
      return "positive";

    // Curiosity markers
    if (/\b(how does|why does|what if|wonder|curious|explore|understand|learn|explain)\b/.test(lower) || lower.includes("?"))
      return "curiosity";

    return "neutral";
  }

  /**
   * Compute salience (emotional intensity) score.
   * Combines content signals (exclamation marks, caps, strong language) with importance.
   */
  static computeSalience(content: string, role: string, importance: number): number {
    let salience = 0.4;

    // Exclamation marks signal intensity
    const exclamations = (content.match(/!/g) ?? []).length;
    salience += Math.min(exclamations * 0.05, 0.15);

    // ALL-CAPS words signal intensity
    const capsWords = (content.match(/\b[A-Z]{3,}\b/g) ?? []).length;
    salience += Math.min(capsWords * 0.05, 0.15);

    // Strong signal words
    if (/\b(critical|urgent|must|never|always|important|remember)\b/i.test(content))
      salience += 0.15;

    // Code blocks (technical salience)
    if (content.includes("```"))
      salience += 0.1;

    // Blend with importance score
    salience = salience * 0.6 + importance * 0.4;

    // User messages carry slightly more emotional signal
    if (role === "user") salience += 0.05;

    return Math.min(1.0, Math.max(0.1, salience));
  }

  // ── Migrate Schema (add columns if missing) ───────────────────────────────

  /**
   * Add new columns to existing tables.
   * Safe to call repeatedly — uses ALTER TABLE IF NOT EXISTS pattern.
   */
  private static async migrateSchema(db: DatabaseConnection): Promise<void> {
    // Add emotional_valence and salience to episodic
    try { await db.exec("ALTER TABLE brain_episodic ADD COLUMN emotional_valence TEXT NOT NULL DEFAULT 'neutral'"); } catch {}
    try { await db.exec("ALTER TABLE brain_episodic ADD COLUMN salience REAL NOT NULL DEFAULT 0.5"); } catch {}
    // Add emotional_valence and salience to semantic
    try { await db.exec("ALTER TABLE brain_semantic ADD COLUMN emotional_valence TEXT NOT NULL DEFAULT 'neutral'"); } catch {}
    try { await db.exec("ALTER TABLE brain_semantic ADD COLUMN salience REAL NOT NULL DEFAULT 0.5"); } catch {}
    try { await db.exec("ALTER TABLE brain_semantic ADD COLUMN topic_id INTEGER DEFAULT NULL"); } catch {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_semantic_topic ON brain_semantic(topic_id)"); } catch {}
    try { await db.exec("ALTER TABLE brain_semantic ADD COLUMN task_id TEXT DEFAULT NULL"); } catch {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_semantic_task ON brain_semantic(task_id)"); } catch {}
    try { await db.exec("ALTER TABLE brain_semantic ADD COLUMN mismatch_count INTEGER NOT NULL DEFAULT 0"); } catch {}
    try { await db.exec("ALTER TABLE brain_semantic ADD COLUMN mismatch_until DATETIME DEFAULT NULL"); } catch {}
    try { await db.exec("ALTER TABLE brain_semantic ADD COLUMN mismatch_topic_id INTEGER DEFAULT NULL"); } catch {}
    // Project scope (IMP-25)
    try { await db.exec("ALTER TABLE brain_sessions ADD COLUMN project_id TEXT NOT NULL DEFAULT ''"); } catch {}
    try { await db.exec("ALTER TABLE brain_checkpoints ADD COLUMN workspace_checkpoint_id TEXT"); } catch {}
    try {
      const { hashProjectId } = await import("./projectScope.js");
      const rows = await db.all("SELECT id, workspace_directory FROM brain_sessions WHERE project_id = '' OR project_id IS NULL");
      for (const row of rows) {
        const projectId = hashProjectId((row as any).workspace_directory ?? "");
        await db.run("UPDATE brain_sessions SET project_id = ? WHERE id = ?", [projectId, (row as any).id]);
      }
    } catch {}
  }

  // ── Row Mappers ────────────────────────────────────────────────────────────

  private static rowToSession(row: any): BrainSession {
    return {
      id: row.id,
      title: row.title,
      workspace_directory: row.workspace_directory,
      project_id: row.project_id ?? "",
      created_at: row.created_at,
      updated_at: row.updated_at,
      message_count: row.message_count,
      summary: row.summary,
      is_active: !!row.is_active,
    };
  }

  private static rowToEpisodic(row: any): EpisodicMemory {
    return {
      id: row.id,
      session_id: row.session_id,
      type: row.type as EpisodicType,
      role: row.role,
      content: BrainStore.decompressContent(row.content),
      token_count: row.token_count,
      importance_score: row.importance_score,
      emotional_valence: (row.emotional_valence ?? "neutral") as EmotionalValence,
      salience: row.salience ?? 0.5,
      tier: row.tier as MemoryTier,
      metadata: row.metadata,
      created_at: row.created_at,
    };
  }

  private static rowToSemantic(row: any): SemanticMemory {
    return {
      id: row.id,
      category: row.category as SemanticCategory,
      title: row.title,
      content: BrainStore.decompressContent(row.content),
      source_session_id: row.source_session_id,
      keywords: row.keywords,
      importance_score: row.importance_score,
      emotional_valence: (row.emotional_valence ?? "neutral") as EmotionalValence,
      salience: row.salience ?? 0.5,
      retrieval_count: row.retrieval_count,
      tier: row.tier as MemoryTier,
      created_at: row.created_at,
      last_accessed_at: row.last_accessed_at,
      expires_at: row.expires_at,
      topic_id: row.topic_id ?? null,
      task_id: row.task_id ?? null,
      mismatch_count: row.mismatch_count ?? 0,
      mismatch_until: row.mismatch_until ?? null,
      mismatch_topic_id: row.mismatch_topic_id ?? null,
    };
  }

  private static rowToAssociation(row: any): MemoryAssociation {
    return {
      id: row.id,
      source_type: row.source_type,
      source_id: row.source_id,
      target_type: row.target_type,
      target_id: row.target_id,
      relationship: row.relationship,
      strength: row.strength,
      created_at: row.created_at,
    };
  }

  private static rowToEntity(row: any): GraphEntity {
    return {
      id: row.id,
      name: row.name,
      entity_type: row.entity_type as EntityType,
      description: row.description,
      properties: row.properties,
      confidence: row.confidence,
      mention_count: row.mention_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private static rowToEdge(row: any): GraphEdge {
    return {
      id: row.id,
      source_entity_id: row.source_entity_id,
      target_entity_id: row.target_entity_id,
      relationship: row.relationship,
      weight: row.weight,
      properties: row.properties,
      created_at: row.created_at,
    };
  }

  private static rowToPattern(row: any): LearningPattern {
    return {
      id: row.id,
      goal_type: row.goal_type as GoalType,
      pattern_signature: row.pattern_signature,
      description: row.description,
      success_count: row.success_count,
      failure_count: row.failure_count,
      confidence: row.confidence,
      avg_tokens_used: row.avg_tokens_used,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      metadata: row.metadata,
    };
  }

  private static rowToProcedure(row: any): ProceduralMemory {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      steps: row.steps,
      trigger_pattern: row.trigger_pattern,
      success_rate: row.success_rate,
      execution_count: row.execution_count,
      last_executed_at: row.last_executed_at,
      created_at: row.created_at,
      category: row.category,
    };
  }

  private static rowToTag(row: any): MemoryTag {
    return {
      id: row.id,
      memory_type: row.memory_type,
      memory_id: row.memory_id,
      tag: row.tag,
      created_at: row.created_at,
    };
  }

  private static rowToCollection(row: any): MemoryCollection {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      item_count: row.item_count ?? 0,
    };
  }

  private static rowToCollectionItem(row: any): CollectionItem {
    return {
      id: row.id,
      collection_id: row.collection_id,
      memory_type: row.memory_type,
      memory_id: row.memory_id,
      added_at: row.added_at,
    };
  }

  private static rowToAuditLogEntry(row: any): AuditLogEntry {
    return {
      id: row.id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      details: row.details,
      created_at: row.created_at,
    };
  }

  private static rowToSessionTopic(row: any): SessionTopic {
    return {
      id: row.id,
      session_id: row.session_id,
      topic: row.topic,
      keywords: row.keywords,
      message_range_start: row.message_range_start,
      message_range_end: row.message_range_end,
      confidence: row.confidence,
      created_at: row.created_at,
    };
  }
}
