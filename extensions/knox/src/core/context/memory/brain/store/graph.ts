/** Knowledge-graph entities and edges. */

import { entitySearchTerms, requiresBoundedEntityMatch } from "../GraphRetrieval.js";
import type {
  AddEdgeInput,
  EntityType,
  GraphEdge,
  GraphEntity
} from "../types.js";
import { get } from "./connection.js";
import { rowToEdge, rowToEntity } from "./mappers.js";

// ── Knowledge Graph: Entity Operations ─────────────────────────────────────

export async function addEntity(input: {
  name: string;
  entity_type: EntityType;
  description: string;
  properties: Record<string, any>;
  confidence: number;
}): Promise<number> {
  const db = await get();
  const result = await db.run(
    `INSERT INTO brain_entities (name, entity_type, description, properties, confidence)
     VALUES (?, ?, ?, ?, ?)`,
    [input.name, input.entity_type, input.description, JSON.stringify(input.properties), input.confidence],
  );
  return result.lastID!;
}

export async function countEntities(): Promise<number> {
  const db = await get();
  const row = await db.get("SELECT COUNT(*) as c FROM brain_entities") as any;
  return row?.c ?? 0;
}

/**
 * Remove lowest-value entities (low mention_count, oldest updated_at).
 */
export async function pruneEntities(count: number): Promise<number> {
  if (count <= 0) return 0;
  const db = await get();
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

export async function getEntity(id: number): Promise<GraphEntity | null> {
  const db = await get();
  const row = await db.get("SELECT * FROM brain_entities WHERE id = ?", [id]);
  return row ? rowToEntity(row) : null;
}

export async function findEntity(normalizedName: string, entityType: EntityType): Promise<GraphEntity | null> {
  const db = await get();
  const row = await db.get(
    "SELECT * FROM brain_entities WHERE LOWER(name) = ? AND entity_type = ?",
    [normalizedName, entityType],
  );
  return row ? rowToEntity(row) : null;
}

export async function incrementEntityMention(id: number): Promise<void> {
  await touchEntity(id, { incrementMention: true });
}

/** LRU refresh — bump updated_at (and optionally mention_count). IMP-11 */
export async function touchEntity(
  id: number,
  options?: { incrementMention?: boolean },
): Promise<void> {
  const db = await get();
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

export async function updateEntity(id: number, updates: Partial<Pick<GraphEntity, "description" | "properties" | "confidence">>): Promise<void> {
  const db = await get();
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];

  if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
  if (updates.properties !== undefined) { sets.push("properties = ?"); params.push(typeof updates.properties === "string" ? updates.properties : JSON.stringify(updates.properties)); }
  if (updates.confidence !== undefined) { sets.push("confidence = ?"); params.push(updates.confidence); }

  params.push(id);
  await db.run(`UPDATE brain_entities SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function searchEntities(query: string, entityType?: EntityType, limit: number = 20): Promise<GraphEntity[]> {
  const db = await get();
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
  return rows.map(rowToEntity);
}

/**
 * Paginated entity browse for the dashboard. Unlike searchEntities this is a
 * plain substring filter with no retrieval heuristics and no LRU touch, so
 * browsing the UI does not affect pruning order.
 */
export async function listEntities(options: {
  query?: string;
  entityType?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ entities: (GraphEntity & { edge_count: number })[]; total: number }> {
  const db = await get();
  const limit = Math.max(1, Math.min(500, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.entityType) {
    conditions.push("e.entity_type = ?");
    params.push(options.entityType);
  }
  const q = (options.query ?? "").trim().toLowerCase();
  if (q && q !== "*") {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push("(LOWER(e.name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(e.description, '')) LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const totalRow = await db.get(
    `SELECT COUNT(*) as c FROM brain_entities e ${whereClause}`,
    params,
  ) as any;
  const rows = await db.all(
    `SELECT e.*,
            (SELECT COUNT(*) FROM brain_graph_edges g
              WHERE g.source_entity_id = e.id OR g.target_entity_id = e.id) AS edge_count
     FROM brain_entities e ${whereClause}
     ORDER BY e.mention_count DESC, e.updated_at DESC, e.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return {
    entities: rows.map((row: any) => ({
      ...rowToEntity(row),
      edge_count: row.edge_count ?? 0,
    })),
    total: totalRow?.c ?? 0,
  };
}

export async function deleteEntity(id: number): Promise<boolean> {
  const db = await get();
  // Also delete connected edges
  await db.run("DELETE FROM brain_graph_edges WHERE source_entity_id = ? OR target_entity_id = ?", [id, id]);
  const result = await db.run("DELETE FROM brain_entities WHERE id = ?", [id]);
  return (result.changes ?? 0) > 0;
}

// ── Knowledge Graph: Edge Operations ───────────────────────────────────────

export async function addEdge(input: AddEdgeInput): Promise<number> {
  const db = await get();
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

export async function findEdge(sourceId: number, targetId: number, relationship: string): Promise<GraphEdge | null> {
  const db = await get();
  const row = await db.get(
    `SELECT * FROM brain_graph_edges
     WHERE ((source_entity_id = ? AND target_entity_id = ?) OR (source_entity_id = ? AND target_entity_id = ?))
     AND relationship = ?`,
    [sourceId, targetId, targetId, sourceId, relationship],
  );
  return row ? rowToEdge(row) : null;
}

export async function updateEdgeWeight(id: number, weight: number): Promise<void> {
  const db = await get();
  await db.run("UPDATE brain_graph_edges SET weight = ? WHERE id = ?", [weight, id]);
}

export async function getEntityEdges(entityId: number): Promise<GraphEdge[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT * FROM brain_graph_edges
     WHERE source_entity_id = ? OR target_entity_id = ?
     ORDER BY weight DESC`,
    [entityId, entityId],
  );
  return rows.map(rowToEdge);
}

export async function getGraphStats(): Promise<{ entities: number; edges: number; entityTypes: Record<string, number> }> {
  const db = await get();
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
