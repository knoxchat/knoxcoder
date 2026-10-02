/** Tags and collections. */

import type {
  CollectionItem,
  MemoryCollection,
  MemoryTag
} from "../types.js";
import { get } from "./connection.js";
import { rowToCollection, rowToTag } from "./mappers.js";

// ── Tag Operations ─────────────────────────────────────────────────────────

export async function addTag(memoryType: string, memoryId: number, tag: string): Promise<number> {
  const db = await get();
  const result = await db.run(
    `INSERT OR IGNORE INTO brain_tags (memory_type, memory_id, tag) VALUES (?, ?, ?)`,
    [memoryType, memoryId, tag.toLowerCase().trim()],
  );
  return result.lastID!;
}

export async function removeTag(memoryType: string, memoryId: number, tag: string): Promise<boolean> {
  const db = await get();
  const result = await db.run(
    "DELETE FROM brain_tags WHERE memory_type = ? AND memory_id = ? AND tag = ?",
    [memoryType, memoryId, tag.toLowerCase().trim()],
  );
  return (result.changes ?? 0) > 0;
}

export async function getTagsForMemory(memoryType: string, memoryId: number): Promise<MemoryTag[]> {
  const db = await get();
  const rows = await db.all(
    "SELECT * FROM brain_tags WHERE memory_type = ? AND memory_id = ?",
    [memoryType, memoryId],
  );
  return rows.map(rowToTag);
}

export async function searchByTag(tag: string, memoryType?: string, limit: number = 50): Promise<MemoryTag[]> {
  const db = await get();
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
  return rows.map(rowToTag);
}

// ── Collection Operations ──────────────────────────────────────────────────

export async function createCollection(name: string, description: string = ""): Promise<number> {
  const db = await get();
  const result = await db.run(
    "INSERT INTO brain_collections (name, description) VALUES (?, ?)",
    [name, description],
  );
  return result.lastID!;
}

export async function listCollections(limit: number = 50): Promise<MemoryCollection[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT c.*, COUNT(ci.id) as item_count
     FROM brain_collections c
     LEFT JOIN brain_collection_items ci ON c.id = ci.collection_id
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(rowToCollection);
}

export async function addToCollection(collectionId: number, memoryType: string, memoryId: number): Promise<number> {
  const db = await get();
  const result = await db.run(
    `INSERT OR IGNORE INTO brain_collection_items (collection_id, memory_type, memory_id) VALUES (?, ?, ?)`,
    [collectionId, memoryType, memoryId],
  );
  await db.run("UPDATE brain_collections SET updated_at = datetime('now') WHERE id = ?", [collectionId]);
  return result.lastID!;
}

export async function getCollectionItems(collectionId: number): Promise<CollectionItem[]> {
  const db = await get();
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
