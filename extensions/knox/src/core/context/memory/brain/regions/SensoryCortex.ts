/**
 * SensoryCortex — encode stage S (MEM-31).
 *
 *   x ─encode→ S ─filter→ T
 *
 * M₁ facade: raw input capture and sanitization (φ₁+φ₂).
 * Wraps InputSanitizer + SensoryBuffer. No logic duplication.
 */

import { InputSanitizer } from "../InputSanitizer.js";
import { SensoryBuffer } from "../SensoryBuffer.js";

export const SensoryCortex = {
  scan: InputSanitizer.scan.bind(InputSanitizer),
  ingest: SensoryBuffer.ingest.bind(SensoryBuffer),
  flushOnTurnBoundary: SensoryBuffer.flushOnTurnBoundary.bind(SensoryBuffer),
  setFlushHandler: SensoryBuffer.setFlushHandler.bind(SensoryBuffer),
  clear: SensoryBuffer.clear.bind(SensoryBuffer),

  /** φ₁+φ₂: capture buffered input and return sanitized message. */
  captureAndEncode(sessionId: string | undefined, message: string): string {
    if (sessionId) {
      SensoryBuffer.flushOnTurnBoundary(sessionId, message);
    }
    return InputSanitizer.scan(message).cleaned;
  },
};
