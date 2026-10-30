/** Table creation and additive schema migrations. */

import type { DatabaseConnection } from "../../../../util/refreshIndex.js";

export async function createTables(db: DatabaseConnection): Promise<void> {
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
      summary_node_id INTEGER,
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
      stability REAL,
      difficulty REAL NOT NULL DEFAULT 5,
      i0 REAL,
      helpful_count INTEGER NOT NULL DEFAULT 0,
      unhelpful_count INTEGER NOT NULL DEFAULT 0,
      valid_from DATETIME,
      valid_to DATETIME,
      parent_id INTEGER,
      summary_of TEXT,
      tombstoned_at DATETIME,
      tombstone_reason TEXT,
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
      inject_count INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'hot',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME DEFAULT NULL,
      topic_id INTEGER DEFAULT NULL,
      task_id TEXT DEFAULT NULL,
      mismatch_count INTEGER NOT NULL DEFAULT 0,
      mismatch_until DATETIME DEFAULT NULL,
      mismatch_topic_id INTEGER DEFAULT NULL,
      stability REAL,
      difficulty REAL NOT NULL DEFAULT 5,
      i0 REAL,
      helpful_count INTEGER NOT NULL DEFAULT 0,
      unhelpful_count INTEGER NOT NULL DEFAULT 0,
      valid_from DATETIME,
      valid_to DATETIME,
      parent_id INTEGER,
      summary_of TEXT,
      tombstoned_at DATETIME,
      tombstone_reason TEXT,
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      valid_from DATETIME,
      valid_to DATETIME,
      canonical_id INTEGER
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
      valid_from DATETIME,
      valid_to DATETIME,
      canonical_id INTEGER,
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
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_checkpoints_workspace ON brain_checkpoints(workspace_checkpoint_id)`,
  );

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

  await createRecipeTables(db);
  await createTheoremTables(db);

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

// ── Recipes (MC-10) ────────────────────────────────────────────────────────

async function tryExec(db: DatabaseConnection, sql: string): Promise<void> {
  try { await db.exec(sql); } catch {}
}

/** Columns added after the first `brain_recipes` shape. Safe when they already exist. */
export async function ensureRecipeColumns(db: DatabaseConnection): Promise<void> {
  // Recipe promotion evidence (MC-15).
  await tryExec(db, "ALTER TABLE brain_recipes ADD COLUMN capture_count INTEGER NOT NULL DEFAULT 1");
  await tryExec(db, "ALTER TABLE brain_recipes ADD COLUMN user_accepted_at DATETIME DEFAULT NULL");
  // P1 families: snapshot id stays the content hash; family_id groups variants.
  await tryExec(db, "ALTER TABLE brain_recipes ADD COLUMN family_id TEXT NOT NULL DEFAULT ''");
  await tryExec(db, "ALTER TABLE brain_recipes ADD COLUMN slot_values TEXT NOT NULL DEFAULT '{}'");
  // P5 inspector: pin boost + free-text note (redacted at write).
  await tryExec(db, "ALTER TABLE brain_recipes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  await tryExec(db, "ALTER TABLE brain_recipes ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
}

async function createRecipeIndexes(db: DatabaseConnection): Promise<void> {
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_recipes_project_status ON brain_recipes(project_id, status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_recipes_fingerprint ON brain_recipes(intent_fingerprint)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_recipes_family ON brain_recipes(family_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_recipes_memory ON brain_recipes(memory_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_recipes_scope ON brain_recipes(scope, project_id, status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_recipe_steps_recipe ON brain_recipe_steps(recipe_id, seq)`);
  // Blob refcounts for retention (MC-12).
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_recipe_steps_blob ON brain_recipe_steps(blob_hash)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_recipe_steps_checkpoint ON brain_recipe_steps(checkpoint_id)`);
}

/**
 * Verified, replayable work (see `../../recipes/README.md`). Additive only:
 * `CREATE ... IF NOT EXISTS`, no `BRAIN_SCHEMA_VERSION` bump, so older Knox
 * builds open the same file and ignore these tables.
 *
 * File bytes are never stored here. Steps point at checkpoint blobs by sha256
 * (`blob_hash`) plus the checkpoint that holds them (`checkpoint_id`).
 */
export async function createRecipeTables(db: DatabaseConnection): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS brain_recipes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'project' CHECK (scope IN ('project', 'global')),
      status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (status IN ('candidate', 'verified', 'quarantined', 'retired')),
      title TEXT NOT NULL DEFAULT '',
      intent_text TEXT NOT NULL DEFAULT '',
      intent_fingerprint TEXT NOT NULL DEFAULT '',
      family_id TEXT NOT NULL DEFAULT '',
      slots TEXT NOT NULL DEFAULT '[]',
      slot_values TEXT NOT NULL DEFAULT '{}',
      preconditions TEXT NOT NULL DEFAULT '[]',
      oracle_kind TEXT NOT NULL DEFAULT ''
        CHECK (oracle_kind IN ('', 'build', 'test', 'lsp', 'user')),
      oracle_command TEXT NOT NULL DEFAULT '',
      oracle_passed_at DATETIME DEFAULT NULL,
      replay_count INTEGER NOT NULL DEFAULT 0,
      ok_count INTEGER NOT NULL DEFAULT 0,
      reverted_count INTEGER NOT NULL DEFAULT 0,
      failed_verify_count INTEGER NOT NULL DEFAULT 0,
      capture_count INTEGER NOT NULL DEFAULT 1,
      user_accepted_at DATETIME DEFAULT NULL,
      source_session_id TEXT DEFAULT NULL,
      memory_id INTEGER DEFAULT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_replayed_at DATETIME DEFAULT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS brain_recipe_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('write_file', 'delete_file', 'command')),
      path TEXT NOT NULL DEFAULT '',
      blob_hash TEXT NOT NULL DEFAULT '',
      base_blob_hash TEXT NOT NULL DEFAULT '',
      checkpoint_id TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (recipe_id) REFERENCES brain_recipes(id) ON DELETE CASCADE,
      UNIQUE (recipe_id, seq)
    )
  `);

  // MC-51 / MC-52: outcome counters and supersession links for semantic memories. Additive.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS brain_memory_outcomes (
      memory_id INTEGER PRIMARY KEY,
      verified_count INTEGER NOT NULL DEFAULT 0,
      revert_count INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS brain_memory_supersessions (
      old_id INTEGER PRIMARY KEY,
      new_id INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // CREATE TABLE IF NOT EXISTS is a no-op when the file already has an older
  // brain_recipes (no family_id / slot_values / pinned / notes). Add those
  // columns *before* indexes that name them — otherwise open throws
  // `SQLITE_ERROR: no such column: family_id` and migrateSchema never runs.
  await ensureRecipeColumns(db);
  await createRecipeIndexes(db);
}

