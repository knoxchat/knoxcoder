/** Health score, forecasts, healing, and Ebbinghaus stats. */

import { BrainStore } from "../BrainStore.js";
import {
  SpacedRepetition,
  MetricsStorage,
} from "../AdvancedFeatures.js";
import type {
  SpacedRepetitionState,
  MetricsTrend,
} from "../AdvancedFeatures.js";
import {
  HealthScorer,
} from "../PerformanceMonitor.js";
import type {
  HealthScore,
  CapacityForecast,
  HealingResult,
  HealingAction,
  HealingStrategy,
  ConsolidationStats,
} from "../PerformanceMonitor.js";
import { brainRuntime } from "./state.js";
import { getEffectiveContext } from "./context.js";
import { getMetrics } from "./telemetry.js";

/** Persist a metrics snapshot for trend dashboard (IMP-16). */
export async function storeMetricsSnapshot(windowMs?: number): Promise<number> {
  const mSummary = getMetrics(windowMs);
  const stats = await BrainStore.getStats();
  const compression = brainRuntime.compressionMetrics.getStats();
  const effective = await getEffectiveContext();
  return MetricsStorage.storeSnapshot(
    mSummary,
    stats.db_size_bytes,
    stats.total_semantic + stats.total_episodic,
    compression.total_tokens_saved,
    effective.hierarchy_effective_tokens,
    effective.total_effective,
  );
}

/** Structured metrics trend for dashboard (IMP-16). */
export async function getMetricsTrend(hours = 24): Promise<MetricsTrend> {
  return MetricsStorage.analyzeTrends(hours);
}

// ── Multi-dimensional Health Scoring ───────────────────────────────────────

/**
 * Compute a composite health score across latency, accuracy, efficiency,
 * capacity, and fragmentation dimensions.
 */
export async function getHealthScore(weights?: Record<string, number>): Promise<HealthScore> {
  const metrics = brainRuntime.metrics.getSummary();
  const basicHealth = await BrainStore.getHealth();
  return HealthScorer.score(metrics, basicHealth, weights);
}

// ── Predictive Analytics ───────────────────────────────────────────────────

/**
 * Update predictive analytics with latest metrics snapshot
 * and return a capacity forecast.
 */
export async function getCapacityForecast(): Promise<CapacityForecast> {
  const metrics = brainRuntime.metrics.getSummary();
  const health = await BrainStore.getHealth();
  const stats = await BrainStore.getStats();
  const totalMemories = stats.total_episodic + stats.total_semantic;

  brainRuntime.predictive.update(metrics, health.db_size_bytes);
  return brainRuntime.predictive.forecast(health.db_size_bytes, totalMemories);
}

// ── Healing Actions ────────────────────────────────────────────────────────

/**
 * Run a specific healing action.
 */
export async function runHealingAction(action: HealingAction): Promise<HealingResult> {
  return brainRuntime.metrics.measure(`heal:${action}`, () => brainRuntime.healing.runAction(action));
}

/**
 * Auto-heal based on current health status.
 * Adaptively selects the most effective healing strategies.
 */
export async function autoHeal(): Promise<HealingResult[]> {
  const health = await BrainStore.getHealth();
  return brainRuntime.healing.autoHeal(health);
}

/**
 * Get healing strategy effectiveness rankings.
 */
export function getHealingStrategies(): HealingStrategy[] {
  return brainRuntime.healing.getStrategies();
}

// ── Consolidation Stats ────────────────────────────────────────────────────

/**
 * Get detailed consolidation statistics including scheduler state,
 * run history, and aggregate counts.
 */
export function getConsolidationStats(): ConsolidationStats {
  return brainRuntime.consolidationTracker.getStats();
}

/** Part IV — memories due for spaced repetition review. */
export async function getReviewDue(limit = 20): Promise<SpacedRepetitionState[]> {
  const cfg = BrainStore.getConfig();
  return SpacedRepetition.getMemoriesDueForReview(cfg.ebbinghaus_review_threshold, limit);
}

/** Part IV — Ebbinghaus config + aggregate retention stats for dashboard. */
export async function getEbbinghausStats(): Promise<{
  config: ReturnType<typeof import("../memoryConfigAccess.js").getEbbinghausConfig>;
  review_due_count: number;
  avg_retention: number;
}> {
  const { getEbbinghausConfig } = await import("../memoryConfigAccess.js");
  const due = await getReviewDue(100);
  const avgRetention =
    due.length > 0
      ? due.reduce((sum, d) => sum + d.current_retention, 0) / due.length
      : 1.0;
  return {
    config: getEbbinghausConfig(),
    review_due_count: due.length,
    avg_retention: avgRetention,
  };
}
