/** Knowledge-graph entities and edges. MEM-26: aliases + validity. */

import { isValidAt } from "../entityResolution.js";
import { entitySearchTerms, requiresBoundedEntityMatch } from "../GraphRetrieval.js";
import type {
  AddEdgeInput,
  EntityType,
  GraphEdge,
  GraphEntity
} from "../types.js";
import { get } from "./connection.js";
import { rowToEdge, rowToEntity } from "./mappers.js";
import { validAtSql } from "./validity.js";

export type AddEntityRow = {
  name: string;
  entity_type: EntityType;
  description: string;
  properties: Record<string, any>;
  confidence: number;
  canonical_id?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
};

// ── Knowledge Graph: Entity Operations ─────────────────────────────────────

export async function addEntity(input: AddEntityRow): Promise<number> {
  const db = await get();
  const result = await db.run(
    `INSERT INTO brain_entities
       (name, entity_type, description, properties, confidence, canonical_id, valid_from, valid_to)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
    [
      input.name,
      input.entity_type,
      input.description,
      JSON.stringify(input.properties),
      input.confidence,
      input.canonical_id ?? null,
      input.valid_from ?? null,
      input.valid_to ?? null,
    ],
  );
  return result.lastID!;
}

export async function countEntities(): Promise<number> {
  const db = await get();
  const row = await db.get("SELECT COUNT(*) as c FROM brain_entities") as any;
  return row?.c ?? 0;
}

/**
 * Leftover surface. Not a capacity policy (MEM-25): never DELETE entities.
 * Disk budget is `max_bytes` on the sqlite file; aliases merge via canonical_id
 * (MEM-26). LRU-on-mention stays a cache hint on the entity row itself.
 */
export async function pruneEntities(_count: number): Promise<number> {
  return 0;
}

export async function getEntity(id: number): Promise<GraphEntity | null> {
  const db = await get();
  const row = await db.get("SELECT * FROM brain_entities WHERE id = ?", [id]);
  return row ? rowToEntity(row) : null;
}

export async function getEntitiesByIds(ids: number[]): Promise<GraphEntity[]> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return [];
  const db = await get();
  const placeholders = unique.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT * FROM brain_entities WHERE id IN (${placeholders})`,
    unique,
  );
  return rows.map(rowToEntity);
}

export async function findEntity(normalizedName: string, entityType: EntityType): Promise<GraphEntity | null> {
  const db = await get();
  const row = await db.get(
    "SELECT * FROM brain_entities WHERE LOWER(name) = ? AND entity_type = ?",
    [normalizedName, entityType],
  );
  return row ? rowToEntity(row) : null;
}