// ── Revised theorem columns / tables (MEM-03) ─────────────────────────────
//
// Additive only: CREATE … IF NOT EXISTS + ALTER try/catch. Do not bump
// BRAIN_SCHEMA_VERSION — older Knox builds must open the same file, read
// the old columns, and ignore these extras.

const THEOREM_LEAF_TABLES = ["brain_semantic", "brain_episodic"] as const;

const THEOREM_LEAF_ALTERS = [
  "stability REAL",
  "difficulty REAL NOT NULL DEFAULT 5",
  "i0 REAL",
  "helpful_count INTEGER NOT NULL DEFAULT 0",
  "unhelpful_count INTEGER NOT NULL DEFAULT 0",
  "valid_from DATETIME",
  "valid_to DATETIME",
  "parent_id INTEGER",
  "summary_of TEXT",
  "tombstoned_at DATETIME",
  "tombstone_reason TEXT",
] as const;

const THEOREM_GRAPH_ALTERS = [
  "valid_from DATETIME",
  "valid_to DATETIME",
  "canonical_id INTEGER",
] as const;

/** Columns added after the first semantic / episodic / graph shape. Safe when they already exist. */
export async function ensureTheoremColumns(db: DatabaseConnection): Promise<void> {
  for (const table of THEOREM_LEAF_TABLES) {
    for (const col of THEOREM_LEAF_ALTERS) {
      await tryExec(db, `ALTER TABLE ${table} ADD COLUMN ${col}`);
    }
  }
  // Keep the session summary string and add a tree-node pointer (MEM-05).
  await tryExec(db, "ALTER TABLE brain_sessions ADD COLUMN summary_node_id INTEGER");
  // MEM-16: inject calibration only. Must not live on retrieval_count (S / I).
  await tryExec(db, "ALTER TABLE brain_semantic ADD COLUMN inject_count INTEGER NOT NULL DEFAULT 0");
  for (const table of ["brain_entities", "brain_graph_edges"] as const) {
    for (const col of THEOREM_GRAPH_ALTERS) {
      await tryExec(db, `ALTER TABLE ${table} ADD COLUMN ${col}`);
    }
  }
}

