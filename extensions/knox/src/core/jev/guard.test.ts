import { beforeEach, describe, expect, it } from "vitest";

import {
  budgetForPurpose,
  getJevActivityState,
  getJevLogEntries,
  resetJevGuardForTests,
  wrapJevClientWithGuard,
} from "./guard";
import type { JevClient } from "./types";

const request = {
  state: "hi",
  questions: { q: { type: "noul" as const, instructions: "x" } },
};
const okResult = { model: "m", answers: { q: { type: "noul" as const, noul: 1 } } };

describe("jev guard", () => {
  beforeEach(() => resetJevGuardForTests());

  it("caps budgets: gates 800ms, others 2s", () => {
    expect(budgetForPurpose("gate", 8000)).toBe(800);
    expect(budgetForPurpose("route", 8000)).toBe(2000);
    expect(budgetForPurpose(undefined, 300)).toBe(300);
  });

  it("enforces the hard budget against a blackholed network", async () => {
    const hang: JevClient = { systemOne: () => new Promise(() => {}) };
    const client = wrapJevClientWithGuard(hang);
    const started = Date.now();
    await expect(
      client.systemOne(request, { purpose: "gate", timeoutMs: 8000 }),
    ).rejects.toThrow(/budget/);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(getJevLogEntries()[0].outcome).toBe("timeout");
  });

  it("opens the breaker after N failures, skips, then recovers", async () => {
    let now = 1_000;
    let calls = 0;
    const inner: JevClient = {
      systemOne: async () => {
        calls++;
        throw new Error("boom");
      },
    };
    const client = wrapJevClientWithGuard(inner, {
      failureThreshold: 3,
      cooldownMs: 60_000,
      now: () => now,
    });
    for (let i = 0; i < 3; i++) {
      await expect(client.systemOne(request)).rejects.toThrow("boom");
    }
    expect(calls).toBe(3);
    await expect(client.systemOne(request)).rejects.toThrow(/skipped/);
    expect(calls).toBe(3);
    expect(getJevLogEntries().at(-1)?.outcome).toBe("skipped");

    now += 61_000;
    const healthy: JevClient = { systemOne: async () => okResult };
    const again = wrapJevClientWithGuard(healthy, { now: () => now });
    await expect(again.systemOne(request)).resolves.toEqual(okResult);
    expect(getJevActivityState().inFlight).toBe(0);
  });

  it("success resets the failure count; user aborts do not count", async () => {
    let fail = true;
    const inner: JevClient = {
      systemOne: async () => {
        if (fail) throw new Error("x");
        return okResult;
      },
    };
    const client = wrapJevClientWithGuard(inner, { failureThreshold: 2 });
    await expect(client.systemOne(request)).rejects.toThrow();
    fail = false;
    await client.systemOne(request);
    fail = true;
    await expect(client.systemOne(request)).rejects.toThrow("x");
    await expect(client.systemOne(request)).rejects.toThrow("x");
    await expect(client.systemOne(request)).rejects.toThrow(/skipped/);
  });
});
