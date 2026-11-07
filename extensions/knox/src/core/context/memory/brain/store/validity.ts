/**
 * MEM-26 — SQL fragments for validity intervals and supersessions.
 *
 * Ω(q) = live (not tombstoned / not frozen) ∩ valid-at-now ∩ not superseded.
 * Direct id lookup does not use these filters; old rows stay queryable.
 */

import { liveRetrieveSql } from "./tombstone.js";

/**
 * Open interval. NULL bounds are unbounded. `valid_to` is exclusive so a
 * just-closed fact (`valid_to = datetime('now')`) leaves default retrieve.
 */
export function validAtSql(alias?: string): string {
  const col = alias ? `${alias}.` : "";
  return `(${col}valid_from IS NULL OR datetime(${col}valid_from) <= datetime('now'))
      AND (${col}valid_to IS NULL OR datetime(${col}valid_to) > datetime('now'))`;
}

export function notSupersededSql(alias?: string): string {
  const col = alias ? `${alias}.` : "";
  return `${col}id NOT IN (SELECT old_id FROM brain_memory_supersessions)`;
}

/**
 * MEM-50 — bitemporal predicate.
 *
 *   asOf    valid time: the fact was true at this instant.
 *   knownAt transaction time: Knox-MS had learned the fact by this instant
 *           (and had not yet learned that it was closed, see `closed_at`).
 *
 * `knownAt` defaults to `asOf`'s "now" (no transaction-time filter). Both are
 * bound as parameters, never interpolated. Superseded rows stay in range for a
 * past `asOf`, which is the point of as-of mode (MEM-65).
 */
export interface BitemporalQuery {
  /** ISO / sqlite datetime. Default: now. */
  asOf?: string;
  /** ISO / sqlite datetime. Default: no transaction-time filter. */
  knownAt?: string;
}

export function bitemporalSql(
  query: BitemporalQuery = {},
  alias?: string,
): { sql: string; params: string[] } {
  const col = alias ? `${alias}.` : "";
  const asOf = query.asOf ?? null;
  const knownAt = query.knownAt ?? null;
  const params: string[] = [];
  const at = asOf ? "datetime(?)" : "datetime('now')";
  const parts: string[] = [];

  if (asOf) params.push(asOf);
  parts.push(`(${col}valid_from IS NULL OR datetime(${col}valid_from) <= ${at})`);

  if (asOf) params.push(asOf);
  if (knownAt) {
    // valid_to counts only once the closure itself was known (closed_at <= knownAt).
    params.push(knownAt);
    parts.push(
      `(${col}valid_to IS NULL OR datetime(${col}valid_to) > ${at}` +
        ` OR (${col}closed_at IS NOT NULL AND datetime(${col}closed_at) > datetime(?)))`,
    );
    params.push(knownAt);
    parts.push(`(${col}recorded_at IS NULL OR datetime(${col}recorded_at) <= datetime(?))`);
  } else {
    parts.push(`(${col}valid_to IS NULL OR datetime(${col}valid_to) > ${at})`);
  }
  return { sql: parts.join(" AND "), params };
}

/**
 * Default retrieve / channel scope over a semantic or episodic leaf.
 * MEM-65: pass `asOf` to include superseded facts that were valid then.
 */
export function queryScopeClause(
  kind: "semantic" | "episodic",
  alias?: string,
  temporal: BitemporalQuery = {},
): { sql: string; params: string[] } {
  const live = liveRetrieveSql(alias);
  if (temporal.asOf) {
    const t = bitemporalSql(temporal, alias);
    return { sql: `${live} AND ${t.sql}`, params: t.params };
  }
  const parts = [live, validAtSql(alias)];
  if (kind === "semantic") parts.push(notSupersededSql(alias));
  return { sql: parts.join(" AND "), params: [] };
}

/** Default retrieve (valid now, not superseded). For as-of mode use {@link queryScopeClause}. */
export function queryScopeSql(kind: "semantic" | "episodic", alias?: string): string {
  return queryScopeClause(kind, alias).sql;
}
