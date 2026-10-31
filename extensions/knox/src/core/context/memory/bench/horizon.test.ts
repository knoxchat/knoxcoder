/**
 * MEM-41: answerable horizon H_0.85.
 *
 *   npx vitest run context/memory/bench/horizon
 *   KNOX_HORIZON_LS=0,1,14,43,60,365 npx vitest run context/memory/bench/horizon
 */
import fs from "fs";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { Forgetting } from "../brain/Forgetting.js";
import { gateHorizon, HORIZON_LS, HORIZON_RHO } from "./gate";
import {
  ageSemanticFacts,
  factAgeTimestamp,
  HORIZON_FILLERS,
  resolveHorizonLs,
  runHorizonBench,
} from "./runHorizonBench";

describe("MEM-41 horizon schedule", () => {
  it("defaults to the theorem ages and accepts KNOX_HORIZON_LS", () => {
    expect(resolveHorizonLs({})).toEqual([...HORIZON_LS]);
    expect(resolveHorizonLs({ KNOX_HORIZON_LS: "0, 14, 60" })).toEqual([0, 14, 60]);
    expect(resolveHorizonLs({ KNOX_HORIZON_LS: "365 14 14 0" })).toEqual([0, 14, 365]);
  });

  it("warps last_accessed_at / created_at by L days", () => {
    const now = Date.parse("2026-10-31T00:00:00.000Z");
    expect(factAgeTimestamp(0, now)).toBe("2026-10-31T00:00:00.000Z");
    expect(factAgeTimestamp(1, now)).toBe("2026-10-30T00:00:00.000Z");
    expect(factAgeTimestamp(14, now)).toBe("2026-10-17T00:00:00.000Z");
    expect(Forgetting.daysSince(factAgeTimestamp(43, now), now)).toBeCloseTo(43, 10);
  });
});

describe("memory answerable horizon (MEM-41)", () => {
  it(
    "publishes H_0.85 from E[Rec | fact age = L] after aging gold facts",
    async () => {
      const nowMs = Date.now();
      const ls = [0, 14, 60];
      const report = await runHorizonBench({ ls, nowMs, fillers: HORIZON_FILLERS });
      console.log("[horizon]", JSON.stringify(summarize(report)));

      expect(report.rho).toBe(HORIZON_RHO);
      expect(report.fillers).toBe(HORIZON_FILLERS);
      expect(report.nowMs).toBe(nowMs);
      expect(report.points).toHaveLength(ls.length);
      expect(report.points.map((p) => p.l)).toEqual(ls);

      for (const point of report.points) {
        expect(point.c_use_mean).toBeGreaterThan(0);
        expect(Number.isFinite(point.rec)).toBe(true);
      }

      const gate = gateHorizon(report.points);
      expect(gate.ok, gate.failures.join("; ")).toBe(true);
      expect(report.points[0].rec).toBeGreaterThanOrEqual(HORIZON_RHO);
      expect(report.sigma).toBe(1);
      expect(report.epsilon_s).toBeGreaterThanOrEqual(0);
      if (report.epsilon_b == null) {
        expect(report.epsilon_b_note).toMatch(/n\/a/);
        expect(report.theorem_held).toBe(false);
      } else {
        expect(report.epsilon_b).toBeGreaterThanOrEqual(0);
      }
      expect(report.h_0_85).toBeGreaterThanOrEqual(0);
      if (report.censored) {
        expect(report.h_0_85).toBe(ls[ls.length - 1]);
        expect(report.h_interp).toBeUndefined();
      } else {
        expect(report.first_miss_l).toBeGreaterThan(report.h_0_85);
      }
    },
    120_000,
  );

  it(
    "the age warp reaches last_accessed_at so R(t, S) drops",
    async () => {
      const dir = path.join(os.tmpdir(), `brain-horizon-warp-${process.pid}-${Date.now()}`);
      fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
      const prevGlobal = process.env.KNOX_GLOBAL_DIR;
      process.env.KNOX_GLOBAL_DIR = dir;
      const { close } = await import("../brain/store/connection.js");
      await close();
      try {
        const { BrainManager } = await import("../brain/BrainManager.js");
        const { BrainStore } = await import("../brain/BrainStore.js");
        const { get } = await import("../brain/store/connection.js");
        await BrainStore.get();
        await BrainStore.saveConfig("auto_extract_enabled", "false");
        const sessionId = "horizon-warp";
        await BrainManager.trackSession(sessionId, "Horizon warp", dir);
        const title = "PostgreSQL is the primary database";
        await BrainManager.store({
          category: "decision",
          title,
          content: "All services use PostgreSQL 15 with pgBouncer.",
          keywords: "database, postgres",
          session_id: sessionId,
          importance: 0.85,
        });
        const db = await get();
        const nowMs = Date.parse("2026-10-31T12:00:00.000Z");
        const stamped = await ageSemanticFacts(db, [title], 60, nowMs);
        const row = (await db.get(
          "SELECT last_accessed_at, created_at, stability, category FROM brain_semantic WHERE title = ?",
          [title],
        )) as {
          last_accessed_at: string;
          created_at: string;
          stability: number;
          category: string;
        };
        expect(row.last_accessed_at).toBe(stamped);
        expect(row.created_at).toBe(stamped);
        const tDays = Forgetting.daysSince(row.last_accessed_at, nowMs);
        expect(tDays).toBeCloseTo(60, 5);
        expect(Forgetting.retrievability(tDays, row.stability)).toBeLessThan(1);
        expect(Forgetting.retrievability(0, row.stability)).toBe(1);
      } finally {
        try {
          await close();
        } catch {
          // best effort
        }
        if (prevGlobal === undefined) delete process.env.KNOX_GLOBAL_DIR;
        else process.env.KNOX_GLOBAL_DIR = prevGlobal;
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // temp dir cleanup is best effort
        }
      }
    },
    60_000,
  );
});

function summarize(report: Awaited<ReturnType<typeof runHorizonBench>>) {
  return {
    sigma: report.sigma,
    epsilon_b: report.epsilon_b,
    epsilon_s: report.epsilon_s,
    theorem_held: report.theorem_held,
    h_0_85: report.h_0_85,
    h_interp: report.h_interp,
    censored: report.censored,
    first_miss_l: report.first_miss_l,
    fillers: report.fillers,
    seedMs: report.seedMs,
    points: report.points.map(({ perQuery, misses, ...point }) => ({
      ...point,
      missCount: misses.length,
    })),
  };
}
