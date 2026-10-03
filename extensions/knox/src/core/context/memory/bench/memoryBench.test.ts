/**
 * K-035: runs the memory benchmark and compares it with the checked-in baseline.
 *
 *   npx vitest run context/memory/bench           compare with baseline.json
 *   npm run bench:memory                           rewrite baseline.json
 *
 * Quality numbers (recall, precision, false-inject rate, tokens) are
 * deterministic and gated with a small tolerance. Latency depends on the
 * machine, so it only has a loose absolute ceiling here.
 */
import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { runMemoryBench, type BenchReport } from "./runMemoryBench";

const baselinePath = path.join(__dirname, "baseline.json");
const writeMode = process.env.KNOX_BENCH_WRITE === "1";

/** A turn that takes longer than this is a regression on any dev machine or CI runner. */
const LATENCY_CEILING_MS = 2_000;

describe("memory benchmark (K-035)", () => {
  it("meets the baseline and the injection cap", async () => {
    const report = await runMemoryBench();
    const { perQuery, ...summary } = report;
    console.log("[memory-bench]", JSON.stringify(summary));

    // Hard cap: no turn injects more than the cap (4 chars/token estimate).
    expect(report.tokensMax).toBeLessThanOrEqual(report.tokenCap + 64);
    expect(report.latencyMaxMs).toBeLessThan(LATENCY_CEILING_MS);

    if (writeMode) {
      fs.writeFileSync(baselinePath, JSON.stringify({ ...summary, perQuery }, null, 2) + "\n");
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as BenchReport;
    expect(report.recallAtK).toBeGreaterThanOrEqual(baseline.recallAtK - 0.05);
    expect(report.precision).toBeGreaterThanOrEqual(baseline.precision - 0.05);
    expect(report.falseInjectRate).toBeLessThanOrEqual(baseline.falseInjectRate + 0.05);
    expect(report.tokensMean).toBeLessThanOrEqual(Math.ceil(baseline.tokensMean * 1.25) + 20);
  }, 60_000);

  it("reads the hard cap from the environment with a floor", async () => {
    const { getMemoryInjectHardCap, MEMORY_INJECT_HARD_CAP_TOKENS } = await import(
      "../brain/memoryConfigAccess.js"
    );
    expect(getMemoryInjectHardCap()).toBe(MEMORY_INJECT_HARD_CAP_TOKENS);
    process.env.KNOX_MEMORY_INJECT_CAP = "1200";
    expect(getMemoryInjectHardCap()).toBe(1200);
    process.env.KNOX_MEMORY_INJECT_CAP = "10";
    expect(getMemoryInjectHardCap()).toBe(MEMORY_INJECT_HARD_CAP_TOKENS);
    delete process.env.KNOX_MEMORY_INJECT_CAP;
  });
});
