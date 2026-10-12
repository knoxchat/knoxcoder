import type { SleepSubPhaseCounts } from "../types.js";
import type { ConsolidationStats } from "../PerformanceMonitor.js";

// ── Consolidation Stats Tracker ─────────────────────────────────────────────

export class ConsolidationTracker {
  private totalRuns = 0;
  private lastRunAt: string | null = null;
  private lastDurationMs = 0;
  private totalDurationMs = 0;
  private totalPromoted = 0;
  private totalDemoted = 0;
  private totalPruned = 0;
  private totalDistilled = 0;
  private totalReplayed = 0;
  private totalCompressed = 0;
  private lastSubPhases: SleepSubPhaseCounts | null = null;
  private cycleHistory: ConsolidationStats["cycle_history"] = [];
  private maxHistory = 50;
  private schedulerActive = false;
  private schedulerIntervalHours = 0;
  private schedulerStartedAt: number | null = null;

  /**
   * Record a completed consolidation cycle.
   */
  record(result: {
    promoted: number;
    demoted: number;
    pruned: number;
    distilled?: number;
    replayed?: number;
    compressed?: number;
    sub_phases?: SleepSubPhaseCounts;
  }, durationMs: number): void {
    this.totalRuns++;
    this.lastRunAt = new Date().toISOString();
    this.lastDurationMs = durationMs;
    this.totalDurationMs += durationMs;
    this.totalPromoted += result.promoted;
    this.totalDemoted += result.demoted;
    this.totalPruned += result.pruned;
    this.totalDistilled += result.distilled ?? 0;
    this.totalReplayed += result.replayed ?? 0;
    this.totalCompressed += result.compressed ?? 0;
    if (result.sub_phases) {
      this.lastSubPhases = result.sub_phases;
    }

    this.cycleHistory.push({
      timestamp: this.lastRunAt,
      duration_ms: durationMs,
      promoted: result.promoted,
      demoted: result.demoted,
      pruned: result.pruned,
    });

    if (this.cycleHistory.length > this.maxHistory) {
      this.cycleHistory = this.cycleHistory.slice(-this.maxHistory);
    }
  }

  /**
   * Mark scheduler as started.
   */
  setSchedulerActive(active: boolean, intervalHours: number): void {
    this.schedulerActive = active;
    this.schedulerIntervalHours = intervalHours;
    if (active) this.schedulerStartedAt = Date.now();
    else this.schedulerStartedAt = null;
  }

  /**
   * Get full consolidation statistics.
   */
  getStats(): ConsolidationStats {
    let nextScheduledAt: string | null = null;
    if (this.schedulerActive && this.schedulerStartedAt) {
      const intervalMs = this.schedulerIntervalHours * 3600000;
      if (this.lastRunAt) {
        const lastTime = new Date(this.lastRunAt).getTime();
        nextScheduledAt = new Date(lastTime + intervalMs).toISOString();
      } else {
        nextScheduledAt = new Date(this.schedulerStartedAt + intervalMs).toISOString();
      }
    }

    return {
      total_runs: this.totalRuns,
      last_run_at: this.lastRunAt,
      last_duration_ms: this.lastDurationMs,
      avg_duration_ms: this.totalRuns > 0 ? this.totalDurationMs / this.totalRuns : 0,
      total_promoted: this.totalPromoted,
      total_demoted: this.totalDemoted,
      total_pruned: this.totalPruned,
      total_distilled: this.totalDistilled,
      total_replayed: this.totalReplayed,
      total_compressed: this.totalCompressed,
      scheduler_active: this.schedulerActive,
      scheduler_interval_hours: this.schedulerIntervalHours,
      next_scheduled_at: nextScheduledAt,
      last_sub_phases: this.lastSubPhases,
      cycle_history: [...this.cycleHistory],
    };
  }
}

// ── Compression Metrics (IMP-15 / IMP-16) ───────────────────────────────────

export interface CompressionStats {
  total_tokens_saved: number;
  last_tokens_saved: number;
  compression_events: number;
}

export interface EffectiveContextBuildStats {
  /** Tokens in the last injected context string (actual usage). */
  last_context_tokens_used: number;
  /** W_max budget applied to the last build. */
  last_context_max_tokens: number;
  /** last_context_tokens_used / last_context_max_tokens (0–1). */
  window_utilization: number;
  last_build_at: number | null;
}

/** Tracks last context-build utilization for the capacity dashboard (IMP-16). */
export class EffectiveContextTracker {
  private lastContextTokensUsed = 0;
  private lastContextMaxTokens = 0;
  private lastBuildAt: number | null = null;

  recordBuild(tokensUsed: number, maxTokens: number): void {
    if (tokensUsed < 0 || maxTokens <= 0) return;
    this.lastContextTokensUsed = tokensUsed;
    this.lastContextMaxTokens = maxTokens;
    this.lastBuildAt = Date.now();
  }

  getStats(): EffectiveContextBuildStats {
    const utilization =
      this.lastContextMaxTokens > 0
        ? Math.min(1, this.lastContextTokensUsed / this.lastContextMaxTokens)
        : 0;
    return {
      last_context_tokens_used: this.lastContextTokensUsed,
      last_context_max_tokens: this.lastContextMaxTokens,
      window_utilization: utilization,
      last_build_at: this.lastBuildAt,
    };
  }

  reset(): void {
    this.lastContextTokensUsed = 0;
    this.lastContextMaxTokens = 0;
    this.lastBuildAt = null;
  }
}

/** Tracks local memory_tokens_saved from compress-oldest overflow (knox_ms_meta equivalent). */
export class CompressionMetrics {
  private totalTokensSaved = 0;
  private lastTokensSaved = 0;
  private compressionEvents = 0;

  record(tokensSaved: number): void {
    if (tokensSaved <= 0) return;
    this.totalTokensSaved += tokensSaved;
    this.lastTokensSaved = tokensSaved;
    this.compressionEvents += 1;
  }

  getStats(): CompressionStats {
    return {
      total_tokens_saved: this.totalTokensSaved,
      last_tokens_saved: this.lastTokensSaved,
      compression_events: this.compressionEvents,
    };
  }

  reset(): void {
    this.totalTokensSaved = 0;
    this.lastTokensSaved = 0;
    this.compressionEvents = 0;
  }
}
