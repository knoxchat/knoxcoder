/**
 * CheckpointManager — Advanced checkpoint strategies, lifecycle management,
 * event replay, granular undo, and compressed checkpoints.
 *
 * Tier C Infrastructure features:
 *  16. Checkpoint Strategies (Adaptive, CriticalPoints, TimeBased, Hybrid)
 *  17. Checkpoint Lifecycle Management (auto-cleanup by retention policy)
 *  18. Event Replay (reconstruct state from audit trail)
 *  19. Granular Undo (undo single operations, not full rollback)
 *  20. Data Compression for checkpoints/exports (gzip snapshots)
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";

import { BrainStore } from "./BrainStore.js";
import type {
  MemoryCheckpoint,
  AuditLogEntry,
} from "./types.js";

// ── Checkpoint Strategy Types ────────────────────────────────────────────────

export type CheckpointStrategyMode =
  | "adaptive"        // Auto-checkpoint when change delta exceeds threshold
  | "critical_points" // Checkpoint before destructive ops (delete, rollback, consolidate)
  | "time_based"      // Periodic checkpoints at fixed intervals
  | "hybrid";         // Combines all three strategies

export interface CheckpointStrategyConfig {
  mode: CheckpointStrategyMode;
  // Adaptive thresholds
  adaptive_change_threshold: number; // Min changes since last checkpoint to trigger (default 10)
  // Time-based interval
  time_interval_minutes: number;     // Default 60
  // Lifecycle / retention policy
  max_checkpoints: number;           // Max total checkpoints to keep (default 20)
  max_age_days: number;              // Delete checkpoints older than N days (default 30)
  max_total_size_mb: number;         // Max total checkpoint file size in MB (default 100)
  // Compression
  compress_snapshots: boolean;       // Gzip snapshot files (default true)
}

export interface CheckpointLifecycleReport {
  deleted_by_count: number;
  deleted_by_age: number;
  deleted_by_size: number;
  total_deleted: number;
  remaining: number;
  total_size_bytes: number;
}

export interface EventReplayResult {
  events_replayed: number;
  operations: ReplayedOperation[];
  target_timestamp: string;
  from_timestamp: string;
}

export interface ReplayedOperation {
  action: string;
  target_type: string;
  target_id: string;
  timestamp: string;
  details: Record<string, any>;
}

export interface UndoResult {
  success: boolean;
  action_undone: string;
  target_type: string;
  target_id: string;
  details: string;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_STRATEGY_CONFIG: CheckpointStrategyConfig = {
  mode: "hybrid",
  adaptive_change_threshold: 10,
  time_interval_minutes: 60,
  max_checkpoints: 20,
  max_age_days: 30,
  max_total_size_mb: 100,
  compress_snapshots: true,
};

// ── CheckpointManager ───────────────────────────────────────────────────────

export class CheckpointManager {
  private static config: CheckpointStrategyConfig = { ...DEFAULT_STRATEGY_CONFIG };
  private static changesSinceLastCheckpoint = 0;
  private static lastCheckpointTime: number = Date.now();

  // ── Configuration ────────────────────────────────────────────────────────

  static getConfig(): CheckpointStrategyConfig {
    return { ...CheckpointManager.config };
  }

  static updateConfig(partial: Partial<CheckpointStrategyConfig>): void {
    CheckpointManager.config = { ...CheckpointManager.config, ...partial };
  }

  // ── Strategy: Record Change ──────────────────────────────────────────────

  /**
   * Called after any CRUD operation to track changes.
   * In adaptive/hybrid mode, triggers an auto-checkpoint when threshold is met.
   * Returns the checkpoint if one was created, null otherwise.
   */
  static async recordChange(): Promise<MemoryCheckpoint | null> {
    CheckpointManager.changesSinceLastCheckpoint++;
    const cfg = CheckpointManager.config;
    const mode = cfg.mode;

    if (mode === "adaptive" || mode === "hybrid") {
      if (CheckpointManager.changesSinceLastCheckpoint >= cfg.adaptive_change_threshold) {
        return CheckpointManager.triggerAutoCheckpoint("adaptive");
      }
    }

    if (mode === "time_based" || mode === "hybrid") {
      const elapsed = Date.now() - CheckpointManager.lastCheckpointTime;
      if (elapsed >= cfg.time_interval_minutes * 60 * 1000) {
        return CheckpointManager.triggerAutoCheckpoint("time_based");
      }
    }

    return null;
  }

  /**
   * Called before destructive operations (delete, rollback, consolidate).
   * In critical_points/hybrid mode, creates an auto-checkpoint first.
   */
  static async beforeDestructiveOp(opName: string): Promise<MemoryCheckpoint | null> {
    const mode = CheckpointManager.config.mode;
    if (mode === "critical_points" || mode === "hybrid") {
      return CheckpointManager.triggerAutoCheckpoint(`critical:${opName}`);
    }
    return null;
  }

  private static async triggerAutoCheckpoint(reason: string): Promise<MemoryCheckpoint> {
    const label = `auto:${reason}:${new Date().toISOString()}`;
    const cp = CheckpointManager.config.compress_snapshots
      ? await CheckpointManager.createCompressedCheckpoint(label)
      : await BrainStore.createCheckpoint(label);

    CheckpointManager.changesSinceLastCheckpoint = 0;
    CheckpointManager.lastCheckpointTime = Date.now();

    // Run lifecycle cleanup after creating
    await CheckpointManager.runLifecycleCleanup();

    return cp;
  }

  // ── Feature 17: Checkpoint Lifecycle Management ──────────────────────────

  /**
   * Auto-cleanup checkpoints based on retention policy:
   * - max_checkpoints: delete oldest when exceeding limit
   * - max_age_days: delete checkpoints older than N days
   * - max_total_size_mb: delete oldest until total size is under limit
   */
  static async runLifecycleCleanup(): Promise<CheckpointLifecycleReport> {
    const cfg = CheckpointManager.config;
    const allCheckpoints = await BrainStore.listCheckpoints(1000);

    let deletedByAge = 0;
    let deletedByCount = 0;
    let deletedBySize = 0;

    const deleted = new Set<number>();

    // 1. Delete by age
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cfg.max_age_days);
    const cutoffStr = cutoff.toISOString();

    for (const cp of allCheckpoints) {
      if (cp.created_at < cutoffStr && !deleted.has(cp.id)) {
        await BrainStore.deleteCheckpoint(cp.id);
        deleted.add(cp.id);
        deletedByAge++;
      }
    }

    // 2. Delete by count (keep newest max_checkpoints)
    const remaining = allCheckpoints.filter((cp) => !deleted.has(cp.id));
    if (remaining.length > cfg.max_checkpoints) {
      // remaining is sorted DESC by created_at — delete from the tail (oldest)
      const toRemove = remaining.slice(cfg.max_checkpoints);
      for (const cp of toRemove) {
        if (!deleted.has(cp.id)) {
          await BrainStore.deleteCheckpoint(cp.id);
          deleted.add(cp.id);
          deletedByCount++;
        }
      }
    }

    // 3. Delete by total size
    const surviving = allCheckpoints.filter((cp) => !deleted.has(cp.id));
    let totalSize = 0;
    const withSize: Array<{ cp: MemoryCheckpoint; size: number }> = [];
    for (const cp of surviving) {
      try {
        const stat = fs.statSync(cp.snapshot_path);
        totalSize += stat.size;
        withSize.push({ cp, size: stat.size });
      } catch {
        // File missing — skip
      }
    }

    const maxBytes = cfg.max_total_size_mb * 1024 * 1024;
    if (totalSize > maxBytes) {
      // Delete oldest first until under limit
      const sortedOldest = withSize.sort(
        (a, b) => a.cp.created_at.localeCompare(b.cp.created_at),
      );
      for (const item of sortedOldest) {
        if (totalSize <= maxBytes) break;
        if (!deleted.has(item.cp.id)) {
          await BrainStore.deleteCheckpoint(item.cp.id);
          deleted.add(item.cp.id);
          totalSize -= item.size;
          deletedBySize++;
        }
      }
    }

    return {
      deleted_by_count: deletedByCount,
      deleted_by_age: deletedByAge,
      deleted_by_size: deletedBySize,
      total_deleted: deleted.size,
      remaining: allCheckpoints.length - deleted.size,
      total_size_bytes: totalSize,
    };
  }

  // ── Feature 20: Compressed Checkpoints ───────────────────────────────────

  /**
   * Create a checkpoint with gzip-compressed snapshot file.
   * Uses .json.gz extension and stores compressed bytes directly.
   */
  static async createCompressedCheckpoint(label: string): Promise<MemoryCheckpoint> {
    const db = await BrainStore.get();

    const semanticRows = await db.all("SELECT * FROM brain_semantic");
    const entityRows = await db.all("SELECT * FROM brain_entities");
    const patternRows = await db.all("SELECT * FROM brain_learning_patterns");
    const edgeRows = await db.all("SELECT * FROM brain_graph_edges");
    const procRows = await db.all("SELECT * FROM brain_procedures");

    const snapshot = {
      created_at: new Date().toISOString(),
      label,
      compressed: true,
      semantic: semanticRows,
      entities: entityRows,
      patterns: patternRows,
      edges: edgeRows,
      procedures: procRows,
    };

    const jsonStr = JSON.stringify(snapshot);
    const compressed = zlib.gzipSync(Buffer.from(jsonStr, "utf-8") as Uint8Array);

    const { getMemoryBrainPath } = await import("../../../util/paths.js");
    const brainDir = getMemoryBrainPath();
    if (!fs.existsSync(brainDir)) {
      fs.mkdirSync(brainDir, { recursive: true });
    }
    const snapshotPath = path.join(brainDir, `checkpoint-${Date.now()}.json.gz`);
    fs.writeFileSync(snapshotPath, compressed as Uint8Array);

    let linkedWorkspaceId: string | undefined;
    try {
      const { resolveLinkedWorkspaceCheckpointId } = await import(
        "../../soul/recordSoulEvent.js"
      );
      linkedWorkspaceId = resolveLinkedWorkspaceCheckpointId();
    } catch {
      // Linking is best-effort.
    }

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

    await BrainStore.auditLog("create_checkpoint", "checkpoint", result.lastID!, { label, compressed: true });

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
   * Read a checkpoint snapshot, automatically handling .json.gz (compressed) or .json (plain).
   */
  static readSnapshot(snapshotPath: string): any {
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(`Snapshot file not found: ${snapshotPath}`);
    }

    const raw = fs.readFileSync(snapshotPath);

    // Try decompressing first (gzip magic bytes: 0x1f 0x8b)
    if (raw[0] === 0x1f && raw[1] === 0x8b) {
      const decompressed = zlib.gunzipSync(raw as Uint8Array);
      return JSON.parse(decompressed.toString("utf-8"));
    }

    // Plain JSON
    return JSON.parse(raw.toString("utf-8"));
  }

  /**
   * Compress an existing uncompressed checkpoint snapshot in place.
   * Returns size reduction in bytes.
   */
  static async compressExistingCheckpoint(checkpointId: number): Promise<number> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT * FROM brain_checkpoints WHERE id = ?", [checkpointId]) as any;
    if (!row) throw new Error(`Checkpoint #${checkpointId} not found`);

    const snapshotPath: string = row.snapshot_path;
    if (snapshotPath.endsWith(".json.gz")) return 0; // Already compressed

    const raw = fs.readFileSync(snapshotPath);
    // Check if already gzip
    if (raw[0] === 0x1f && raw[1] === 0x8b) return 0;

    const compressed = zlib.gzipSync(raw as Uint8Array);
    const newPath = snapshotPath + ".gz";
    fs.writeFileSync(newPath, compressed as Uint8Array);
    fs.unlinkSync(snapshotPath);

    await db.run("UPDATE brain_checkpoints SET snapshot_path = ? WHERE id = ?", [newPath, checkpointId]);

    return raw.length - compressed.length;
  }

  /**
   * Compress an export object (MemoryExport) to a gzipped Buffer.
   */
  static compressExport(exportData: any): Buffer {
    const json = JSON.stringify(exportData);
    return zlib.gzipSync(Buffer.from(json, "utf-8") as Uint8Array) as Buffer;
  }

  /**
   * Decompress an export Buffer back to a MemoryExport object.
   */
  static decompressExport(data: Buffer): any {
    const decompressed = zlib.gunzipSync(data as Uint8Array);
    return JSON.parse(decompressed.toString("utf-8"));
  }

  // ── Feature 18: Event Replay ─────────────────────────────────────────────

  /**
   * Reconstruct a timeline of operations from the audit trail.
   * Returns the sequence of operations between two timestamps so the caller
   * can understand what happened during that period.
   *
   * Usage: replay events from a checkpoint to understand what changed,
   * or replay from a specific time to see all modifications.
   */
  static async replayEvents(options: {
    from?: string;           // ISO timestamp start (inclusive)
    to?: string;             // ISO timestamp end (inclusive)
    checkpoint_id?: number;  // Replay from this checkpoint's timestamp
    action_filter?: string;  // Only replay specific action types
    target_type_filter?: string;
    limit?: number;
  } = {}): Promise<EventReplayResult> {
    let fromTimestamp = options.from;

    // If checkpoint_id given, use its creation timestamp as start
    if (options.checkpoint_id) {
      const checkpoints = await BrainStore.listCheckpoints(1000);
      const cp = checkpoints.find((c) => c.id === options.checkpoint_id);
      if (cp) {
        fromTimestamp = cp.created_at;
      }
    }

    const auditEntries = await BrainStore.getAuditLog({
      action: options.action_filter,
      target_type: options.target_type_filter,
      since: fromTimestamp,
      limit: options.limit ?? 500,
    });

    // Filter by 'to' timestamp if specified
    let filtered = auditEntries;
    if (options.to) {
      filtered = auditEntries.filter((e) => e.created_at <= options.to!);
    }

    // Reverse to chronological order (audit log returns DESC)
    filtered.reverse();

    const operations: ReplayedOperation[] = filtered.map((entry) => {
      let details: Record<string, any> = {};
      try {
        details = JSON.parse(entry.details);
      } catch {}
      return {
        action: entry.action,
        target_type: entry.target_type,
        target_id: String(entry.target_id ?? ""),
        timestamp: entry.created_at,
        details,
      };
    });

    return {
      events_replayed: operations.length,
      operations,
      target_timestamp: options.to ?? new Date().toISOString(),
      from_timestamp: fromTimestamp ?? "beginning",
    };
  }

  /**
   * Get a diff between a checkpoint state and current state.
   * Shows what was added, removed, or changed since the checkpoint.
   */
  static async diffFromCheckpoint(checkpointId: number): Promise<{
    semantic: { added: number; removed: number };
    entities: { added: number; removed: number };
    patterns: { added: number; removed: number };
    events_since: number;
  }> {
    const db = await BrainStore.get();
    const row = await db.get("SELECT * FROM brain_checkpoints WHERE id = ?", [checkpointId]) as any;
    if (!row) throw new Error(`Checkpoint #${checkpointId} not found`);

    const snapshot = CheckpointManager.readSnapshot(row.snapshot_path);
    const snapshotSemanticIds = new Set((snapshot.semantic ?? []).map((s: any) => s.id));
    const snapshotEntityIds = new Set((snapshot.entities ?? []).map((e: any) => e.id));
    const snapshotPatternIds = new Set((snapshot.patterns ?? []).map((p: any) => p.id));

    const currentSemantic = await db.all("SELECT id FROM brain_semantic");
    const currentEntities = await db.all("SELECT id FROM brain_entities");
    const currentPatterns = await db.all("SELECT id FROM brain_learning_patterns");

    const currentSemanticIds = new Set(currentSemantic.map((r: any) => r.id));
    const currentEntityIds = new Set(currentEntities.map((r: any) => r.id));
    const currentPatternIds = new Set(currentPatterns.map((r: any) => r.id));

    const semanticAdded = [...currentSemanticIds].filter((id) => !snapshotSemanticIds.has(id)).length;
    const semanticRemoved = [...snapshotSemanticIds].filter((id) => !currentSemanticIds.has(id)).length;
    const entityAdded = [...currentEntityIds].filter((id) => !snapshotEntityIds.has(id)).length;
    const entityRemoved = [...snapshotEntityIds].filter((id) => !currentEntityIds.has(id)).length;
    const patternAdded = [...currentPatternIds].filter((id) => !snapshotPatternIds.has(id)).length;
    const patternRemoved = [...snapshotPatternIds].filter((id) => !currentPatternIds.has(id)).length;

    // Count audit events since checkpoint
    const auditSince = await BrainStore.getAuditLog({ since: row.created_at, limit: 10000 });

    return {
      semantic: { added: semanticAdded, removed: semanticRemoved },
      entities: { added: entityAdded, removed: entityRemoved },
      patterns: { added: patternAdded, removed: patternRemoved },
      events_since: auditSince.length,
    };
  }

  // ── Feature 19: Granular Undo ────────────────────────────────────────────

  /**
   * Undo a single operation identified by its audit log entry ID.
   * Reverses the effect of a specific CRUD operation rather than doing
   * a full rollback to a checkpoint.
   *
   * Supports undoing:
   * - store / create → deletes the created record
   * - delete → re-inserts using the data stored in audit details
   * - update → reverts to old values stored in audit details
   *
   * The audit log must contain enough detail to reverse the operation
   * (details JSON should include old/new values or the full record).
   */
  static async undoOperation(auditEntryId: number): Promise<UndoResult> {
    const db = await BrainStore.get();
    const entries = await BrainStore.getAuditLog({ limit: 10000 });
    const entry = entries.find((e) => e.id === auditEntryId);
    if (!entry) {
      return { success: false, action_undone: "unknown", target_type: "unknown", target_id: "", details: "Audit entry not found" };
    }

    let details: Record<string, any> = {};
    try {
      details = JSON.parse(entry.details);
    } catch {}

    const action = entry.action;
    const targetType = entry.target_type;
    const targetId = String(entry.target_id ?? "");

    try {
      // ── Undo a "store" / "create" → delete the created record ────────
      if (action === "store" || action === "create" || action === "create_semantic" || action === "store_semantic") {
        if (targetType === "semantic" && targetId) {
          await db.run("DELETE FROM brain_semantic WHERE id = ?", [Number(targetId)]);
          await BrainStore.auditLog("undo_store", "semantic", targetId, { undone_audit_id: auditEntryId });
          return { success: true, action_undone: action, target_type: targetType, target_id: targetId, details: `Deleted semantic #${targetId}` };
        }
        if (targetType === "entity" && targetId) {
          await db.run("DELETE FROM brain_entities WHERE id = ?", [Number(targetId)]);
          await BrainStore.auditLog("undo_create", "entity", targetId, { undone_audit_id: auditEntryId });
          return { success: true, action_undone: action, target_type: targetType, target_id: targetId, details: `Deleted entity #${targetId}` };
        }
        if (targetType === "pattern" && targetId) {
          await db.run("DELETE FROM brain_learning_patterns WHERE id = ?", [Number(targetId)]);
          await BrainStore.auditLog("undo_create", "pattern", targetId, { undone_audit_id: auditEntryId });
          return { success: true, action_undone: action, target_type: targetType, target_id: targetId, details: `Deleted pattern #${targetId}` };
        }
        if (targetType === "procedure" && targetId) {
          await db.run("DELETE FROM brain_procedures WHERE id = ?", [Number(targetId)]);
          await BrainStore.auditLog("undo_create", "procedure", targetId, { undone_audit_id: auditEntryId });
          return { success: true, action_undone: action, target_type: targetType, target_id: targetId, details: `Deleted procedure #${targetId}` };
        }
        if (targetType === "edge" && targetId) {
          await db.run("DELETE FROM brain_graph_edges WHERE id = ?", [Number(targetId)]);
          await BrainStore.auditLog("undo_create", "edge", targetId, { undone_audit_id: auditEntryId });
          return { success: true, action_undone: action, target_type: targetType, target_id: targetId, details: `Deleted edge #${targetId}` };
        }
      }

      // ── Undo a "delete" → re-insert from audit details ──────────────
      if (action === "delete" || action === "delete_semantic" || action === "delete_entity" || action === "delete_pattern" || action === "delete_procedure") {
        if (!details.record) {
          return { success: false, action_undone: action, target_type: targetType, target_id: targetId, details: "Cannot undo delete: audit entry lacks original record data" };
        }
        const rec = details.record;

        if (targetType === "semantic") {
          await db.run(
            `INSERT INTO brain_semantic (id, category, title, content, source_session_id, keywords, importance_score, emotional_valence, salience, retrieval_count, tier, created_at, last_accessed_at, expires_at, topic_id, task_id, mismatch_count, mismatch_until, mismatch_topic_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [rec.id, rec.category, rec.title, rec.content, rec.source_session_id, rec.keywords, rec.importance_score, rec.emotional_valence ?? "neutral", rec.salience ?? 0.5, rec.retrieval_count, rec.tier, rec.created_at, rec.last_accessed_at, rec.expires_at, rec.topic_id ?? null, rec.task_id ?? null, rec.mismatch_count ?? 0, rec.mismatch_until ?? null, rec.mismatch_topic_id ?? null],
          );
          await BrainStore.auditLog("undo_delete", "semantic", targetId, { undone_audit_id: auditEntryId });
          return { success: true, action_undone: action, target_type: targetType, target_id: targetId, details: `Re-inserted semantic #${targetId}` };
        }

        if (targetType === "entity") {
          await db.run(
            `INSERT INTO brain_entities (id, name, entity_type, description, properties, confidence, mention_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [rec.id, rec.name, rec.entity_type, rec.description, rec.properties, rec.confidence, rec.mention_count, rec.created_at, rec.updated_at],
          );
          await BrainStore.auditLog("undo_delete", "entity", targetId, { undone_audit_id: auditEntryId });
          return { success: true, action_undone: action, target_type: targetType, target_id: targetId, details: `Re-inserted entity #${targetId}` };
        }

        if (targetType === "pattern") {
          await db.run(
            `INSERT INTO brain_learning_patterns (id, goal_type, pattern_signature, description, success_count, failure_count, confidence, avg_tokens_used, last_used_at, created_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [rec.id, rec.goal_type, rec.pattern_signature, rec.description, rec.success_count, rec.failure_count, rec.confidence, rec.avg_tokens_used, rec.last_used_at, rec.created_at, rec.metadata],
          );
          await BrainStore.auditLog("undo_delete", "pattern", targetId, { undone_audit_id: auditEntryId });
          return { success: true, action_undone: action, target_type: targetType, target_id: targetId, details: `Re-inserted pattern #${targetId}` };
        }
      }

      // ── Undo an "update" → revert to old values ─────────────────────
      if (action === "update" || action.startsWith("update_")) {
        if (!details.old_values || !details.table) {
          return { success: false, action_undone: action, target_type: targetType, target_id: targetId, details: "Cannot undo update: audit entry lacks old_values or table info" };
        }
        const setClauses = Object.keys(details.old_values).map((k) => `${k} = ?`).join(", ");
        const values = Object.values(details.old_values);
        await db.run(`UPDATE ${details.table} SET ${setClauses} WHERE id = ?`, [...values, Number(targetId)]);
        await BrainStore.auditLog("undo_update", targetType, targetId, { undone_audit_id: auditEntryId, restored_values: details.old_values });
        return { success: true, action_undone: action, target_type: targetType, target_id: targetId, details: `Reverted ${Object.keys(details.old_values).join(", ")} on ${targetType} #${targetId}` };
      }

      return { success: false, action_undone: action, target_type: targetType, target_id: targetId, details: `Undo not supported for action type: ${action}` };
    } catch (err: any) {
      return { success: false, action_undone: action, target_type: targetType, target_id: targetId, details: `Undo failed: ${err.message}` };
    }
  }

  /**
   * Get a list of undoable operations from the audit log.
   * Filters to only return entries that can be reversed.
   */
  static async getUndoableOperations(limit: number = 20): Promise<AuditLogEntry[]> {
    const entries = await BrainStore.getAuditLog({ limit: limit * 3 });
    const undoableActions = new Set([
      "store", "create", "create_semantic", "store_semantic",
      "delete", "delete_semantic", "delete_entity", "delete_pattern", "delete_procedure",
      "update",
    ]);
    return entries
      .filter((e) => undoableActions.has(e.action) || e.action.startsWith("update_"))
      .slice(0, limit);
  }
}
