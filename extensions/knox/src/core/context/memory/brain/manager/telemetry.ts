/** Operation metrics recording and measurement. */

import type {
  MetricsSummary,
} from "../PerformanceMonitor.js";
import { brainRuntime } from "./state.js";

// ── Performance Metrics ────────────────────────────────────────────────────

/**
 * Record an operation metric (called internally or from tool implementations).
 */
export function recordMetric(operation: string, durationMs: number, tokenCount: number = 0, success: boolean = true): void {
  brainRuntime.metrics.record({
    operation, duration_ms: durationMs, token_count: tokenCount, success, timestamp: Date.now(),
  });
}

/**
 * Get performance metrics summary.
 * @param windowMs — Optional time window in ms (e.g. 3600000 for last hour)
 */
export function getMetrics(windowMs?: number): MetricsSummary {
  return brainRuntime.metrics.getSummary(windowMs);
}

/**
 * Wrap an async operation with metric collection.
 */
export async function measureOperation<T>(operation: string, fn: () => Promise<T>, tokenCount?: number): Promise<T> {
  return brainRuntime.metrics.measure(operation, fn, tokenCount);
}
