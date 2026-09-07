/**
 * BatchOperations — Bulk delete, batch events, batch memory store.
 *
 * Tier C Infrastructure feature 21:
 * Provides efficient batch operations instead of individual loops.
 * Uses SQLite transactions for atomicity and performance.
 */

import { BrainStore } from "./BrainStore.js";
import { InputSanitizer } from "./InputSanitizer.js";
import type {
  StoreInput,
  SemanticMemory,
  AddEntityInput,
  AddEdgeInput,
  AuditLogEntry,
} from "./types.js";

// ── Batch Operation Types ────────────────────────────────────────────────────

export interface BatchDeleteInput {
  target_type: "semantic" | "entity" | "pattern" | "procedure" | "edge" | "session" | "episodic";
  ids: number[];
}

export interface BatchDeleteResult {
  target_type: string;
  requested: number;
  deleted: number;
  failed: number;
  errors: string[];
}

export interface BatchStoreInput {
  items: StoreInput[];
}

export interface BatchStoreResult {
  stored: number;
  ids: number[];
  failed: number;
  errors: string[];
}

export interface BatchEventInput {
  events: Array<{
    action: string;
    target_type: string;
    target_id: number | string | null;
    details?: Record<string, any>;
  }>;
}

export interface BatchEventResult {
  logged: number;
  failed: number;
}

// ── Table mapping for batch deletes ──────────────────────────────────────────

const TABLE_MAP: Record<string, string> = {
  semantic: "brain_semantic",
  entity: "brain_entities",
  pattern: "brain_learning_patterns",
  procedure: "brain_procedures",
  edge: "brain_graph_edges",
  session: "brain_sessions",
  episodic: "brain_episodic",
};

// ── BatchOperations ──────────────────────────────────────────────────────────

export class BatchOperations {

  /**
   * Bulk delete multiple records of the same type in a single transaction.
   * Much more efficient than calling individual delete methods in a loop.
   * Records full data in audit log for potential undo.
   */
  static async batchDelete(input: BatchDeleteInput): Promise<BatchDeleteResult> {
    const db = await BrainStore.get();
    const table = TABLE_MAP[input.target_type];
    if (!table) {
      return {
        target_type: input.target_type,
        requested: input.ids.length,
        deleted: 0,
        failed: input.ids.length,
        errors: [`Unknown target type: ${input.target_type}`],
      };
    }

    const errors: string[] = [];
    let deleted = 0;

    // Use a transaction for atomicity
    await db.exec("BEGIN TRANSACTION");
    try {
      for (const id of input.ids) {
        try {
          // Capture record for undo before deleting
          const record = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
          if (!record) {
            errors.push(`${input.target_type} #${id} not found`);
            continue;
          }

          // Delete associations if semantic
          if (input.target_type === "semantic") {
            await db.run(
              "DELETE FROM brain_associations WHERE (source_type = 'semantic' AND source_id = ?) OR (target_type = 'semantic' AND target_id = ?)",
              [id, id],
            );
          }

          // Delete tags
          if (["semantic", "episodic", "entity", "procedure"].includes(input.target_type)) {
            await db.run(
              "DELETE FROM brain_tags WHERE memory_type = ? AND memory_id = ?",
              [input.target_type, id],
            );
          }

          await db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
          deleted++;

          // Audit log with full record for undo support
          await BrainStore.auditLog("delete", input.target_type, id, { record });
        } catch (err: any) {
          errors.push(`Failed to delete ${input.target_type} #${id}: ${err.message}`);
        }
      }
      await db.exec("COMMIT");
    } catch (err: any) {
      await db.exec("ROLLBACK");
      return {
        target_type: input.target_type,
        requested: input.ids.length,
        deleted: 0,
        failed: input.ids.length,
        errors: [`Transaction failed: ${err.message}`],
      };
    }

    return {
      target_type: input.target_type,
      requested: input.ids.length,
      deleted,
      failed: input.ids.length - deleted,
      errors,
    };
  }

  /**
   * Batch store multiple semantic memories in a single transaction.
   * Much more efficient than calling store() individually.
   */
  static async batchStore(input: BatchStoreInput): Promise<BatchStoreResult> {
    const db = await BrainStore.get();
    const ids: number[] = [];
    const errors: string[] = [];
    let stored = 0;

    await db.exec("BEGIN TRANSACTION");
    try {
      for (const item of input.items) {
        try {
          const normalized = BatchOperations.normalizeStoreInput(item);
          const duplicates = await BrainStore.findDuplicates(
            normalized.title,
            normalized.keywords ?? "",
            normalized.category,
          );

          let id: number;
          if (duplicates.length > 0 && duplicates[0].similarity >= 0.7) {
            id = duplicates[0].id;
            await BrainStore.boostDuplicate(id, normalized.content);
            await BrainStore.auditLog("deduplicate", "semantic", id, {
              title: normalized.title,
              category: normalized.category,
              batch: true,
            });
          } else {
            id = await BrainStore.storeSemantic(normalized);
            await BrainStore.auditLog("store", "semantic", id, {
              title: normalized.title,
              category: normalized.category,
              batch: true,
            });
          }

          ids.push(id);
          stored++;
        } catch (err: any) {
          errors.push(`Failed to store "${item.title}": ${err.message}`);
        }
      }
      await db.exec("COMMIT");
    } catch (err: any) {
      await db.exec("ROLLBACK");
      return { stored: 0, ids: [], failed: input.items.length, errors: [`Transaction failed: ${err.message}`] };
    }

    return { stored, ids, failed: input.items.length - stored, errors };
  }