async function createTheoremIndexes(db: DatabaseConnection): Promise<void> {
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_semantic_tombstoned ON brain_semantic(tombstoned_at)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_episodic_tombstoned ON brain_episodic(tombstoned_at)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_semantic_parent ON brain_semantic(parent_id)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_episodic_parent ON brain_episodic(parent_id)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_entity_canonical ON brain_entities(canonical_id)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_graph_edge_canonical ON brain_graph_edges(canonical_id)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_sessions_summary_node ON brain_sessions(summary_node_id)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_summary_tree_parent ON brain_summary_tree(parent_id)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_summary_tree_leaf ON brain_summary_tree(leaf_type, leaf_id)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_attribution_turn ON brain_attribution(turn_id)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_attribution_session ON brain_attribution(session_id)");
  await tryExec(db, "CREATE INDEX IF NOT EXISTS idx_attribution_mem ON brain_attribution(mem_type, mem_id)");
}

/**
 * Stability / utility / tombstone / summary-tree / attribution. Additive only:
 * `CREATE ... IF NOT EXISTS`, no `BRAIN_SCHEMA_VERSION` bump, so older Knox
 * builds open the same file and ignore these tables and columns.
 *
 * New tables have no foreign keys into pre-theorem tables, so an older build
 * can delete sessions or facts without failing on unknown constraints.
 * `leaf_id` / `mem_id` are TEXT so later recipe hashes fit the same columns.
 */
export async function createTheoremTables(db: DatabaseConnection): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS brain_summary_tree (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      kind TEXT NOT NULL DEFAULT 'node',
      leaf_type TEXT,
      leaf_id TEXT,
      text TEXT NOT NULL DEFAULT '',
      token_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS brain_attribution (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id TEXT,
      session_id TEXT,
      mem_type TEXT NOT NULL DEFAULT '',
      mem_id TEXT NOT NULL DEFAULT '',
      injected INTEGER NOT NULL DEFAULT 0,
      cited INTEGER NOT NULL DEFAULT 0,
      helpful INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // CREATE TABLE IF NOT EXISTS is a no-op when the file already has older
  // semantic / episodic / graph tables. Add the theorem columns before any
  // index that names them.
  await ensureTheoremColumns(db);
  await createTheoremIndexes(db);
}

// ── Migrate Schema (add columns if missing) ───────────────────────────────

/**
 * Add new columns to existing tables.
 * Safe to call repeatedly — uses ALTER TABLE IF NOT EXISTS pattern.
 */
export async function migrateSchema(db: DatabaseConnection): Promise<void> {
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
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_checkpoints_workspace ON brain_checkpoints(workspace_checkpoint_id)"); } catch {}
  // Recipe columns added after the first MC-10 table. Idempotent on fresh DBs.
  await ensureRecipeColumns(db);
  try { await createRecipeIndexes(db); } catch {}
  // Theorem columns / tables (MEM-03). Additive; does not bump user_version.
  await createTheoremTables(db);
  try {
    const { hashProjectId } = await import("../projectScope.js");
    const rows = await db.all("SELECT id, workspace_directory FROM brain_sessions WHERE project_id = '' OR project_id IS NULL");
    for (const row of rows) {
      const projectId = hashProjectId((row as any).workspace_directory ?? "");
      await db.run("UPDATE brain_sessions SET project_id = ? WHERE id = ?", [projectId, (row as any).id]);
    }
  } catch {}
}
