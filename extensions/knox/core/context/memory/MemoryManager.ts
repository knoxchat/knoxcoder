import fs from "fs";
import path from "path";

import { getDevDataPath } from "../../util/paths.js";

import { BrainManager } from "./brain/BrainManager.js";
import { BrainStore } from "./brain/BrainStore.js";
import { MemoryStore } from "./MemoryStore.js";

import type { SemanticCategory } from "./brain/types.js";
import type {
  MemoryCategory,
  MemoryCreateInput,
  MemoryItem,
  MemoryQuery,
} from "./types.js";

/** Legacy project-memory categories mapped onto Brain semantic categories. */
const LEGACY_TO_BRAIN: Record<MemoryCategory, SemanticCategory> = {
  convention: "code_pattern",
  "fix-pattern": "error_fix",
  "project-fact": "project_context",
  "user-note": "fact",
};

const BRAIN_TO_LEGACY: Partial<Record<SemanticCategory, MemoryCategory>> = {
  code_pattern: "convention",
  error_fix: "fix-pattern",
  project_context: "project-fact",
  fact: "user-note",
};

/**
 * MemoryManager provides the legacy public API for the project memory system.
 *
 * It is now a thin adapter over the Memory Brain (BrainStore/BrainManager) so
 * that `@memory`, the `memory/*` protocol, and the Brain all share one
 * database (~/.knox/memory/brain.sqlite). Rows from the old standalone store
 * (~/.knox/dev_data/memory.sqlite) are migrated into the Brain once on first
 * use; the legacy file is left untouched as a backup.
 */
export class MemoryManager {
  private static migrationPromise: Promise<void> | null = null;

  // ── Legacy Store Migration ─────────────────────────────────────────────────

  private static ensureLegacyMigrated(): Promise<void> {
    if (!MemoryManager.migrationPromise) {
      MemoryManager.migrationPromise = MemoryManager.migrateLegacyStore().catch(
        (err) => {
          console.warn("[Memory] Legacy memory migration failed:", err);
        },
      );
    }
    return MemoryManager.migrationPromise;
  }

  private static async migrateLegacyStore(): Promise<void> {
    const legacyPath = path.join(getDevDataPath(), "memory.sqlite");
    if (!fs.existsSync(legacyPath)) return;

    const db = await BrainStore.get();
    const done = await db.get(
      `SELECT value FROM brain_config WHERE key = 'legacy_memory_migrated'`,
    );
    if ((done as any)?.value === "true") return;

    const items = await MemoryStore.listAll(10000);
    let migrated = 0;
    for (const item of items) {
      try {
        await BrainManager.store({
          category: LEGACY_TO_BRAIN[item.category] ?? "fact",
          title: item.title,
          content: item.content,
          keywords: MemoryManager.withSourceKeyword(item.keywords, item.source),
          importance: item.relevanceScore,
          ttl_days: item.expiresAt
            ? Math.max(
                1,
                Math.ceil(
                  (new Date(item.expiresAt).getTime() - Date.now()) / 86400000,
                ),
              )
            : null,
        });
        migrated++;
      } catch {
        // Skip rows rejected by the sanitizer or duplicate detection
      }
    }

    await db.run(
      `INSERT INTO brain_config (key, value, updated_at)
       VALUES ('legacy_memory_migrated', 'true', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = datetime('now')`,
    );
    if (migrated > 0) {
      console.log(
        `[Memory] Migrated ${migrated} legacy memories into the Memory Brain`,
      );
    }
  }

  private static withSourceKeyword(keywords: string, source: string): string {
    if (!source) return keywords;
    const sourceTag = `source:${source}`;
    return keywords ? `${keywords}, ${sourceTag}` : sourceTag;
  }

  // ── Public API (legacy shape, Brain-backed) ────────────────────────────────

  /**
   * Store a new memory.
   */
  static async remember(input: MemoryCreateInput): Promise<number> {
    await MemoryManager.ensureLegacyMigrated();
    return BrainManager.store({
      category: LEGACY_TO_BRAIN[input.category] ?? "fact",
      title: input.title,
      content: input.content,
      keywords: MemoryManager.withSourceKeyword(
        input.keywords ?? "",
        input.source,
      ),
      importance: input.relevanceScore ?? 0.5,
      ttl_days: input.ttlDays ?? null,
    });
  }

