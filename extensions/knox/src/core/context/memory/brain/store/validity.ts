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

/** Default retrieve / channel scope over a semantic or episodic leaf. */
export function queryScopeSql(kind: "semantic" | "episodic", alias?: string): string {
  const parts = [liveRetrieveSql(alias), validAtSql(alias)];
  if (kind === "semantic") parts.push(notSupersededSql(alias));
  return parts.join(" AND ");
}
