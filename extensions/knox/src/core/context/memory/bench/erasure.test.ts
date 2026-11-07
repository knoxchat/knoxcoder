/**
 * MEM-80: plant, forget, search every index. Gate is zero hits.
 */
import { describe, expect, it } from "vitest";

import { gateErasure } from "./gate";
import { runErasureBench } from "./runErasureBench";

describe("MEM-80 erasure bench", () => {
  it(
    "forgotten content has zero hits in fusion, FTS, tree, graph, and snapshot",
    async () => {
      const report = await runErasureBench();
      console.log("[erasure-bench]", JSON.stringify({
        planted: report.planted,
        hits: report.hits,
        hit_details: report.hit_details,
        erasure_met: report.erasure_met,
        seedMs: report.seedMs,
      }));
      const gate = gateErasure(report);
      expect(gate.ok, gate.failures.join("; ")).toBe(true);
      expect(report.hits).toBe(0);
      expect(report.erasure_met).toBe(true);
    },
    60_000,
  );
});
