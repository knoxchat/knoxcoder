/** Learning patterns and procedural memory. */

import type {
  GoalType,
  LearningPattern,
  ProceduralMemory
} from "../types.js";
import { get } from "./connection.js";
import { rowToPattern, rowToProcedure } from "./mappers.js";

// ── Learning Pattern Operations ────────────────────────────────────────────

export async function addPattern(input: {
  goal_type: GoalType;
  pattern_signature: string;
  description: string;
  success: boolean;
  tokens_used: number;
  metadata: Record<string, any>;
}): Promise<number> {
  const db = await get();
  const result = await db.run(
    `INSERT INTO brain_learning_patterns (goal_type, pattern_signature, description, success_count, failure_count, confidence, avg_tokens_used, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.goal_type,
      input.pattern_signature,
      input.description,
      input.success ? 1 : 0,
      input.success ? 0 : 1,
      input.success ? 0.6 : 0.3,
      input.tokens_used,
      JSON.stringify(input.metadata),
    ],
  );
  return result.lastID!;
}

export async function findPattern(goalType: GoalType, signature: string): Promise<LearningPattern | null> {
  const db = await get();
  const row = await db.get(
    "SELECT * FROM brain_learning_patterns WHERE goal_type = ? AND pattern_signature = ?",
    [goalType, signature],
  );
  return row ? rowToPattern(row) : null;
}

export async function updatePatternStats(id: number, success: boolean, tokensUsed: number): Promise<void> {
  const db = await get();
  if (success) {
    await db.run(
      `UPDATE brain_learning_patterns SET
         success_count = success_count + 1,
         confidence = MIN(1.0, confidence + 0.05),
         avg_tokens_used = (avg_tokens_used * (success_count + failure_count) + ?) / (success_count + failure_count + 1),
         last_used_at = datetime('now')
       WHERE id = ?`,
      [tokensUsed, id],
    );
  } else {
    await db.run(
      `UPDATE brain_learning_patterns SET
         failure_count = failure_count + 1,
         confidence = MAX(0.0, confidence - 0.1),
         last_used_at = datetime('now')
       WHERE id = ?`,
      [id],
    );
  }
}

export async function getPatterns(goalType?: GoalType, limit: number = 20): Promise<LearningPattern[]> {
  const db = await get();
  const conditions: string[] = [];
  const params: any[] = [];

  if (goalType) {
    conditions.push("goal_type = ?");
    params.push(goalType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = await db.all(
    `SELECT * FROM brain_learning_patterns ${whereClause} ORDER BY confidence DESC, success_count DESC LIMIT ?`,
    params,
  );
  return rows.map(rowToPattern);
}

// ── Procedural Memory Operations ───────────────────────────────────────────

export async function addProcedure(input: {
  name: string;
  description: string;
  steps: string[];
  trigger_pattern: string;
  category: string;
}): Promise<number> {
  const db = await get();
  const result = await db.run(
    `INSERT INTO brain_procedures (name, description, steps, trigger_pattern, category)
     VALUES (?, ?, ?, ?, ?)`,
    [input.name, input.description, JSON.stringify(input.steps), input.trigger_pattern, input.category],
  );
  return result.lastID!;
}

export async function getProcedure(id: number): Promise<ProceduralMemory | null> {
  const db = await get();
  const row = await db.get("SELECT * FROM brain_procedures WHERE id = ?", [id]);
  return row ? rowToProcedure(row) : null;
}

export async function searchProcedures(query: string, limit: number = 10): Promise<ProceduralMemory[]> {
  const db = await get();
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const conditions: string[] = [];
  const params: any[] = [];

  if (terms.length > 0) {
    const termConditions = terms.map(() => "(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(trigger_pattern) LIKE ?)");
    conditions.push(`(${termConditions.join(" OR ")})`);
    for (const term of terms) {
      const like = `%${term}%`;
      params.push(like, like, like);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = await db.all(
    `SELECT * FROM brain_procedures ${whereClause} ORDER BY execution_count DESC, success_rate DESC LIMIT ?`,
    params,
  );
  return rows.map(rowToProcedure);
}

export async function getAllProcedures(category?: string, limit: number = 50): Promise<ProceduralMemory[]> {
  const db = await get();
  const conditions: string[] = [];
  const params: any[] = [];

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = await db.all(
    `SELECT * FROM brain_procedures ${whereClause} ORDER BY created_at DESC LIMIT ?`,
    params,
  );
  return rows.map(rowToProcedure);
}

export async function recordProcedureExecution(id: number, success: boolean): Promise<void> {
  const db = await get();
  await db.run(
    `UPDATE brain_procedures SET
       execution_count = execution_count + 1,
       success_rate = (success_rate * execution_count + ?) / (execution_count + 1),
       last_executed_at = datetime('now')
     WHERE id = ?`,
    [success ? 1.0 : 0.0, id],
  );
}
