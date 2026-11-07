/**
 * MEM-62 — refit of the ✓ parameters: objectives, ranges, and guard rails.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seededRng } from "./thompson.js";
import {
  REFIT_MIN_SAMPLES,
  REFIT_RANGES,
  REFIT_SKIPPED,
  computeRefit,
  coordinateSearch,
  etaObjective,
  fsrsReplayLoss,
  buildFsrsEvents,
  buildRankRows,
  isHoldout,
  refitTouchesOnlyRefitKeys,
  rollbackRefit,
  runRefit,
  runRefitGroup,
  weightedAuc,
} from "./refit.js";
import { REFIT_KEYS } from "./memoryConfigAccess.js";
import type { AttributionRow } from "./store/attribution.js";

const DEFAULTS: Record<string, number> = {
  forgetting_F: 19 / 81,
  forgetting_c: 0.5,
  fsrs_a: Math.exp(1.5),
  fsrs_b: 0.2,
  fsrs_g: 1,
  difficulty_initial: 5,
  utility_omega: 0.1,
  eta_utility: 0.5,
  eta_retrievability: 0.3,
  retrieval_threshold: 0.35,
  w_mem_tokens: 4096,
  coverage_lambda: 0.5,
};

let nextId = 1;
function row(partial: Partial<AttributionRow>): AttributionRow {
  return {
    id: nextId++,
    turn_id: `t${nextId}`,
    session_id: null,
    mem_type: "semantic",
    mem_id: "1",
    injected: 1,
    cited: 1,
    helpful: 1,
    channel: "lexical",
    score: 0.5,
    created_at: null,
    source: "turn",
    propensity: null,
    scope_key: "",
    features: null,
    ...partial,
  };
}

describe("MEM-62 ranges and bookkeeping", () => {
  it("every refit key is either fit, handled elsewhere, or reported skipped", () => {
    const handledElsewhere = new Set(["w_lexical", "w_ripgrep", "w_graph", "w_tree"]);
    for (const key of REFIT_KEYS) {
      const covered = key in REFIT_RANGES || handledElsewhere.has(key) || key in REFIT_SKIPPED;
      expect(covered, key).toBe(true);
    }
  });

  it("holdout split is stable and roughly a quarter", () => {
    const keys = Array.from({ length: 400 }, (_, i) => `turn-${i}`);
    const share = keys.filter(isHoldout).length / keys.length;
    expect(isHoldout("turn-7")).toBe(isHoldout("turn-7"));
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.35);
  });
});

describe("MEM-62 coordinate search", () => {
  it("climbs to a known optimum and respects the published range", () => {
    // maximize −(η_U − 0.9)² − (η_R − 5)²: η_R wants 5 but the range tops out at 2
    const { values } = coordinateSearch(
      ["eta_utility", "eta_retrievability"],
      { eta_utility: 0.5, eta_retrievability: 0.3 },
      (v) => -((v.eta_utility - 0.9) ** 2) - (v.eta_retrievability - 5) ** 2,
    );
    expect(values.eta_utility).toBeGreaterThan(0.5);
    expect(values.eta_utility).toBeLessThanOrEqual(1.0);
    expect(values.eta_retrievability).toBeLessThanOrEqual(REFIT_RANGES.eta_retrievability!.max);
    expect(values.eta_retrievability).toBeGreaterThan(0.3);
  });

  it("starting outside the range is clamped first", () => {
    const { values } = coordinateSearch(["retrieval_threshold"], { retrieval_threshold: 3 }, () => 0);
    expect(values.retrieval_threshold).toBe(REFIT_RANGES.retrieval_threshold!.max);
  });
});

describe("MEM-62 guard rails", () => {
  it("below the minimum sample size nothing changes", () => {
    const report = runRefitGroup({
      group: "eta",
      keys: ["eta_utility"],
      samples: REFIT_MIN_SAMPLES.eta - 1,
      minSamples: REFIT_MIN_SAMPLES.eta,
      current: DEFAULTS,
      train: (v) => v.eta_utility,
      holdout: (v) => v.eta_utility,
    });
    expect(report.status).toBe("skipped");
    expect(report.after).toEqual(report.before);
  });

  it("rolls back when the held-out objective drops, even if train improves", () => {
    const report = runRefitGroup({
      group: "eta",
      keys: ["eta_utility"],
      samples: 1000,
      minSamples: 10,
      current: DEFAULTS,
      train: (v) => v.eta_utility, // wants η_U up
      holdout: (v) => -v.eta_utility, // held-out wants it down
    });
    expect(report.status).toBe("rolled_back");
    expect(report.after).toEqual(report.before);
    expect(report.reason).toMatch(/held-out/);
  });

  it("applies when train and held-out agree", () => {
    const report = runRefitGroup({
      group: "eta",
      keys: ["eta_utility"],
      samples: 1000,
      minSamples: 10,
      current: DEFAULTS,
      train: (v) => v.eta_utility,
      holdout: (v) => v.eta_utility,
    });
    expect(report.status).toBe("applied");
    expect(report.after.eta_utility!).toBeGreaterThan(DEFAULTS.eta_utility);
  });
});

describe("MEM-62 objectives", () => {
  it("weighted AUC: perfect = 1, reversed = 0, one class = ½, IPW matters", () => {
    const perfect = [
      { s: 0.9, y: 1 as const, w: 1 },
      { s: 0.1, y: 0 as const, w: 1 },
    ];
    expect(weightedAuc(perfect)).toBe(1);
    expect(weightedAuc(perfect.map((p) => ({ ...p, s: -p.s })))).toBe(0);
    expect(weightedAuc([{ s: 1, y: 1, w: 1 }])).toBe(0.5);
    const mixed = [
      { s: 0.9, y: 1 as const, w: 1 },
      { s: 0.5, y: 0 as const, w: 1 },
      { s: 0.95, y: 0 as const, w: 9 },
    ];
    expect(weightedAuc(mixed)).toBeCloseTo(1 / 10, 10);
  });

  it("η_U rises when utility predicts helpfulness the relevance alone cannot", () => {
    const rng = seededRng(21);
    const rows: AttributionRow[] = [];
    for (let i = 0; i < 400; i++) {
      const U = rng() < 0.5 ? 0.9 : 0.1;
      rows.push(
        row({
          turn_id: `eta-${i}`,
          mem_id: String(i),
          helpful: U > 0.5 ? 1 : 0,
          features: JSON.stringify({ rel: 0.01 + rng() * 0.02, U, R: 0.5 }),
        }),
      );
    }
    const rank = buildRankRows(rows);
    expect(rank.length).toBe(400);
    expect(etaObjective(rank, 2, 0.3, "train")).toBeGreaterThan(etaObjective(rank, 0, 0.3, "train"));
    const report = computeRefit({ rows, current: DEFAULTS, kappa: 5 });
    const eta = report.groups.find((g) => g.group === "eta")!;
    expect(eta.status).toBe("applied");
    expect(eta.after.eta_utility!).toBeGreaterThan(DEFAULTS.eta_utility);
    expect(report.changes.eta_utility).toBe(eta.after.eta_utility);
  });

  it("ω rises when ablation keeps saying an uncited memory did not matter", () => {
    const rows: AttributionRow[] = [];
    for (let m = 0; m < 80; m++) {
      for (let k = 0; k < 4; k++) {
        rows.push(row({ turn_id: `o-${m}-${k}`, mem_id: String(m + 1), cited: 0, helpful: null }));
      }
      rows.push(
        row({
          turn_id: `ablation:o-${m}-3`,
          mem_id: String(m + 1),
          cited: 0,
          helpful: 0,
          source: "ablation",
        }),
      );
    }
    const report = computeRefit({ rows, current: DEFAULTS, kappa: 5 });
    const omega = report.groups.find((g) => g.group === "omega")!;
    expect(omega.samples).toBeGreaterThanOrEqual(REFIT_MIN_SAMPLES.omega);
    expect(omega.status).toBe("applied");
    expect(omega.after.utility_omega!).toBeGreaterThan(DEFAULTS.utility_omega);
    expect(omega.after.utility_omega!).toBeLessThanOrEqual(REFIT_RANGES.utility_omega!.max);
  });

  it("FSRS replay: a memory that stays helpful after long gaps prefers slower forgetting", () => {
    const day = 86_400_000;
    const t0 = Date.parse("2024-01-01T00:00:00Z");
    const rows: AttributionRow[] = [];
    for (let m = 0; m < 30; m++) {
      for (let k = 0; k < 4; k++) {
        rows.push(
          row({
            turn_id: `f-${m}-${k}`,
            mem_id: String(m + 1),
            helpful: 1,
            created_at: new Date(t0 + k * 20 * day).toISOString(),
          }),
        );
      }
    }
    const events = buildFsrsEvents(rows);
    const params = { F: 19 / 81, c: 0.5, a: Math.exp(1.5), b: 0.2, g: 1, d0: 5 };
    const base = fsrsReplayLoss(events, params, "all");
    const slower = fsrsReplayLoss(events, { ...params, F: 0.05 }, "all");
    expect(base.n).toBeGreaterThan(50);
    expect(slower.loss).toBeLessThan(base.loss);

    const report = computeRefit({ rows, current: DEFAULTS, kappa: 5 });
    const fsrs = report.groups.find((g) => g.group === "fsrs")!;
    expect(["applied", "unchanged", "rolled_back"]).toContain(fsrs.status);
    if (fsrs.status === "applied") {
      expect(fsrs.after.forgetting_F!).toBeLessThan(DEFAULTS.forgetting_F);
      expect(fsrs.holdout.after).toBeGreaterThanOrEqual(fsrs.holdout.before - 1e-9);
    }
  });

  it("an empty log changes nothing and touches only refit keys", () => {
    const report = computeRefit({ rows: [], current: DEFAULTS, kappa: 5 });
    expect(report.groups.every((g) => g.status === "skipped")).toBe(true);
    expect(report.changes).toEqual({});
    expect(refitTouchesOnlyRefitKeys(report)).toBe(true);
    expect(report.skipped_keys.map((s) => s.key).sort()).toEqual(["coverage_lambda", "w_mem_tokens"]);
  });
});

// ── Persistence ─────────────────────────────────────────────────────────────

const testDir = path.join(os.tmpdir(), `brain-mem62-${Date.now()}`);

describe("MEM-62 persistence and rollback", () => {
  let BrainStore: typeof import("./BrainStore.js").BrainStore;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainStore } = await import("./BrainStore.js"));
    await BrainStore.get();
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("writes applied values, audit-logs the previous ones, and rolls back", async () => {
    const db = await BrainStore.get();
    await db.exec("DELETE FROM brain_attribution");
    const rng = seededRng(5);
    for (let i = 0; i < 400; i++) {
      const U = rng() < 0.5 ? 0.9 : 0.1;
      await db.run(
        `INSERT INTO brain_attribution (turn_id, mem_type, mem_id, injected, cited, helpful, score, source, features)
         VALUES (?, 'semantic', ?, 1, 1, ?, 0.5, 'turn', ?)`,
        [`p-${i}`, String(i + 1), U > 0.5 ? 1 : 0, JSON.stringify({ rel: 0.01 + rng() * 0.02, U, R: 0.5 })],
      );
    }
    await BrainStore.saveConfig("eta_utility", "0.5");
    const out = await runRefit(db, {
      getConfig: () => BrainStore.getConfig() as unknown as Record<string, unknown>,
      saveConfig: (key, value) => BrainStore.saveConfig(key as never, value),
      auditLog: (action, kind, id, details) => BrainStore.auditLog(action, kind, id, details),
    });
    expect(out.written.eta_utility).toBeGreaterThan(0.5);
    expect(out.previous.eta_utility).toBe(0.5);
    expect(BrainStore.getConfig().eta_utility).toBeCloseTo(out.written.eta_utility as number, 10);

    const audit = await BrainStore.getAuditLog({ action: "refit", limit: 5 });
    const details = JSON.parse(String(audit[0].details));
    expect(details.previous.eta_utility).toBe(0.5);

    await rollbackRefit(out.previous, (key, value) => BrainStore.saveConfig(key as never, value));
    expect(BrainStore.getConfig().eta_utility).toBeCloseTo(0.5, 10);
  });
});
