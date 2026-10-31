/**
 * Read `brain_attribution` and the live θ / w_s knobs from Memory Brain sqlite.
 * Editor-free: no vscode. Missing file / table → undefined.
 */
import fs from "fs";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

import {
  CALIBRATED_THETA_DEFAULT,
  emptyChannelWeights,
  type AttributionRefitInput,
  type ChannelWeights,
} from "../brain/memoryOutcomes";
import type { AttributionSample } from "./attributionStats";

export interface BrainAttributionDump {
  rows: AttributionSample[];
  current: AttributionRefitInput;
}

function readNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseWeights(byKey: Map<string, string>): ChannelWeights {
  const weights = emptyChannelWeights();
  for (const channel of ["lexical", "ripgrep", "graph", "tree"] as const) {
    const raw = byKey.get(`w_${channel}`);
    if (raw == null) continue;
    weights[channel] = readNumber(raw, weights[channel]);
  }
  return weights;
}

function parseTheta(byKey: Map<string, string>): number {
  const raw = byKey.get("calibrated_theta") ?? byKey.get("retrieval_threshold");
  return raw == null ? CALIBRATED_THETA_DEFAULT : readNumber(raw, CALIBRATED_THETA_DEFAULT);
}

/**
 * Load attribution rows plus the current fitted θ / w_s. Empty log is a
 * dump with `rows: []`, not undefined — the caller can still see knobs.
 */
export async function loadAttributionFromBrain(
  sqlitePath: string,
): Promise<BrainAttributionDump | undefined> {
  if (!sqlitePath || !fs.existsSync(sqlitePath)) return undefined;
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
      `SELECT injected, cited, helpful, channel, score, mem_type, mem_id
       FROM brain_attribution ORDER BY id ASC`,
    )) as Array<{
      injected?: number | null;
      cited?: number | null;
      helpful?: number | null;
      channel?: string | null;
      score?: number | null;
      mem_type?: string | null;
      mem_id?: string | null;
    }>;
    let current: AttributionRefitInput = {
      theta: CALIBRATED_THETA_DEFAULT,
      weights: emptyChannelWeights(),
    };
    try {
      const knobs = (await db.all(
        `SELECT key, value FROM brain_config
         WHERE key IN ('calibrated_theta', 'retrieval_threshold', 'w_lexical', 'w_ripgrep', 'w_graph', 'w_tree')`,
      )) as Array<{ key?: string; value?: string }>;
      const byKey = new Map(
        knobs
          .filter((row) => row.key)
          .map((row) => [String(row.key), String(row.value ?? "")]),
      );
      current = { theta: parseTheta(byKey), weights: parseWeights(byKey) };
    } catch {
      // leftover DBs without brain_config stay at theorem defaults
    }
    return {
      current,
      rows: rows.map((row) => ({
        injected: Number(row.injected ?? 0),
        cited: Number(row.cited ?? 0),
        helpful: row.helpful == null ? null : Number(row.helpful),
        channel: row.channel == null || row.channel === "" ? null : String(row.channel),
        score: row.score == null ? null : Number(row.score),
        mem_type: row.mem_type == null ? undefined : String(row.mem_type),
        mem_id: row.mem_id == null ? undefined : String(row.mem_id),
      })),
    };
  } catch {
    return undefined;
  } finally {
    await db.close().catch(() => undefined);
  }
}
