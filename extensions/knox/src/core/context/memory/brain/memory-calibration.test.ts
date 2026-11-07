/**
 * MEM-60 / MEM-61 — Thompson exploration, propensities, isotonic calibration.
 * Pure math first, then the live search and the attribution log.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";

import { planAdmission, type AdmissionItem } from "./admission.js";
import {
  CALIBRATED_MIN_KEEP,
  applyCalibratedCut,
  buildCalibrationSamples,
  fitIsotonic,
  ipwWeight,
  isMonotone,
  predictIsotonic,
  selectCalibration,
  type CalibrationSample,
} from "./calibration.js";
import {
  sampleBeta,
  seededRng,
  selectionPropensity,
  setExplorationRng,
  thompsonUtility,
} from "./thompson.js";
import type { AttributionRow } from "./store/attribution.js";

const sample = (score: number, y: 0 | 1, w = 1, scope_key = ""): CalibrationSample => ({
  score,
  y,
  w,
  scope_key,
  turn_id: `t${score}`,
});

describe("MEM-60 Thompson draw", () => {
  it("is seeded and deterministic", () => {
    const a = thompsonUtility(3, 1, 0.5, 5, seededRng(7));
    const b = thompsonUtility(3, 1, 0.5, 5, seededRng(7));
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });

  it("draws from Beta(h + κ I₀, u + κ (1 − I₀)): mean matches", () => {
    const rng = seededRng(42);
    const h = 8;
    const u = 2;
    const kappa = 5;
    const i0 = 0.5;
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) sum += thompsonUtility(h, u, i0, kappa, rng);
    const a = h + kappa * i0;
    const b = u + kappa * (1 - i0);
    expect(sum / n).toBeCloseTo(a / (a + b), 1);
  });

  it("small shape parameters and a constant RNG terminate", () => {
    expect(sampleBeta(0.1, 0.1, seededRng(1))).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(thompsonUtility(0, 0, 0, 5, () => 1))).toBe(true);
  });

  it("selection propensity is the mixture", () => {
    expect(selectionPropensity(true, 0, 0.05)).toBeCloseTo(0.95);
    expect(selectionPropensity(false, 1, 0.05)).toBeCloseTo(0.05);
    expect(selectionPropensity(true, 1, 0.05)).toBeCloseTo(1);
    expect(selectionPropensity(false, 0, 0.05)).toBe(0);
  });
});

describe("MEM-60 admission plan", () => {
  const item = (key: string, score: number, h: number, u: number): AdmissionItem => ({
    key,
    score,
    priorFactor: 1.2,
    retrievability: 1,
    utilityUsed: 0.5,
    utilityGreedy: (h + 2.5) / (h + u + 5),
    helpful: h,
    unhelpful: u,
    i0: 0.5,
    pinned: false,
  });
  const top1 = (ranked: Array<{ key: string; score: number; pinned: boolean }>) => ranked.slice(0, 1);

  it("rate 0 → greedy list, propensity 1", () => {
    const plan = planAdmission({
      items: [item("a", 1, 5, 0), item("b", 0.9, 0, 5)],
      etaU: 0.5,
      etaR: 0.3,
      kappa: 5,
      cut: top1,
      limit: 10,
      rate: 0,
      rng: seededRng(1),
      explored: false,
    });
    expect(plan.final).toEqual(["a"]);
    expect(plan.propensity.get("a")).toBe(1);
  });

  it("a rarely-greedy memory that exploration kept has 0 < propensity < 1", () => {
    // b is close to a in rel but has no history: Thompson sometimes ranks it first.
    const items = [item("a", 1, 3, 0), item("b", 0.97, 0, 0)];
    const rng = seededRng(3);
    const plan = planAdmission({
      items,
      etaU: 0.5,
      etaR: 0.3,
      kappa: 5,
      cut: top1,
      limit: 10,
      rate: 0.5,
      rng,
      explored: true,
      simulations: 64,
    });
    for (const key of plan.final) {
      const p = plan.propensity.get(key) as number;
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    const aWins = planAdmission({
      items,
      etaU: 0.5,
      etaR: 0.3,
      kappa: 5,
      cut: top1,
      limit: 10,
      rate: 0.5,
      rng: seededRng(3),
      explored: false,
      simulations: 64,
    });
    expect(aWins.final).toEqual(["a"]);
    // greedy kept a, so p(a) ≥ 1 − ε
    expect(aWins.propensity.get("a") as number).toBeGreaterThanOrEqual(0.5);
  });
});

describe("MEM-61 isotonic fit", () => {
  it("is monotone and equals PAV on a known violation", () => {
    const fit = fitIsotonic([
      sample(0.1, 0),
      sample(0.2, 1),
      sample(0.3, 0),
      sample(0.4, 0),
      sample(0.5, 1),
      sample(0.6, 1),
      sample(0.7, 1),
    ]);
    expect(isMonotone(fit)).toBe(true);
    // 0.2→1 and 0.3→0, 0.4→0 pool into one block of rate 1/3
    expect(predictIsotonic(fit, 0.1)).toBe(0);
    expect(predictIsotonic(fit, 0.25)).toBeCloseTo(1 / 3, 10);
    expect(predictIsotonic(fit, 0.35)).toBeCloseTo(1 / 3, 10);
    expect(predictIsotonic(fit, 0.9)).toBe(1);
    // outside the range clamps to the end blocks
    expect(predictIsotonic(fit, -5)).toBe(0);
  });

  it("random labels still give a non-decreasing fit", () => {
    const rng = seededRng(11);
    const samples = Array.from({ length: 300 }, () => sample(rng(), rng() < 0.4 ? 1 : 0, 1 + Math.floor(rng() * 5)));
    const fit = fitIsotonic(samples);
    expect(isMonotone(fit)).toBe(true);
    let last = -1;
    for (let x = 0; x <= 1; x += 0.01) {
      const p = predictIsotonic(fit, x);
      expect(p).toBeGreaterThanOrEqual(last - 1e-12);
      last = p;
    }
  });

  it("IPW corrects a rarely-shown memory", () => {
    // 20 common injections of score 0.2 never helpful; 2 rare ones (propensity 0.1) were helpful.
    const rows: AttributionRow[] = [];
    const base = { injected: 1, cited: 1, session_id: null, channel: null, created_at: null } as const;
    let id = 0;
    for (let i = 0; i < 20; i++) {
      rows.push({ ...base, id: ++id, turn_id: `c${i}`, mem_type: "semantic", mem_id: String(i + 1), helpful: 0, score: 0.2, propensity: 1 });
    }
    for (let i = 0; i < 2; i++) {
      rows.push({ ...base, id: ++id, turn_id: `r${i}`, mem_type: "semantic", mem_id: String(100 + i), helpful: 1, score: 0.2, propensity: 0.1 });
    }
    const weighted = fitIsotonic(buildCalibrationSamples(rows));
    const naive = fitIsotonic(buildCalibrationSamples(rows.map((r) => ({ ...r, propensity: 1 }))));
    expect(predictIsotonic(naive, 0.2)).toBeCloseTo(2 / 22, 10);
    expect(predictIsotonic(weighted, 0.2)).toBeCloseTo(20 / 40, 10);
    expect(ipwWeight(0.1)).toBeCloseTo(10);
    expect(ipwWeight(0.001)).toBe(20); // capped
    expect(ipwWeight(null)).toBe(1);
  });

  it("an ablation verdict replaces the turn row it probed", () => {
    const base = { injected: 1, cited: 0, session_id: null, channel: null, created_at: null, propensity: null } as const;
    const rows: AttributionRow[] = [
      { ...base, id: 1, turn_id: "t1", mem_type: "semantic", mem_id: "5", helpful: null, score: 0.5, source: "turn" },
      { ...base, id: 2, turn_id: "ablation:t1", mem_type: "semantic", mem_id: "5", helpful: 1, score: 0.5, source: "ablation" },
    ];
    const samples = buildCalibrationSamples(rows);
    expect(samples).toHaveLength(1);
    expect(samples[0].y).toBe(1);
  });
});

describe("MEM-61 selection and cut", () => {
  const fit = fitIsotonic([sample(0.1, 0), sample(0.2, 0), sample(0.8, 1), sample(0.9, 1)]);

  it("scope after min injections, else global, else cold", () => {
    const scope = { ...fit, n: 200 };
    const small = { ...fit, n: 30 };
    const global = { ...fit, n: 100 };
    expect(selectCalibration({ scope, global }, 200).mode).toBe("scope");
    expect(selectCalibration({ scope: small, global }, 200).mode).toBe("global");
    expect(selectCalibration({ scope: small, global: { ...fit, n: 5 } }, 200).mode).toBe("cold");
    expect(selectCalibration({}, 200).mode).toBe("cold");
  });

  const ranked = (scores: number[]) => scores.map((score) => ({ score, pinned: false }));

  it("cold start is top-k by score", () => {
    const cut = applyCalibratedCut(ranked(Array.from({ length: 40 }, (_, i) => 1 - i / 100)), { mode: "cold", fit: null, n: 0 }, 0.35, 20);
    expect(cut).toHaveLength(20);
  });

  it("calibrated cut keeps P̂ ≥ θ and pinned rows", () => {
    const sel = { mode: "global" as const, fit, n: 100 };
    const out = applyCalibratedCut([...ranked([0.9, 0.85, 0.15]), { score: 0.1, pinned: true }], sel, 0.35, 20);
    expect(out.map((c) => c.score)).toEqual([0.9, 0.85, 0.1]);
  });

  it("starvation guard: a fit that rejects everything still keeps the best few", () => {
    const allLow = fitIsotonic([sample(0.1, 0), sample(0.5, 0), sample(0.9, 0)]);
    const sel = { mode: "global" as const, fit: allLow, n: 100 };
    const out = applyCalibratedCut(ranked([0.9, 0.8, 0.7, 0.6, 0.5]), sel, 0.35, 20);
    expect(out.map((c) => c.score)).toEqual([0.9, 0.8, 0.7].slice(0, CALIBRATED_MIN_KEEP));
  });
});

const WORDS = ["amber", "birch", "cobalt", "dune", "ember", "fjord", "garnet", "harbor", "indigo", "jasper", "kelp", "lumen"];

// ── Live search + attribution log ───────────────────────────────────────────

const testDir = path.join(os.tmpdir(), `brain-mem60-${Date.now()}`);

describe("MEM-60/61 live", () => {
  let BrainManager: typeof import("./BrainManager.js").BrainManager;
  let BrainStore: typeof import("./BrainStore.js").BrainStore;
  let RetrievalFusion: typeof import("./RetrievalFusion.js").RetrievalFusion;
  let MemoryPipeline: typeof import("./MemoryPipeline.js").MemoryPipeline;
  let refitCalibration: typeof import("./calibration.js").refitCalibration;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainManager } = await import("./BrainManager.js"));
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ RetrievalFusion } = await import("./RetrievalFusion.js"));
    ({ MemoryPipeline } = await import("./MemoryPipeline.js"));
    ({ refitCalibration } = await import("./calibration.js"));
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "global");
  });

  afterEach(() => setExplorationRng(null));

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function reset(): Promise<void> {
    const db = await BrainStore.get();
    await db.exec("DELETE FROM brain_attribution");
    await db.exec("DELETE FROM brain_calibration");
    await db.exec("DELETE FROM brain_tags");
    await db.exec("DELETE FROM brain_semantic");
    await db.exec("DELETE FROM brain_episodic");
    await db.exec("DELETE FROM brain_sessions");
    MemoryPipeline.resetInjectStateForTests();
  }

  async function seed(token: string, count: number, sessionId: string): Promise<number[]> {
    await BrainManager.trackSession(sessionId, "MEM-60", testDir);
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        await BrainManager.store({
          category: "fact",
          title: `Note ${WORDS[i % WORDS.length]}${i} ${token}`,
          content: `The ${token} subsystem ${WORDS[i % WORDS.length]}${i} handles ${WORDS[(i * 7 + 3) % WORDS.length]}${i} with ${WORDS[(i * 5 + 1) % WORDS.length]}${i * 13} rules for case ${i * 31}.`,
          keywords: `${token}, ${WORDS[i % WORDS.length]}${i}`,
          session_id: sessionId,
          importance: 0.6,
        }),
      );
    }
    return ids;
  }

  it("cold start returns the top 20 by score even with 30 matches", async () => {
    await reset();
    const token = "quartzmem61coldleaf";
    await seed(token, 30, "mem61-cold");
    const hits = await RetrievalFusion.search({ query: token, includeEpisodic: false });
    expect(hits.length).toBe(20);
    for (const h of hits) expect(h.propensity).toBe(1); // exploration off → always shown
  });

  it("every hit carries a propensity; seeded exploration is reproducible", async () => {
    await reset();
    const token = "quartzmem60explore";
    await seed(token, 12, "mem60-explore");
    const run = () =>
      RetrievalFusion.search({
        query: token,
        includeEpisodic: false,
        explore: { rate: 1, rng: seededRng(99) },
      });
    const a = await run();
    const b = await run();
    expect(a.map((h) => h.id)).toEqual(b.map((h) => h.id));
    expect(a.every((h) => h.explored === true)).toBe(true);
    for (const h of a) {
      expect(h.propensity).toBeGreaterThan(0);
      expect(h.propensity).toBeLessThanOrEqual(1);
    }
  });

  it("logs propensity and score features on the attribution row", async () => {
    await reset();
    const token = "quartzmem60logleaf";
    const sessionId = "mem60-log";
    const ids = await seed(token, 3, sessionId);
    setExplorationRng(seededRng(5));
    await MemoryPipeline.runPreTurn({ message: token, session_id: sessionId, turn_id: "t-log" });
    await MemoryPipeline.runPostTurn({
      message: "no cites",
      session_id: sessionId,
      assistant_message: "no cites here",
      turn_id: "t-log",
      turn_succeeded: true,
    });
    const db = await BrainStore.get();
    const rows = await db.all<Array<{ mem_id: string; propensity: number | null; features: string | null; source: string }>>(
      "SELECT mem_id, propensity, features, source FROM brain_attribution WHERE turn_id = 't-log'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(ids.length);
    for (const row of rows) {
      expect(row.source).toBe("turn");
      expect(row.propensity).toBeGreaterThan(0);
      const f = JSON.parse(row.features as string);
      expect(Object.keys(f).sort()).toEqual(["R", "U", "rel"]);
    }
  });

  it("a fitted scope cut replaces top-k: low-score injections stop being shown", async () => {
    await reset();
    const token = "quartzmem61fitleaf";
    await seed(token, 6, "mem61-fit");
    const first = await RetrievalFusion.search({ query: token, includeEpisodic: false });
    expect(first.length).toBe(6);
    // Global log: everything scored below the top two was never helpful, the top two always were.
    // Put the boundary between rank 2 and rank 3; labelled scores sit either side of it.
    expect(first[1].score).toBeGreaterThan(first[2].score);
    const hi = (first[1].score + first[2].score) / 2;
    const lo = first[2].score * 0.98;
    const db = await BrainStore.get();
    let n = 0;
    for (let i = 0; i < 60; i++) {
      await db.run(
        `INSERT INTO brain_attribution (turn_id, mem_type, mem_id, injected, cited, helpful, score, source)
         VALUES (?, 'semantic', ?, 1, 1, 1, ?, 'turn')`,
        [`fit-hi-${i}`, String(1000 + ++n), hi],
      );
      await db.run(
        `INSERT INTO brain_attribution (turn_id, mem_type, mem_id, injected, cited, helpful, score, source)
         VALUES (?, 'semantic', ?, 1, 1, 0, ?, 'turn')`,
        [`fit-lo-${i}`, String(1000 + ++n), lo],
      );
    }
    const fit = await refitCalibration(db);
    expect(fit.global_n).toBe(120);
    const second = await RetrievalFusion.search({ query: token, includeEpisodic: false });
    expect(second.length).toBeLessThan(first.length);
    expect(second.length).toBeGreaterThanOrEqual(CALIBRATED_MIN_KEEP);
    for (const h of second.slice(0, 2)) expect(h.calibrated_p).toBeGreaterThanOrEqual(0.35);
  });

  it("an explicit minScore keeps the leftover θ · ceiling cut", async () => {
    await reset();
    const token = "quartzmem61legacyleaf";
    await seed(token, 30, "mem61-legacy");
    const hits = await RetrievalFusion.search({ query: token, includeEpisodic: false, minScore: 0.35 });
    expect(hits.length).toBeGreaterThan(20);
  });
});
