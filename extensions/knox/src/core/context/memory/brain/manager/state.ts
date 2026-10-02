/** Process-wide BrainManager singleton state. */

import { LruCache } from "../AdvancedFeatures.js";
import {
  MetricsCollector,
  PredictiveAnalytics,
  HealingEngine,
  ConsolidationTracker,
  CompressionMetrics,
  EffectiveContextTracker,
} from "../PerformanceMonitor.js";
import { WorkingMemory } from "../WorkingMemory.js";
import type { ILLM } from "../../../../index.js";
import type { MemoryEventListener } from "../types.js";

export const brainRuntime = {
  llm: null as ILLM | null,
  metrics: new MetricsCollector(),
  compressionMetrics: new CompressionMetrics(),
  effectiveContextTracker: new EffectiveContextTracker(),
  predictive: new PredictiveAnalytics(),
  healing: new HealingEngine(),
  consolidationTracker: new ConsolidationTracker(),
  memoryCache: new LruCache<any>({ maxEntries: 500, ttlMs: 30 * 60 * 1000 }),
  workingMem: null as WorkingMemory | null,
  workingMemSessionId: null as string | null,
  activeSessionId: null as string | null,
  eventListeners: [] as MemoryEventListener[],
  consolidationCount: 0,
  consolidationTimer: null as ReturnType<typeof setInterval> | null,
};
