/**
 * MC-41: apply the *safe* subset of self-review updates to the database.
 *
 * Safe means it can only make Knox more cautious or tidier, never more automatic:
 *   - add an `error_fix` memory for a recurring failure signature
 *   - quarantine a recipe that keeps failing or being reverted
 *   - merge duplicate recipes (summed stats, the extras retired)
 * Nothing here writes settings, files, or anything outside the brain DB.
 */

import { redactSecrets } from "../../../util/redactSecrets.js";
import type { DatabaseConnection } from "../../../util/refreshIndex.js";
import type { StoreInput } from "../brain/types.js";
import type { RecipeStore } from "./RecipeStore.js";
import {
  planMemoryUpdates,
  type MemoryUpdate,
  type ReviewEvent,
  type ReviewEventKind,
} from "./selfReview.js";
import type { Recipe } from "./types.js";

export interface ApplyDeps {
  store: RecipeStore;
  /** The brain's normal `store` (sanitizing, deduping). */
  storeMemory(input: StoreInput): Promise<number>;
}

export interface ApplyReport {
  errorFixes: number;
  quarantined: string[];
  merged: { keepId: string; dropped: string[] }[];
  skipped: { update: MemoryUpdate; reason: string }[];
}

export function errorFixMemory(signature: string, count: number): StoreInput {
  const sig = redactSecrets(signature);
  return {
    category: "error_fix",
    title: `Recurring failure: ${sig}`.slice(0, 120),
    content: [
      `This failure happened ${count} times in recent sessions.`,
      `Signature: ${sig}`,
      "Find and fix the cause before trying the same action again.",
    ].join("\n"),
    importance: 0.6,
  };
}

export async function applyMemoryUpdates(updates: readonly MemoryUpdate[], deps: ApplyDeps): Promise<ApplyReport> {
  const report: ApplyReport = { errorFixes: 0, quarantined: [], merged: [], skipped: [] };
  for (const update of updates) {
    try {
      if (update.action === "add_error_fix") {
        await deps.storeMemory(errorFixMemory(update.signature, update.count));
        report.errorFixes++;
      } else if (update.action === "quarantine_recipe") {
        const recipe = await deps.store.get(update.recipeId);
        if (!recipe || (recipe.status !== "verified" && recipe.status !== "candidate")) {
          report.skipped.push({ update, reason: "recipe is not live" });
          continue;
        }
        await deps.store.quarantine(recipe.id);
        report.quarantined.push(recipe.id);
      } else {
        const survivor = await deps.store.get(update.keepId);
        if (!survivor || survivor.status === "retired" || survivor.status === "quarantined") {
          report.skipped.push({ update, reason: "surviving recipe is not live" });
          continue;
        }
        await deps.store.absorb(update.keepId, update.dropIds);
        report.merged.push({ keepId: update.keepId, dropped: [...update.dropIds] });
      }
    } catch (error) {
      report.skipped.push({ update, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

// ── Event feed ─────────────────────────────────────────────────────────────

interface EpisodicRow {
  content: string;
  metadata: string;
  created_at: string;
}

const KIND_MAP: Record<string, ReviewEventKind | undefined> = {
  tool_error: "tool_error",
  "build:fail": "build_fail",
  restore: "revert",
};

/** Default look-back for the sleep job. */
export const SELF_REVIEW_WINDOW_DAYS = 30;
const MAX_EVENT_ROWS = 2000;

/**
 * Review events from recorded soul events (episodic rows with `metadata.soul`). A workspace restore is
 * a revert; its text is the first affected file so the same file reverted repeatedly groups together.
 * User corrections have no recorded source yet, so none are produced.
 */
export async function collectReviewEvents(
  db: DatabaseConnection,
  opts: { sinceDays?: number; now?: Date } = {},
): Promise<ReviewEvent[]> {
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.sinceDays ?? SELF_REVIEW_WINDOW_DAYS) * 86_400_000);
  const rows = await db.all<EpisodicRow[]>(
    `SELECT content, metadata, created_at FROM brain_episodic
     WHERE metadata LIKE '%"soul":true%' AND created_at >= ?
     ORDER BY id DESC LIMIT ${MAX_EVENT_ROWS}`,
    [since.toISOString().replace("T", " ").slice(0, 19)],
  );
  const events: ReviewEvent[] = [];
  for (const row of rows) {
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      continue;
    }
    const kind = KIND_MAP[String(meta.kind)];
    if (!kind) continue;
    const files = Array.isArray(meta.files) ? (meta.files as unknown[]).filter((f): f is string => typeof f === "string") : [];
    const text = kind === "revert" ? (files[0] ?? row.content) : row.content;
    const recipeId = typeof meta.recipeId === "string" ? meta.recipeId : undefined;
    events.push({ kind, text, ...(recipeId ? { recipeId } : {}), at: row.created_at });
  }
  return events;
}

/** One full review: read history, plan, apply the safe updates. */
export async function runSelfReview(
  db: DatabaseConnection,
  deps: ApplyDeps,
  opts: { sinceDays?: number; now?: Date; threshold?: number } = {},
): Promise<{ events: number; updates: MemoryUpdate[]; report: ApplyReport }> {
  const events = await collectReviewEvents(db, opts);
  const recipes: Recipe[] = await deps.store.list({ status: ["candidate", "verified"], limit: 1000 });
  const updates = planMemoryUpdates(events, recipes, opts.threshold);
  const report = await applyMemoryUpdates(updates, deps);
  return { events: events.length, updates, report };
}
