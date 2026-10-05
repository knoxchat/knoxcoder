/**
 * P1-5: Memory Brain retrieval latency budget at 100k items.
 *
 * Latency depends on the machine, so the budgets are ceilings that catch a regression to a
 * full-table scan or an O(n) per-turn step, not a performance promise. Override the size with
 * KNOX_SCALE_ITEMS (e.g. 20000 for a quick local run).
 */
import { describe, expect, it } from "vitest";

import { runBrainScaleBench } from "./runBrainScaleBench";

const ITEMS = Number(process.env.KNOX_SCALE_ITEMS) || 100_000;

/** Per-turn pre-turn retrieval (p95) must stay well under what a user notices before a model call. */
const PRE_TURN_P95_BUDGET_MS = 750;
const PRE_TURN_MAX_BUDGET_MS = 1_500;
const EPISODIC_P95_BUDGET_MS = 750;

describe("memory brain at scale (P1-5)", () => {
  it(
    `retrieves within budget with ${ITEMS} items`,
    async () => {
      const report = await runBrainScaleBench(ITEMS);
      console.log("[brain-scale]", JSON.stringify(report));

      expect(report.preTurnP95Ms).toBeLessThan(PRE_TURN_P95_BUDGET_MS);
      expect(report.preTurnMaxMs).toBeLessThan(PRE_TURN_MAX_BUDGET_MS);
      // Episodic search must not fall back to a full-table LIKE scan on a big brain.
      expect(report.episodicSearchP95Ms).toBeLessThan(EPISODIC_P95_BUDGET_MS);
      // Needles must still be found among the filler.
      expect(report.recallAtK).toBeGreaterThanOrEqual(0.9);
    },
    600_000,
  );
});