  private static normalizeStoreInput(item: StoreInput): StoreInput {
    const title = InputSanitizer.enforce(item.title, "batch.semantic.title");
    const content = InputSanitizer.enforce(item.content, "batch.semantic.content");

    return {
      ...item,
      title,
      content,
      keywords: item.keywords || BatchOperations.extractKeywords(`${title} ${content}`),
    };
  }

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
      .filter((word) => word.length > 2 && !stopWords.has(word));

    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word)
      .join(", ");
  }

  /**
   * Batch log multiple audit events in a single transaction.
   * Useful for recording a sequence of related operations atomically.
   */
  static async batchAuditLog(input: BatchEventInput): Promise<BatchEventResult> {
    const db = await BrainStore.get();
    let logged = 0;
    let failed = 0;

    await db.exec("BEGIN TRANSACTION");
    try {
      for (const event of input.events) {
        try {
          await db.run(
            "INSERT INTO brain_audit_log (action, target_type, target_id, details) VALUES (?, ?, ?, ?)",
            [event.action, event.target_type, String(event.target_id ?? ""), JSON.stringify(event.details ?? {})],
          );
          logged++;
        } catch {
          failed++;
        }
      }
      await db.exec("COMMIT");
    } catch {
      await db.exec("ROLLBACK");
      return { logged: 0, failed: input.events.length };
    }

    return { logged, failed };
  }

  /**
   * Batch update importance scores for multiple semantic memories.
   */
  static async batchUpdateImportance(updates: Array<{ id: number; importance_score: number }>): Promise<number> {
    const db = await BrainStore.get();
    let updated = 0;

    await db.exec("BEGIN TRANSACTION");
    try {
      for (const u of updates) {
        const result = await db.run(
          "UPDATE brain_semantic SET importance_score = ? WHERE id = ?",
          [u.importance_score, u.id],
        );
        if (result.changes && result.changes > 0) updated++;
      }
      await db.exec("COMMIT");
    } catch {
      await db.exec("ROLLBACK");
      return 0;
    }

    return updated;
  }

  /**
   * Batch move memories between tiers.
   */
  static async batchMoveTier(
    target_type: "semantic" | "episodic",
    ids: number[],
    newTier: "hot" | "warm" | "cold",
  ): Promise<number> {
    const db = await BrainStore.get();
    const table = target_type === "semantic" ? "brain_semantic" : "brain_episodic";
    let moved = 0;

    await db.exec("BEGIN TRANSACTION");
    try {
      for (const id of ids) {
        const result = await db.run(
          `UPDATE ${table} SET tier = ? WHERE id = ?`,
          [newTier, id],
        );
        if (result.changes && result.changes > 0) moved++;
      }
      await db.exec("COMMIT");
    } catch {
      await db.exec("ROLLBACK");
      return 0;
    }

    return moved;
  }

  /**
   * Pin many semantic memories in one transaction (hot tier + pinned tag).
   */
  static async batchPin(ids: number[]): Promise<{ updated: number; failed: number }> {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (unique.length === 0) {
      return { updated: 0, failed: 0 };
    }

    const db = await BrainStore.get();
    let updated = 0;

    await db.exec("BEGIN TRANSACTION");
    try {
      for (const id of unique) {
        const mem = await db.get("SELECT id FROM brain_semantic WHERE id = ?", [id]);
        if (!mem) continue;
        await db.run(
          `INSERT OR IGNORE INTO brain_tags (memory_type, memory_id, tag) VALUES ('semantic', ?, 'pinned')`,
          [id],
        );
        await db.run(
          `UPDATE brain_semantic
           SET importance_score = MAX(importance_score, 0.95),
               tier = 'hot',
               last_accessed_at = datetime('now')
           WHERE id = ?`,
          [id],
        );
        updated++;
      }
      await db.exec("COMMIT");
    } catch {
      await db.exec("ROLLBACK");
      return { updated: 0, failed: unique.length };
    }

    return { updated, failed: unique.length - updated };
  }

  /**
   * Remove the pinned tag from many semantic memories in one transaction.
   */
  static async batchUnpin(ids: number[]): Promise<{ updated: number; failed: number }> {
    const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    if (unique.length === 0) {
      return { updated: 0, failed: 0 };
    }

    const db = await BrainStore.get();
    const placeholders = unique.map(() => "?").join(",");
    try {
      const result = await db.run(
        `DELETE FROM brain_tags
         WHERE memory_type = 'semantic' AND tag = 'pinned'
           AND memory_id IN (${placeholders})`,
        unique,
      );
      const updated = result.changes ?? 0;
      return { updated, failed: Math.max(0, unique.length - updated) };
    } catch {
      return { updated: 0, failed: unique.length };
    }
  }
}
