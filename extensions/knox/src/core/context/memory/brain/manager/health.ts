/** Stats, health, optimize, and config. */

import { BrainStore } from "../BrainStore.js";
import { KnowledgeGraph } from "../KnowledgeGraph.js";
import type {
  BrainStats,
  MemoryConfigInput,
  HealthStatus,
} from "../types.js";
import { brainRuntime } from "./state.js";

// ── Statistics ─────────────────────────────────────────────────────────────

/**
 * Get brain statistics.
 */
export async function getStats(): Promise<BrainStats> {
  return BrainStore.getStats();
}

// ── Health & Self-Management ───────────────────────────────────────────────

export async function getHealth(): Promise<HealthStatus> {
  return BrainStore.getHealth();
}

export async function optimize(): Promise<string> {
  return brainRuntime.metrics.measure("optimize", () => BrainStore.optimize());
}

export function getConfig() {
  return BrainStore.getConfig();
}

export async function updateConfig(input: MemoryConfigInput): Promise<string> {
  await BrainStore.saveConfig(input.key, input.value);
  // Hot-reload working memory when its config keys change (IMP-05).
  if (input.key.startsWith("working_memory_")) {
    brainRuntime.workingMem = null;
    brainRuntime.workingMemSessionId = null;
  }
  if (input.key === "sensory_buffer_ms") {
    const { SensoryBuffer } = await import("../SensoryBuffer.js");
    SensoryBuffer.rescheduleAll();
  }
  if (input.key === "graph_max_entities") {
    const pruned = await KnowledgeGraph.enforceEntityCap();
    if (pruned > 0) {
      return `Config updated: ${input.key} = ${input.value} (pruned ${pruned} entities to fit cap)`;
    }
  }
  return `Config updated: ${input.key} = ${input.value}`;
}
