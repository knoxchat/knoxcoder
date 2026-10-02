/** Cross-memory association edges. */

import type {
  AssociateInput,
  MemoryAssociation
} from "../types.js";
import { get } from "./connection.js";
import { rowToAssociation } from "./mappers.js";

// ── Association Operations ─────────────────────────────────────────────────

export async function createAssociation(input: AssociateInput): Promise<number> {
  const db = await get();
  const result = await db.run(
    `INSERT INTO brain_associations (source_type, source_id, target_type, target_id, relationship, strength)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.source_type, input.source_id, input.target_type, input.target_id, input.relationship, input.strength ?? 0.5],
  );
  return result.lastID!;
}

export async function getAssociations(type: "episodic" | "semantic", id: number): Promise<MemoryAssociation[]> {
  const db = await get();
  const rows = await db.all(
    `SELECT * FROM brain_associations
     WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)
     ORDER BY strength DESC`,
    [type, id, type, id],
  );
  return rows.map(rowToAssociation);
}
