/**
 * Load recipe stats for the MC-43/MC-48 health report from the live Memory Brain
 * sqlite and (optionally) the checkpoint audit JSONL. Editor-free: no vscode.
 */
import fs from "fs";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

import { summarizeRecipeMetrics, type RecipeMetricEventLike } from "../recipes/metrics";
import { gatherRecipeHealth, type RecipeHealth } from "./healthReport";

export function recipeHealthExtrasFromAuditJsonl(text: string): {
  skips: number;
  skipReasons: Record<string, number>;
  nearMisses: number;
  wrongApplyRate?: number;
} {
  const events: RecipeMetricEventLike[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RecipeMetricEventLike;
      if (parsed && typeof parsed.action === "string") events.push(parsed);
    } catch {
      // skip a corrupt line
    }
  }
  const metrics = summarizeRecipeMetrics(events);
  return {
    skips: metrics.skips,
    skipReasons: metrics.skipReasons,
    nearMisses: metrics.nearMisses,
    ...(metrics.attempts > 0 ? { wrongApplyRate: metrics.wrongApplyRate } : {}),
  };
}

/**
 * Read live recipe counts from `brain.sqlite`. Missing file / missing table →
 * `undefined` so the report stays "Not collected" instead of fake zeros.
 */
export async function loadRecipeHealthFromBrain(
  sqlitePath: string,
  auditEventsPath?: string,
): Promise<RecipeHealth | undefined> {
  if (!sqlitePath || !fs.existsSync(sqlitePath)) return undefined;
  let extras: { skips?: number; skipReasons?: Record<string, number>; nearMisses?: number; wrongApplyRate?: number } = {};
  if (auditEventsPath && fs.existsSync(auditEventsPath)) {
    try {
      extras = recipeHealthExtrasFromAuditJsonl(fs.readFileSync(auditEventsPath, "utf8"));
    } catch {
      extras = {};
    }
  }
  let db: Awaited<ReturnType<typeof open>> | undefined;
  try {
    db = await open({
      filename: sqlitePath,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY,
    });
  } catch {
    return undefined;
  }
  try {
    const rows = (await db.all(
      `SELECT status, memory_id, replay_count, reverted_count, failed_verify_count
       FROM brain_recipes WHERE status != 'retired'`,
    )) as Array<{
      status?: string;
      memory_id?: number | null;
      replay_count?: number | null;
      reverted_count?: number | null;
      failed_verify_count?: number | null;
    }>;
    return gatherRecipeHealth(
      rows.map((row) => ({
        status: String(row.status ?? ""),
        memoryId: row.memory_id == null ? undefined : Number(row.memory_id),
        stats: {
          replays: Number(row.replay_count ?? 0),
          reverted: Number(row.reverted_count ?? 0),
          failedVerify: Number(row.failed_verify_count ?? 0),
        },
      })),
      extras,
    );
  } catch {
    return undefined;
  } finally {
    await db.close().catch(() => undefined);
  }
}
