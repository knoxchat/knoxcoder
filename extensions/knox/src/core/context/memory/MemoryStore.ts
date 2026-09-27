import fs from "fs";
import path from "path";

import { open } from "sqlite";
import sqlite3 from "sqlite3";

import { DatabaseConnection } from "../../util/refreshIndex.js";
import { getDevDataPath } from "../../util/paths.js";

import type { MemoryItem, MemoryCreateInput, MemoryQuery, MemoryCategory } from "./types.js";

/**
 * SQLite-backed persistent memory store.
 * Stores learned facts, conventions, fix patterns, and user notes.
 * Data lives at ~/.knox/dev_data/memory.sqlite.
 */
export class MemoryStore {
  private static db: DatabaseConnection | null = null;

  private static getDbPath(): string {
    return path.join(getDevDataPath(), "memory.sqlite");
  }

  private static async createTables(db: DatabaseConnection): Promise<void> {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        relevance_score REAL NOT NULL DEFAULT 0.5,
        keywords TEXT NOT NULL DEFAULT '',
        retrieval_count INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME DEFAULT NULL
      )
    `);

    // Index for keyword search
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_keywords ON memories(keywords)
    `);
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)
    `);
  }

  static async get(): Promise<DatabaseConnection> {
    const dbPath = MemoryStore.getDbPath();
    if (MemoryStore.db && fs.existsSync(dbPath)) {
      return MemoryStore.db;
    }

    MemoryStore.db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    await MemoryStore.db.exec("PRAGMA busy_timeout = 3000;");
    await MemoryStore.createTables(MemoryStore.db);

    return MemoryStore.db;
  }

  /**
   * Add a new memory item.
   */
  static async create(input: MemoryCreateInput): Promise<number> {
    const db = await MemoryStore.get();

    const expiresAt = input.ttlDays
      ? new Date(Date.now() + input.ttlDays * 86400000).toISOString()
      : null;

    const result = await db.run(
      `INSERT INTO memories (category, title, content, source, relevance_score, keywords, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.category,
        input.title,
        input.content,
        input.source,
        input.relevanceScore ?? 0.5,
        input.keywords ?? "",
        expiresAt,
      ],
    );

    return result.lastID!;
  }

  /**
   * Search memories by keyword matching against title, content, and keywords fields.
   * Results are ranked by a combination of text relevance and stored relevance score.
   */
  static async search(query: MemoryQuery): Promise<MemoryItem[]> {
    const db = await MemoryStore.get();

    const terms = query.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    if (terms.length === 0 && !query.category) {
      // Return recent memories
      const rows = await db.all(
        `SELECT * FROM memories
         WHERE (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY last_accessed_at DESC
         LIMIT ?`,
        [query.limit ?? 10],
      );
      return rows.map(MemoryStore.rowToItem);
    }

    // Build WHERE clause
    const conditions: string[] = [
      "(expires_at IS NULL OR expires_at > datetime('now'))",
    ];
    const params: any[] = [];

    if (query.category) {
      conditions.push("category = ?");
      params.push(query.category);
    }

    if (terms.length > 0) {
      // Match any term in title, content, or keywords
      const termConditions = terms.map(() =>
        "(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)",
      );
      conditions.push(`(${termConditions.join(" OR ")})`);
      for (const term of terms) {
        const like = `%${term}%`;
        params.push(like, like, like);
      }
    }

    const sql = `
      SELECT * FROM memories
      WHERE ${conditions.join(" AND ")}
      ORDER BY relevance_score DESC, last_accessed_at DESC
      LIMIT ?
    `;
    params.push(query.limit ?? 10);

    const rows = await db.all(sql, params);

    // Update retrieval count and last_accessed_at for returned items
    if (rows.length > 0) {
      const ids = rows.map((r: any) => r.id).join(",");
      await db.exec(`
        UPDATE memories
        SET retrieval_count = retrieval_count + 1,
            last_accessed_at = datetime('now')
        WHERE id IN (${ids})
      `);
    }

    return rows.map(MemoryStore.rowToItem);
  }

  /**
   * Delete a memory by ID.
   */
  static async delete(id: number): Promise<boolean> {
    const db = await MemoryStore.get();
    const result = await db.run("DELETE FROM memories WHERE id = ?", [id]);
    return (result.changes ?? 0) > 0;
  }

  /**
   * Delete expired memories (cleanup).
   */
  static async pruneExpired(): Promise<number> {
    const db = await MemoryStore.get();
    const result = await db.run(
      "DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < datetime('now')",
    );
    return result.changes ?? 0;
  }

  /**
   * Get all memories (for management UI).
   */
  static async listAll(limit = 100): Promise<MemoryItem[]> {
    const db = await MemoryStore.get();
    const rows = await db.all(
      `SELECT * FROM memories
       WHERE (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map(MemoryStore.rowToItem);
  }

  private static rowToItem(row: any): MemoryItem {
    return {
      id: row.id,
      category: row.category as MemoryCategory,
      title: row.title,
      content: row.content,
      source: row.source,
      relevanceScore: row.relevance_score,
      keywords: row.keywords,
      retrievalCount: row.retrieval_count,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      expiresAt: row.expires_at,
    };
  }
}
