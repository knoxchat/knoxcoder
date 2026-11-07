/**
 * MEM-80: one gate.ts aggregates the five release rows
 * (Rec vs N, accuracy, H_0.85, latency, erasure).
 */
import { describe, expect, it } from "vitest";

import {
  gateAccuracy,
  gateErasure,
  gateHorizon,
  gateLatencyAt1e6,
  gateRecallScale,
  gateRelease,
} from "./gate";

describe("MEM-80 release gate", () => {
  it("passes when Rec vs N, accuracy, H_0.85, latency, and erasure all hold", () => {
    const recallScale = gateRecallScale([
      { n: 1_000, n_q: 200, rec: 1 },
      { n: 10_000, n_q: 2_000, rec: 0.95 },
    ]);
    const accuracy = gateAccuracy({ overall: 0.8 }, { overall: 0.8 });
    const horizon = gateHorizon([
      { l: 0, rec: 1 },
      { l: 14, rec: 0.9 },
    ]);
    const latency = gateLatencyAt1e6([{ n: 100_000, latencyP95Ms: 200 }]);
    const erasure = gateErasure({ planted: 2, hits: 0, erasure_met: true });
    const release = gateRelease({ recallScale, accuracy, horizon, latency, erasure });
    expect(recallScale.ok).toBe(true);
    expect(accuracy.ok).toBe(true);
    expect(horizon.ok).toBe(true);
    expect(latency.ok).toBe(true);
    expect(erasure.ok).toBe(true);
    expect(release.ok).toBe(true);
  });

  it("fails the aggregate when any row fails", () => {
    const pass = { ok: true, failures: [] as string[] };
    const r = gateRelease({
      recallScale: pass,
      accuracy: pass,
      horizon: pass,
      latency: pass,
      erasure: { ok: false, failures: ["leftover hit"] },
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join()).toContain("erasure");
  });
});
