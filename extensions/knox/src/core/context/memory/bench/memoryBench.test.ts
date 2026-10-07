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

import { REAL_WORLD_MEMORIES, REAL_WORLD_QUERIES } from "./fixturesRealWorld";
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
    // Precision and false-inject rate depend on tie-breaking between near-equal hits, which differs
    // slightly between platforms (CI Linux measured 0.625 against the 0.682 baseline from macOS:
    // two more borderline injections). A real regression moves these by far more than 0.1.
    expect(report.precision).toBeGreaterThanOrEqual(baseline.precision - 0.1);
    expect(report.falseInjectRate).toBeLessThanOrEqual(baseline.falseInjectRate + 0.1);
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

  /**
   * P1-7 stable thresholds on the messy, real-world style set (`fixturesRealWorld.ts`).
   * Absolute floors, not baseline-relative, so they hold across platforms. Measured on
   * 2026-10-07: recall 0.75, precision 0.545, false-inject 0. Floors sit a little below.
   *
   * Known misses (the retriever is lexical): "invoice total with tax" does not reach the
   * integer-cents rule, "icon-only button" does not reach the a11y rule, "settings card"
   * does not reach the design-system rule, and Chinese queries retrieve nothing (the query
   * cleaner drops CJK and FTS5 `unicode61` indexes a CJK run as one token). The first three
   * need embeddings; the Chinese one needs a CJK-aware FTS tokenizer (not in 2.1).
   */
  it("meets the real-world thresholds", async () => {
    const report = await runMemoryBench({
      memories: REAL_WORLD_MEMORIES,
      queries: REAL_WORLD_QUERIES,
    });
    const { perQuery, ...summary } = report;
    console.log("[memory-bench:real-world]", JSON.stringify(summary));

    expect(report.recallAtK).toBeGreaterThanOrEqual(0.7);
    expect(report.precision).toBeGreaterThanOrEqual(0.5);
    // Unrelated chatter ("thanks", a regex question) must not pull memories in.
    expect(report.falseInjectRate).toBeLessThanOrEqual(0.1);
    expect(report.tokensMax).toBeLessThanOrEqual(report.tokenCap + 64);
    expect(report.latencyMaxMs).toBeLessThan(LATENCY_CEILING_MS);

    // Keep the easy, clearly-worded cases from regressing even if the mean holds.
    const injected = (id: string) => perQuery.find((q) => q.id === id)?.injected ?? [];
    for (const [id, key] of [
      ["rw-q-install", "rw-pkg-yarn"],
      ["rw-q-boot", "rw-env-local"],
      ["rw-q-flaky", "rw-flaky-e2e"],
      ["rw-q-auth", "rw-auth-new"],
      ["rw-q-friday", "rw-deploy-friday"],
      ["rw-q-sql", "rw-orm"],
      ["rw-q-log", "rw-pii"],
      ["rw-q-date", "rw-timezone"],
      ["rw-q-license", "rw-license"],
    ] as const) {
      expect(injected(id), id).toContain(key);
    }
  }, 60_000);
});