export async function findEntitiesByNames(
  normalizedNames: string[],
  entityType: EntityType,
): Promise<GraphEntity[]> {
  const unique = [...new Set(normalizedNames.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return [];
  const db = await get();
  const placeholders = unique.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT * FROM brain_entities
     WHERE entity_type = ? AND LOWER(name) IN (${placeholders})`,
    [entityType, ...unique],
  );
  return rows.map(rowToEntity);
}

export async function resolveCanonicalId(id: number): Promise<number> {
  const seen = new Set<number>();
  let current = id;
  while (Number.isFinite(current) && current > 0 && !seen.has(current)) {
    seen.add(current);
    const row = await getEntity(current);
    if (!row) return current;
    const next = row.canonical_id;
    if (next == null || next === current) return current;
    current = next;
  }
  return current;
}

export async function listEntityCluster(id: number): Promise<GraphEntity[]> {
  const canonicalId = await resolveCanonicalId(id);
  const db = await get();
  const rows = await db.all(
    `SELECT * FROM brain_entities WHERE id = ? OR canonical_id = ?`,
    [canonicalId, canonicalId],
  );
  return rows.map(rowToEntity);
}

export async function listEntityClusterIds(id: number): Promise<number[]> {
  const cluster = await listEntityCluster(id);
  if (cluster.length === 0) return [id];
  return [...new Set(cluster.map((row) => row.id))];
}

export async function setEntityCanonical(id: number, canonicalId: number | null): Promise<void> {
  const db = await get();
  const value = canonicalId == null || canonicalId === id ? null : canonicalId;
  await db.run(
    "UPDATE brain_entities SET canonical_id = ?, updated_at = datetime('now') WHERE id = ?",
    [value, id],
  );
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

export async function updateEntity(
  id: number,
  updates: Partial<Pick<GraphEntity, "description" | "properties" | "confidence" | "canonical_id" | "valid_from" | "valid_to">>,
): Promise<void> {
  const db = await get();
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];

  if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
  if (updates.properties !== undefined) { sets.push("properties = ?"); params.push(typeof updates.properties === "string" ? updates.properties : JSON.stringify(updates.properties)); }
  if (updates.confidence !== undefined) { sets.push("confidence = ?"); params.push(updates.confidence); }
  if (updates.canonical_id !== undefined) { sets.push("canonical_id = ?"); params.push(updates.canonical_id); }
  if (updates.valid_from !== undefined) { sets.push("valid_from = ?"); params.push(updates.valid_from); }
  if (updates.valid_to !== undefined) { sets.push("valid_to = ?"); params.push(updates.valid_to); }

  params.push(id);
  await db.run(`UPDATE brain_entities SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function searchEntities(query: string, entityType?: EntityType, limit: number = 20): Promise<GraphEntity[]> {
  const db = await get();
  const trimmed = (query ?? "").trim();
  const terms = trimmed ? entitySearchTerms(trimmed) : [];
  const conditions: string[] = [validAtSql()];
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
  params.push(Math.max(limit * 3, limit));

  const rows = await db.all(
    `SELECT * FROM brain_entities ${whereClause} ORDER BY mention_count DESC, confidence DESC LIMIT ?`,
    params,
  );
  return collapseToCanonical(rows.map(rowToEntity), limit);
}

async function collapseToCanonical(entities: GraphEntity[], limit: number): Promise<GraphEntity[]> {
  const seen = new Set<number>();
  const out: GraphEntity[] = [];
  for (const entity of entities) {
    const canonicalId = entity.canonical_id && entity.canonical_id !== entity.id
      ? entity.canonical_id
      : entity.id;
    if (seen.has(canonicalId)) continue;
    seen.add(canonicalId);
    if (canonicalId === entity.id) {
      out.push(entity);
    } else {
      const canonical = await getEntity(canonicalId);
      out.push(canonical && isValidAt(canonical) ? canonical : entity);
    }
    if (out.length >= limit) break;
  }
  return out;
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
    `INSERT INTO brain_graph_edges
       (source_entity_id, target_entity_id, relationship, weight, properties, valid_from, valid_to)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
    [
      input.source_entity_id,
      input.target_entity_id,
      input.relationship,
      input.weight ?? 0.5,
      JSON.stringify(input.properties ?? {}),
      input.valid_from ?? null,
      input.valid_to ?? null,
    ],
  );
  return result.lastID!;
}

export async function findEdge(sourceId: number, targetId: number, relationship: string): Promise<GraphEdge | null> {
  const srcCluster = await listEntityClusterIds(sourceId);
  const tgtCluster = await listEntityClusterIds(targetId);
  if (srcCluster.length === 0 || tgtCluster.length === 0) return null;
  const db = await get();
  const srcPh = srcCluster.map(() => "?").join(",");
  const tgtPh = tgtCluster.map(() => "?").join(",");
  const row = await db.get(
    `SELECT * FROM brain_graph_edges
     WHERE relationship = ?
       AND ${validAtSql()}
       AND (
         (source_entity_id IN (${srcPh}) AND target_entity_id IN (${tgtPh}))
         OR (source_entity_id IN (${tgtPh}) AND target_entity_id IN (${srcPh}))
       )`,
    [relationship, ...srcCluster, ...tgtCluster, ...tgtCluster, ...srcCluster],
  );
  return row ? rowToEdge(row) : null;
}

export async function updateEdgeWeight(id: number, weight: number): Promise<void> {
  const db = await get();
  await db.run("UPDATE brain_graph_edges SET weight = ? WHERE id = ?", [weight, id]);
}

export async function getEntityEdges(
  entityId: number,
  options?: { cluster?: boolean; validOnly?: boolean },
): Promise<GraphEdge[]> {
  const cluster = options?.cluster === false
    ? [entityId]
    : await listEntityClusterIds(entityId);
  if (cluster.length === 0) return [];
  const db = await get();
  const placeholders = cluster.map(() => "?").join(",");
  const valid = options?.validOnly === false ? "" : ` AND ${validAtSql()}`;
  const rows = await db.all(
    `SELECT * FROM brain_graph_edges
     WHERE (source_entity_id IN (${placeholders}) OR target_entity_id IN (${placeholders}))
     ${valid}
     ORDER BY weight DESC`,
    [...cluster, ...cluster],
  );
  return rows.map(rowToEdge);
}

export async function getEdgesAmong(ids: number[]): Promise<GraphEdge[]> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  if (unique.length === 0) return [];
  const cluster = new Set<number>();
  const canonicalOf = new Map<number, number>();
  for (const id of unique) {
    const canon = await resolveCanonicalId(id);
    canonicalOf.set(id, canon);
    for (const member of await listEntityClusterIds(id)) {
      cluster.add(member);
      canonicalOf.set(member, canon);
    }
  }
  const members = [...cluster];
  const db = await get();
  const placeholders = members.map(() => "?").join(",");
  const rows = await db.all(
    `SELECT * FROM brain_graph_edges
     WHERE source_entity_id IN (${placeholders})
       AND target_entity_id IN (${placeholders})
       AND ${validAtSql()}`,
    [...members, ...members],
  );
  const shown = new Set(unique.map((id) => canonicalOf.get(id) ?? id));
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const edge of rows.map(rowToEdge)) {
    const src = canonicalOf.get(edge.source_entity_id) ?? edge.source_entity_id;
    const tgt = canonicalOf.get(edge.target_entity_id) ?? edge.target_entity_id;
    if (!shown.has(src) || !shown.has(tgt) || src === tgt) continue;
    const key = src < tgt
      ? `${src}:${edge.relationship}:${tgt}`
      : `${tgt}:${edge.relationship}:${src}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...edge,
      source_entity_id: src,
      target_entity_id: tgt,
    });
  }
  return out;
}

export async function getGraphStats(): Promise<{ entities: number; edges: number; entityTypes: Record<string, number> }> {
  const db = await get();
  const entityCount = await db.get(
    `SELECT COUNT(DISTINCT COALESCE(canonical_id, id)) as c
     FROM brain_entities WHERE ${validAtSql()}`,
  );
  const edgeCount = await db.get(
    `SELECT COUNT(*) as c FROM brain_graph_edges WHERE ${validAtSql()}`,
  );
  const typeCounts = await db.all(
    `SELECT entity_type, COUNT(DISTINCT COALESCE(canonical_id, id)) as c
     FROM brain_entities
     WHERE ${validAtSql()}
     GROUP BY entity_type`,
  );

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
