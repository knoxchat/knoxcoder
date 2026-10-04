/** Auto-consolidation scheduler and sleep cycle. */

import { isBrainEnabled } from "../store/dbSafety.js";
import { BrainStore } from "../BrainStore.js";
import { SleepConsolidation } from "../SleepConsolidation.js";
import type { SleepCycleResult } from "../SleepConsolidation.js";
import { CheckpointManager } from "../CheckpointManager.js";
import { brainRuntime } from "./state.js";
import { emit } from "./events.js";
import { closeStaleSessions } from "./sessions.js";

/**
 * Start the auto-consolidation scheduler.
 * Runs consolidation periodically based on the configured interval.
 */
export function startAutoConsolidation(): void {
  if (!isBrainEnabled()) return;
  if (brainRuntime.consolidationTimer) return; // Already running
  const config = BrainStore.getConfig();
  const intervalMs = config.consolidation_interval_hours * 60 * 60 * 1000;
  if (intervalMs <= 0) return;

  brainRuntime.consolidationTimer = setInterval(async () => {
    try {
      // Close sessions that have been idle for a day so topic flushing,
      // working-memory persistence, and auto-summarization actually run
      // even when the UI never closes a session explicitly.
      await closeStaleSessions(24).catch(() => {});

      // Run the full sleep cycle every tick — decay, promotion, compression,
      // and distillation must happen regardless of capacity, not only when
      // the hot tier is nearly full.
      await consolidate();
    } catch {
      // Silently ignore auto-consolidation failures
    }
  }, intervalMs);

  // Don't prevent Node from exiting
  if (brainRuntime.consolidationTimer && typeof brainRuntime.consolidationTimer === "object" && "unref" in brainRuntime.consolidationTimer) {
    brainRuntime.consolidationTimer.unref();
  }

  brainRuntime.consolidationTracker.setSchedulerActive(true, config.consolidation_interval_hours);
}

/**
 * Stop the auto-consolidation scheduler.
 */
export function stopAutoConsolidation(): void {
  if (brainRuntime.consolidationTimer) {
    clearInterval(brainRuntime.consolidationTimer);
    brainRuntime.consolidationTimer = null;
  }
  brainRuntime.consolidationTracker.setSchedulerActive(false, 0);
}

/**
 * Run memory consolidation with full sleep-cycle phases.
 * Replaces basic tiering with REM/NREM-inspired consolidation:
 *   NREM-1: Replay & strengthen important memories
 *   NREM-2: Ebbinghaus decay & tier demotion
 *   NREM-3: Cold-tier compression
 *   REM:    Episodic-to-semantic distillation
 *   Post:   Graph strengthening & high-value promotion
 * Auto-creates a checkpoint every N consolidations (configurable).
 */
export async function consolidate(): Promise<SleepCycleResult> {
  // Safety checkpoint before destructive consolidation
  await CheckpointManager.beforeDestructiveOp("consolidate").catch(() => {});

  const start = performance.now();
  const result = await brainRuntime.metrics.measure("consolidate", () => SleepConsolidation.runCycle());
  const durationMs = performance.now() - start;

  brainRuntime.consolidationTracker.record(result, durationMs);
  emit("consolidation:completed", {
    promoted: result.promoted, demoted: result.demoted, pruned: result.pruned,
    replayed: result.replayed, strengthened: result.strengthened,
    distilled: result.distilled, edges_strengthened: result.edges_strengthened,
    compressed: result.compressed, sub_phases: result.sub_phases,
    duration_ms: durationMs,
  });

  // Auto-checkpoint after N consolidations
  const config = BrainStore.getConfig();
  if (config.auto_checkpoint_interval > 0) {
    brainRuntime.consolidationCount++;
    if (brainRuntime.consolidationCount % config.auto_checkpoint_interval === 0) {
      try {
        await BrainStore.createCheckpoint(`auto-consolidation-${brainRuntime.consolidationCount}`);
      } catch {
        // Silently ignore checkpoint failures
      }
    }
  }

  // Long-lived sessions: re-enforce the sqlite size cap on every tick, not only on open.
  try {
    const { get } = await import("../store/connection.js");
    const { enforceBrainSizeCap } = await import("../store/dbSafety.js");
    const { getMemoryBrainSqlitePath } = await import("../../../../util/paths.js");
    const db = await get();
    await enforceBrainSizeCap(db, getMemoryBrainSqlitePath());
  } catch {
    // Size cap is best-effort; consolidation already succeeded.
  }

  return result;
}