  /**
   * Search memories by query.
   */
  static async recall(query: MemoryQuery): Promise<MemoryItem[]> {
    await MemoryManager.ensureLegacyMigrated();

    const trimmed = query.query?.trim() ?? "";
    if (!trimmed) {
      return MemoryManager.listAll(query.limit ?? 10);
    }

    const result = await BrainManager.recall({
      query: trimmed,
      category: query.category
        ? LEGACY_TO_BRAIN[query.category]
        : undefined,
      limit: query.limit ?? 10,
      include_episodic: false,
    });
    return (result?.semantic ?? []).map(MemoryManager.semanticToItem);
  }

  /**
   * Delete a memory by ID.
   */
  static async forget(id: number): Promise<boolean> {
    await MemoryManager.ensureLegacyMigrated();
    return BrainManager.forget(id);
  }

  /**
   * List all memories.
   */
  static async listAll(limit = 100): Promise<MemoryItem[]> {
    await MemoryManager.ensureLegacyMigrated();
    const db = await BrainStore.get();
    const rows = await db.all(
      `SELECT * FROM brain_semantic
       WHERE (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
    );
    return (rows ?? []).map(MemoryManager.semanticToItem);
  }

  /**
   * Remove expired memories.
   */
  static async cleanup(): Promise<number> {
    await MemoryManager.ensureLegacyMigrated();
    const db = await BrainStore.get();
    const result = await db.run(
      `DELETE FROM brain_semantic
       WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`,
    );
    return result.changes ?? 0;
  }

  private static semanticToItem(mem: any): MemoryItem {
    return {
      id: mem.id,
      category: BRAIN_TO_LEGACY[mem.category as SemanticCategory] ?? "project-fact",
      title: mem.title,
      content: mem.content,
      source: mem.source_session_id ?? "brain",
      relevanceScore: mem.importance_score ?? 0.5,
      keywords: mem.keywords ?? "",
      retrievalCount: mem.retrieval_count ?? 0,
      createdAt: mem.created_at,
      lastAccessedAt: mem.last_accessed_at,
      expiresAt: mem.expires_at ?? null,
    };
  }

  /**
   * Auto-extract a convention from a task description and files modified.
   * Called after successful task completion.
   */
  static async extractConvention(
    taskDescription: string,
    filesModified: string[],
  ): Promise<number | null> {
    // Extract naming convention patterns
    const fileExtensions = new Set(
      filesModified
        .map((f) => {
          const dot = f.lastIndexOf(".");
          return dot > 0 ? f.substring(dot) : "";
        })
        .filter(Boolean),
    );

    const directories = new Set(
      filesModified
        .map((f) => {
          const slash = f.lastIndexOf("/");
          return slash > 0 ? f.substring(0, slash) : "";
        })
        .filter(Boolean),
    );

    const keywords = [
      ...Array.from(fileExtensions),
      ...Array.from(directories).map((d) => d.split("/").pop() || ""),
    ]
      .filter(Boolean)
      .join(", ");

    if (!keywords) return null;

    return MemoryManager.remember({
      category: "project-fact",
      title: `Task: ${taskDescription.substring(0, 80)}`,
      content: `Files modified: ${filesModified.join(", ")}\nFile types: ${Array.from(fileExtensions).join(", ")}\nDirectories: ${Array.from(directories).join(", ")}`,
      source: "auto-extract",
      keywords,
      relevanceScore: 0.4,
      ttlDays: 90, // Auto-extracted facts expire after 90 days
    });
  }

  /**
   * Record a successful fix pattern for future reuse.
   */
  static async recordFixPattern(
    errorSignature: string,
    fixDescription: string,
    filesAffected: string[],
  ): Promise<number> {
    return MemoryManager.remember({
      category: "fix-pattern",
      title: `Fix: ${errorSignature.substring(0, 80)}`,
      content: `Error: ${errorSignature}\nFix: ${fixDescription}\nFiles: ${filesAffected.join(", ")}`,
      source: "auto-extract",
      keywords: errorSignature
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 10)
        .join(", "),
      relevanceScore: 0.7,
      ttlDays: null, // Fix patterns are permanent
    });
  }
}
