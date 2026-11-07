import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./invariants.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./invariants.js")>();
  return {
    ...actual,
    checkStoreInvariants: vi.fn(async () => ({
      met: true,
      at: Date.now(),
      reachability: {
        met: true,
        checked: true,
        live: 0,
        missing: 0,
        missing_fts: 0,
        via_fts: 0,
        via_ripgrep: 0,
        via_graph: 0,
        via_tree: 0,
        missing_ids: [],
      },
      losslessness: { met: true, checked: true, leaves: 0, dangling: 0, dangling_ids: [] },
      freshness: {
        met: true,
        checked: true,
        probed: 0,
        not_in_fts: 0,
        sketches_probed: 0,
        stale_sketches: 0,
        stale_ids: [],
      },
      erasure: { met: true, checked: true, tombstoned: 0, leaks: 0, leak_ids: [] },
    })),
  };
});

import { registerSleepCycleHook, SleepConsolidation } from "./SleepConsolidation";

const phases = ["nremReplay", "nremCompress", "remDistill", "strengthenGraph", "promoteHighValue", "refitAttributionPriors"] as const;

function stubPhases() {
  for (const p of phases) {
    if (p === "refitAttributionPriors") {
      vi.spyOn(SleepConsolidation as any, p).mockResolvedValue({ rows: 0 });
      continue;
    }
    vi.spyOn(SleepConsolidation as any, p).mockResolvedValue(0);
  }
  vi.spyOn(SleepConsolidation as any, "nremDecay").mockResolvedValue({ demoted: 0, pruned: 0 });
  vi.spyOn(SleepConsolidation as any, "dedupNearDuplicates").mockResolvedValue(0);
  vi.spyOn(SleepConsolidation as any, "scanContradictions").mockResolvedValue(0);
  vi.spyOn(SleepConsolidation as any, "refreshTree").mockResolvedValue(0);
  vi.spyOn(SleepConsolidation as any, "refreshLexicalIndex").mockResolvedValue(undefined);
  vi.spyOn(SleepConsolidation as any, "drainAblations").mockResolvedValue(undefined);
  vi.spyOn(SleepConsolidation as any, "refitCalibrationFits").mockResolvedValue(undefined);
  vi.spyOn(SleepConsolidation as any, "refitParameters").mockResolvedValue(undefined);
}

afterEach(() => vi.restoreAllMocks());

describe("registerSleepCycleHook (MC-40)", () => {
  it("runs after the cycle with its result, and can be unregistered", async () => {
    stubPhases();
    const hook = vi.fn(async () => {});
    const off = registerSleepCycleHook("t1", hook);
    await SleepConsolidation.runCycle();
    expect(hook).toHaveBeenCalledTimes(1);
    off();
    await SleepConsolidation.runCycle();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("a throwing hook does not fail the cycle or block other hooks", async () => {
    stubPhases();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const after = vi.fn(async () => {});
    const offA = registerSleepCycleHook("bad", async () => {
      throw new Error("boom");
    });
    const offB = registerSleepCycleHook("good", after);
    await expect(SleepConsolidation.runCycle()).resolves.toBeDefined();
    expect(after).toHaveBeenCalled();
    offA();
    offB();
  });
});
