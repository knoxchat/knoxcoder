/**
 * MEM-40 / MEM-42: Rec vs N under project scope (`N_q = σ N`), plus σ / ε_B
 * / ε_S and leftover P1-5 `gateSearchCost` (scan detector, not a laptop SLO).
 *
 *   npx vitest run context/memory/bench/brainScale
 *   KNOX_SCALE_ITEMS=20000 npx vitest run context/memory/bench/brainScale
 *   KNOX_SCALE_NIGHTLY=1 npx vitest run context/memory/bench/brainScale
 *
 * Latency depends on the machine, so the budgets catch a regression to an
 * O(N) scan (Dilution Lemma / leftover Ω(q) dump), not a performance promise.
 * Search(q) is inverted-index + tree routing, O(log N_q).
 */
import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { gateRecallScale, gateSearchCost, RECALL_SCALE_NS } from "./gate";
import { EPSILON_B_FLAT_FTS, THEOREM_ERRORS_FILENAME, canClaimTheorem } from "./errors";
import {
  resolveRecallScaleNs,
  runRecallScaleBench,
  RECALL_SCALE_PROJECTS,
} from "./runRecallScaleBench";

describe("MEM-40 recall scale schedule", () => {
  it("defaults to 1e3, 1e4, 1e5 and adds 1e6 only when nightly", () => {
    expect(resolveRecallScaleNs({})).toEqual([...RECALL_SCALE_NS]);
    expect(resolveRecallScaleNs({ KNOX_SCALE_NIGHTLY: "1" })).toEqual([1_000, 10_000, 100_000, 1_000_000]);
    expect(resolveRecallScaleNs({ KNOX_SCALE_ITEMS: "20000" })).toEqual([1_000, 10_000]);
    expect(resolveRecallScaleNs({ KNOX_RECALL_SCALE_NS: "80, 240" })).toEqual([80, 240]);
    expect(resolveRecallScaleNs({ KNOX_SCALE_ITEMS: "500" })).toEqual([500]);
  });
});

describe("memory recall vs N (MEM-40)", () => {
  it(
    "scopes Ω(q) so N_q = σ N and Rec holds on a small curve",
    async () => {
      const report = await runRecallScaleBench({ ns: [80, 240] });
      console.log("[recall-scale:small]", JSON.stringify(summarize(report)));

      expect(report.scope).toBe("project");
      expect(report.projects).toBe(RECALL_SCALE_PROJECTS);
      expect(report.points).toHaveLength(2);
      for (const point of report.points) {
        expect(point.n_q).toBeLessThan(point.n);
        expect(point.sigma).toBeGreaterThan(0.1);
        expect(point.sigma).toBeLessThan(0.5);
        expect(point.c_use_mean).toBeGreaterThan(0);
        expect(point.rec).toBeGreaterThan(0);
        expect(point.epsilon_s).toBeGreaterThanOrEqual(0);
        if (point.epsilon_b == null) {
          expect(point.epsilon_b_note).toBe(EPSILON_B_FLAT_FTS);
        } else {
          expect(point.epsilon_b).toBeGreaterThanOrEqual(0);
        }
      }
      expect(report.sigma).toBeGreaterThan(0);
      expect(report.epsilon_s).toBeGreaterThanOrEqual(0);
      expect(report.points[1].n).toBeGreaterThan(report.points[0].n);

      const gate = gateRecallScale(report.points, {
        epsilonS: report.epsilon_s,
        epsilonB: report.epsilon_b ?? undefined,
      });
      expect(gate.ok, gate.failures.join("; ")).toBe(true);
      expect(report.theorem_held).toBe(canClaimTheorem(report.epsilon_b) && gate.ok);
    },
    120_000,
  );

  it(
    `Rec vs N ${describeNs()} does not drop faster than slack`,
    async () => {
      const ns = resolveRecallScaleNs();
      const report = await runRecallScaleBench({ ns });
      console.log("[recall-scale]", JSON.stringify(summarize(report)));

      for (const point of report.points) {
        expect(point.n_q, `N=${point.n} should be scoped`).toBeLessThan(point.n);
        expect(point.sigma).toBeGreaterThan(0);
        expect(point.sigma).toBeLessThan(0.5);
        expect(point.c_use_mean).toBeGreaterThan(0);
        expect(Number.isFinite(point.c_use_max)).toBe(true);
        expect(Number.isFinite(point.epsilon_s)).toBe(true);
      }

      const gate = gateRecallScale(report.points, {
        epsilonS: report.epsilon_s,
        epsilonB: report.epsilon_b ?? undefined,
      });
      expect(gate.ok, gate.failures.join("; ")).toBe(true);

      const cost = gateSearchCost(report.points);
      expect(cost.ok, cost.failures.join("; ")).toBe(true);
      if (process.env.KNOX_BENCH_WRITE === "1") {
        fs.writeFileSync(
          path.join(__dirname, THEOREM_ERRORS_FILENAME),
          `${JSON.stringify({
            sigma: report.sigma,
            epsilon_b: report.epsilon_b,
            epsilon_b_note: report.epsilon_b_note,
            epsilon_s: report.epsilon_s,
            theorem_held: report.theorem_held,
            tree_ready: report.tree_ready,
            points: report.points.map((p) => ({
              n: p.n,
              n_q: p.n_q,
              sigma: p.sigma,
              rec: p.rec,
              epsilon_b: p.epsilon_b,
              epsilon_s: p.epsilon_s,
            })),
          }, null, 2)}\n`,
        );
      }
    },
    600_000,
  );
});

function describeNs(): string {
  return resolveRecallScaleNs().map((n) => n.toExponential(0)).join(", ");
}

function summarize(report: Awaited<ReturnType<typeof runRecallScaleBench>>) {
  return {
    scope: report.scope,
    projects: report.projects,
    seedMs: report.seedMs,
    dbBytes: report.dbBytes,
    sigma: report.sigma,
    epsilon_b: report.epsilon_b,
    epsilon_b_note: report.epsilon_b_note,
    epsilon_s: report.epsilon_s,
    theorem_held: report.theorem_held,
    points: report.points.map(({ perQuery, misses, ...point }) => ({
      ...point,
      missCount: misses.length,
    })),
  };
}
