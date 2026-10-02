/** Memory event listeners, publish, and audit emit. */

import { BrainStore } from "../BrainStore.js";
import type {
  MemoryEvent,
  MemoryEventType,
  MemoryEventListener,
} from "../types.js";
import { brainRuntime } from "./state.js";

/**
 * Register a listener for memory events.
 * Returns an unsubscribe function.
 */
export function onEvent(listener: MemoryEventListener): () => void {
  brainRuntime.eventListeners.push(listener);
  return () => {
    brainRuntime.eventListeners = brainRuntime.eventListeners.filter((l) => l !== listener);
  };
}

/**
 * Remove all event listeners.
 */
export function clearEventListeners(): void {
  brainRuntime.eventListeners = [];
}

/**
 * Publish a memory event (public API for pipeline and tools).
 */
export function publishEvent(type: MemoryEventType, data: Record<string, any> = {}): void {
  emit(type, data);
}

/**
 * Emit a memory event to all registered listeners.
 * Also writes to the audit trail.
 */
export function emit(type: MemoryEventType, data: Record<string, any> = {}): void {
  const event: MemoryEvent = {
    type,
    timestamp: new Date().toISOString(),
    data,
  };
  for (const listener of brainRuntime.eventListeners) {
    try {
      listener(event);
    } catch {
      // Don't let listener errors disrupt memory operations
    }
  }
  // Write to audit trail (fire-and-forget)
  const targetType = type.split(":")[0];
  const targetId = data.id ?? data.session_id ?? null;
  BrainStore.auditLog(type, targetType, targetId, data).catch(() => {});
}
