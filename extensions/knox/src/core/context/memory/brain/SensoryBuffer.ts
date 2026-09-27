/**
 * SensoryBuffer — M₁ sensory register (~250ms streaming buffer).
 *
 * Captures raw input before encoding (φ₁). Session-scoped in-memory ring buffer
 * that auto-flushes to working memory on turn boundaries or timeout.
 */

import { getMemoryConfig } from "./memoryConfigAccess.js";

interface SessionBuffer {
  chunks: string[];
  timer: ReturnType<typeof setTimeout> | null;
  onFlush: ((text: string) => void) | null;
}

export class SensoryBuffer {
  private static buffers = new Map<string, SessionBuffer>();

  /** Register a flush callback (typically WorkingMemory.attendTo). */
  static setFlushHandler(sessionId: string, handler: (text: string) => void): void {
    const buf = SensoryBuffer.getOrCreate(sessionId);
    buf.onFlush = handler;
  }

  /** Accept raw input into the sensory buffer (φ₁). */
  static ingest(sessionId: string, content: string): void {
    if (!sessionId || !content.trim()) return;

    const buf = SensoryBuffer.getOrCreate(sessionId);
    buf.chunks.push(content.trim());
    SensoryBuffer.scheduleFlush(sessionId, buf);
  }

  /**
   * Flush on chat turn boundary — returns combined buffered text and clears state.
   * Called at the start of each pre-turn pipeline run.
   */
  static flushOnTurnBoundary(sessionId: string | undefined, message: string): string {
    if (sessionId) {
      const pending = SensoryBuffer.flush(sessionId);
      if (pending) {
        SensoryBuffer.getOrCreate(sessionId).onFlush?.(pending);
      }
      SensoryBuffer.ingest(sessionId, message);
    }
    return message;
  }

  /** Immediately flush and return combined chunks. */
  static flush(sessionId: string): string | null {
    const buf = SensoryBuffer.buffers.get(sessionId);
    if (!buf || buf.chunks.length === 0) return null;

    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }

    const combined = buf.chunks.join("\n");
    buf.chunks = [];
    return combined;
  }

  /** Clear buffer without invoking flush handler. */
  static clear(sessionId: string): void {
    const buf = SensoryBuffer.buffers.get(sessionId);
    if (!buf) return;
    if (buf.timer) clearTimeout(buf.timer);
    SensoryBuffer.buffers.delete(sessionId);
  }

  private static getOrCreate(sessionId: string): SessionBuffer {
    let buf = SensoryBuffer.buffers.get(sessionId);
    if (!buf) {
      buf = { chunks: [], timer: null, onFlush: null };
      SensoryBuffer.buffers.set(sessionId, buf);
    }
    return buf;
  }

  private static scheduleFlush(sessionId: string, buf: SessionBuffer): void {
    if (buf.timer) clearTimeout(buf.timer);

    const ms = getMemoryConfig().sensory_buffer_ms;
    buf.timer = setTimeout(() => {
      const text = SensoryBuffer.flush(sessionId);
      if (text) buf.onFlush?.(text);
    }, ms);
  }

  /** Estimated tokens currently buffered (M₁ contribution to C_effective). */
  static estimateBufferedTokens(sessionId?: string): number {
    let chars = 0;
    if (sessionId) {
      const buf = SensoryBuffer.buffers.get(sessionId);
      if (buf) chars += buf.chunks.join("\n").length;
    } else {
      for (const buf of SensoryBuffer.buffers.values()) {
        chars += buf.chunks.join("\n").length;
      }
    }
    return Math.ceil(chars / 4);
  }

  /** Reschedule pending flush timers after sensory_buffer_ms config change. */
  static rescheduleAll(): void {
    for (const [sessionId, buf] of SensoryBuffer.buffers.entries()) {
      if (buf.chunks.length > 0) {
        SensoryBuffer.scheduleFlush(sessionId, buf);
      }
    }
  }

  /** M₁ buffer stats for diagnostics. */
  static getStats(sessionId?: string): {
    sessions: number;
    pending_chunks: number;
    estimated_tokens: number;
    buffer_ms: number;
  } {
    const cfg = getMemoryConfig();
    if (sessionId) {
      const buf = SensoryBuffer.buffers.get(sessionId);
      return {
        sessions: buf ? 1 : 0,
        pending_chunks: buf?.chunks.length ?? 0,
        estimated_tokens: SensoryBuffer.estimateBufferedTokens(sessionId),
        buffer_ms: cfg.sensory_buffer_ms,
      };
    }
    let chunks = 0;
    for (const buf of SensoryBuffer.buffers.values()) {
      chunks += buf.chunks.length;
    }
    return {
      sessions: SensoryBuffer.buffers.size,
      pending_chunks: chunks,
      estimated_tokens: SensoryBuffer.estimateBufferedTokens(),
      buffer_ms: cfg.sensory_buffer_ms,
    };
  }
}
