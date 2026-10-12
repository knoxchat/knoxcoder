import { afterEach, describe, expect, it, vi } from "vitest";

import { registerSleepCycleHook, SleepConsolidation } from "./SleepConsolidation";

const phases = ["nremReplay", "nremCompress", "remDistill", "strengthenGraph", "promoteHighValue"] as const;

function stubPhases() {
  for (const p of phases) vi.spyOn(SleepConsolidation as any, p).mockResolvedValue(0);
  vi.spyOn(SleepConsolidation as any, "nremDecay").mockResolvedValue({ demoted: 0, pruned: 0 });
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
