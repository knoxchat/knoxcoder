/**
 * Batch K — MEM-55 (S₀ scaled by I₀), MEM-56 (FSRS caps, D reversion),
 * MEM-57 (fractional ω), MEM-58 (MinHash).
 */

import fs from "fs";
import os from "os";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Forgetting } from "./Forgetting.js";
import { Fsrs } from "./Fsrs.js";
import {
  encodeMinhash,
  minhashSignature,
  minhashSimilarity,
  shingles,
  signatureFromBytes,
  signatureToBytes,
} from "./minhash.js";
import {
  coverageFeatures,
  coverageSimilarity,
  selectBudgetedSubmodular,
  submodularObjective,
  type ContextCandidate,
} from "./selectContext.js";
import { utility } from "./Value.js";

const FSRS = { a: Math.exp(1.5), b: 0.2, g: 1 };

describe("MEM-55 S₀ = S_cat · 2^{2(I₀ − 0.5)}", () => {
  it("scales within [S_cat/2, 2·S_cat]", () => {
    expect(Forgetting.initialStability("fact", { i0: 0.5 })).toBeCloseTo(14, 12);
    expect(Forgetting.initialStability("fact", { i0: 1 })).toBeCloseTo(28, 12);
    expect(Forgetting.initialStability("fact", { i0: 0 })).toBeCloseTo(7, 12);
    expect(Forgetting.initialStability("decision", { i0: 1 })).toBeCloseTo(120, 12);
    expect(Forgetting.initialStability("episodic", { i0: 0 })).toBeCloseTo(0.5, 12);
  });

  it("out-of-range or missing I₀ is clamped / neutral", () => {
    expect(Forgetting.initialStability("fact", { i0: 5 })).toBeCloseTo(28, 12);
    expect(Forgetting.initialStability("fact", { i0: -3 })).toBeCloseTo(7, 12);
    expect(Forgetting.initialStability("fact", { i0: Number.NaN })).toBe(14);
    expect(Forgetting.initialStability("fact")).toBe(14);
  });

  it("summary / insight stay at 14 unless linked to a tree node", () => {
    expect(Forgetting.initialStability("summary", { i0: 1 })).toBe(14);
    expect(Forgetting.initialStability("insight", { i0: 0 })).toBe(14);
    expect(
      Forgetting.initialStability("insight", { i0: 1, linkedAsTreeNode: true, inheritStability: 60 }),
    ).toBe(60);
  });

  it("insertForgettingFields uses importance as I₀", () => {
    const f = Forgetting.insertForgettingFields("preference", 1);
    expect(f.stability).toBeCloseTo(60, 12);
    expect(f.difficulty).toBe(5);
    expect(f.i0).toBe(1);
  });
});

describe("MEM-56 FSRS caps and difficulty reversion", () => {
  it("one use at S=1, D=1, R→0 multiplies S by ≤ 10 (not ≈ 78)", () => {
    const uncapped = 1 * (1 + FSRS.a * 10 * 1 * (Math.exp(1) - 1));
    expect(uncapped).toBeGreaterThan(70);
    const next = Fsrs.nextStability(1, 1, 0, FSRS);
    expect(next).toBeLessThanOrEqual(10 + 1e-12);
    expect(next).toBeCloseTo(10, 10);
  });

  it("a memory at S_max does not grow", () => {
    expect(Fsrs.nextStability(3650, 1, 0, FSRS)).toBe(3650);
    expect(Fsrs.nextStability(3000, 1, 0, FSRS)).toBe(3650);
    expect(Fsrs.nextStability(3650, 1, 0, { ...FSRS, stabilityMax: 100 })).toBe(3650);
  });

  it("harmful floors at S_min", () => {
    const h = Fsrs.applyHarmful(0.2, 5, { stabilityMin: 0.1 });
    expect(h.stability).toBeCloseTo(0.1, 12);
    const bigger = Fsrs.applyHarmful(10, 5, { stabilityMin: 0.1 });
    expect(bigger.stability).toBeCloseTo(3, 12);
  });

  it("helpful: D ← max(1, D − 0.5), then reverts toward D₀", () => {
    expect(Fsrs.applyHelpfulDifficulty(5)).toBeCloseTo(4.525, 12);
    // floor 1: D=1 → max(1, 0.5)=1 → 0.95·1 + 0.25
    expect(Fsrs.applyHelpfulDifficulty(1)).toBeCloseTo(1.2, 12);
  });

  it("two early harmful events do not pin D = 10 forever", () => {
    let d = 5;
    let s = 14;
    for (let i = 0; i < 2; i++) ({ stability: s, difficulty: d } = Fsrs.applyFsrs(s, d, 0.5, "harmful", FSRS));
    expect(d).toBeLessThan(10);
    const harmed = d;
    // Many helpful events pull D back below the harmed value and toward D₀ = 5 then lower.
    for (let i = 0; i < 40; i++) ({ stability: s, difficulty: d } = Fsrs.applyFsrs(s, d, 0.5, "helpful", FSRS));
    expect(d).toBeLessThan(harmed);
    // Pure reversion from 10 (no further events) approaches D₀.
    let x = 10;
    for (let i = 0; i < 200; i++) x = Fsrs.revertDifficulty(x, FSRS);
    expect(x).toBeCloseTo(5, 3);
  });

  it("unused changes nothing (no reversion)", () => {
    expect(Fsrs.applyFsrs(14, 7, 0.4, "unused", FSRS)).toEqual({ stability: 14, difficulty: 7 });
  });

  it("stability never decreases on a helpful use", () => {
    for (const s of [0.1, 1, 14, 500, 3650]) {
      for (const r of [0, 0.3, 0.9, 1]) {
        expect(Fsrs.nextStability(s, 5, r, FSRS)).toBeGreaterThanOrEqual(s - 1e-12);
      }
    }
  });
});

describe("MEM-57 fractional unhelpful evidence", () => {
  let testDir: string;
  let BrainStore: typeof import("./BrainStore.js").BrainStore;
  let BrainManager: typeof import("./BrainManager.js").BrainManager;

  beforeAll(async () => {
    testDir = path.join(os.tmpdir(), `brain-forget-math-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, "memory"), { recursive: true });
    process.env.KNOX_GLOBAL_DIR = testDir;
    ({ BrainStore } = await import("./BrainStore.js"));
    ({ BrainManager } = await import("./BrainManager.js"));
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("50 uncited injections → u = 5, U = I₀/2", async () => {
    const id = await BrainManager.store({
      category: "fact",
      title: "Omega fact",
      content: "quartzomegaleaf is never cited by any turn.",
      importance: 0.8,
    });
    for (let i = 0; i < 50; i++) {
      await BrainStore.incrementUtilityCounts("semantic", id, { unhelpful: 0.1 });
    }
    const db = await BrainStore.get();
    const row = await db.get<{ helpful_count: number; unhelpful_count: number; i0: number; stability: number }>(
      "SELECT helpful_count, unhelpful_count, i0, stability FROM brain_semantic WHERE id = ?",
      [id],
    );
    expect(row!.helpful_count).toBe(0);
    expect(row!.unhelpful_count).toBeCloseTo(5, 8);
    expect(utility(row!.helpful_count, row!.unhelpful_count, row!.i0)).toBeCloseTo(row!.i0 / 2, 8);
    // No stability change for uncited injections.
    expect(row!.stability).toBeCloseTo(14 * 2 ** 0.6, 10);
  });

  it("a correction still adds a whole 1", async () => {
    const id = await BrainManager.store({
      category: "fact",
      title: "Correction fact",
      content: "quartzcorrectionleaf gets corrected once.",
    });
    await BrainStore.incrementUtilityCounts("semantic", id, { unhelpful: 0.1 });
    await BrainStore.incrementUtilityCounts("semantic", id, { unhelpful: 1 });
    const db = await BrainStore.get();
    const row = await db.get<{ unhelpful_count: number }>(
      "SELECT unhelpful_count FROM brain_semantic WHERE id = ?",
      [id],
    );
    expect(row!.unhelpful_count).toBeCloseTo(1.1, 10);
  });
});

describe("MEM-58 MinHash", () => {
  const A =
    "The auth service issues JWT access tokens and refreshes them every fifteen minutes using the oauth refresh flow";

  it("is deterministic and 128 permutations by default", () => {
    const a = minhashSignature(A);
    const b = minhashSignature(A);
    expect(a.length).toBe(128);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("identical text → 1; case and spacing do not matter", () => {
    expect(minhashSimilarity(minhashSignature(A), minhashSignature(A.toUpperCase().replace(/ /g, "  ")))).toBe(1);
  });

  it("near-duplicates are close to their true Jaccard; unrelated text is near 0", () => {
    const near = `${A} today`;
    const truth = (() => {
      const x = shingles(A);
      const y = shingles(near);
      let i = 0;
      for (const s of x) if (y.has(s)) i++;
      return i / (x.size + y.size - i);
    })();
    const est = minhashSimilarity(minhashSignature(A), minhashSignature(near));
    expect(Math.abs(est - truth)).toBeLessThan(0.15);
    expect(truth).toBeGreaterThan(0.85);

    const other = "grocery list: eggs, butter, flour, sugar and two ripe bananas for the weekend";
    expect(minhashSimilarity(minhashSignature(A), minhashSignature(other))).toBeLessThan(0.1);
  });

  it("short texts (< 3 tokens) compare as one shingle; empty text matches nothing", () => {
    expect(minhashSimilarity(minhashSignature("use bun"), minhashSignature("Use  BUN"))).toBe(1);
    expect(minhashSimilarity(minhashSignature("use bun"), minhashSignature("use npm"))).toBe(0);
    expect(minhashSimilarity(minhashSignature(""), minhashSignature(""))).toBe(0);
    expect(encodeMinhash("   ")).toBeNull();
  });

  it("round-trips through BLOB bytes", () => {
    const sig = minhashSignature(A);
    const back = signatureFromBytes(signatureToBytes(sig));
    expect(back && Array.from(back)).toEqual(Array.from(sig));
    expect(signatureFromBytes(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(signatureFromBytes(null)).toBeNull();
  });

  it("sim ≥ 0 and symmetric; near-duplicates add near-zero coverage", () => {
    const texts = [A, `${A} today`, "grocery list eggs butter flour sugar bananas weekend", "use bun for packages"];
    const feats = texts.map((t) => coverageFeatures(t));
    for (const x of feats) {
      for (const y of feats) {
        const s = coverageSimilarity(x, y);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
        expect(s).toBe(coverageSimilarity(y, x));
      }
    }

    const cand = (key: string, text: string, score: number): ContextCandidate => ({
      key,
      kind: "semantic",
      score,
      tokens: 10,
      text,
      features: coverageFeatures(text),
      item: { id: 1, kind: "semantic", mem_id: "1" } as never,
    });
    const pool = [cand("a", A, 1), cand("dup", `${A} today`, 1), cand("other", texts[2]!, 1)];
    const f = (keys: string[]) =>
      submodularObjective(
        pool.filter((c) => keys.includes(c.key)),
        pool,
      );
    // Monotone.
    expect(f(["a", "other"])).toBeGreaterThanOrEqual(f(["a"]));
    // Submodular: adding `dup` to {a} gains less than adding it to {} .
    const gainEmpty = f(["dup"]) - f([]);
    const gainWithA = f(["a", "dup"]) - f(["a"]);
    expect(gainWithA).toBeLessThanOrEqual(gainEmpty + 1e-9);
    // Under a budget for two items, greedy prefers the distinct memory over the duplicate.
    const picked = selectBudgetedSubmodular(pool, 20).selected.map((c) => c.key).sort();
    expect(picked).toContain("other");
    expect(picked.filter((k) => k === "a" || k === "dup")).toHaveLength(1);
  });

  it("uses the stored signature when the row has one", () => {
    const stored = encodeMinhash("alpha beta gamma delta epsilon zeta eta theta");
    const f = coverageFeatures("totally different words here today", [], stored);
    const g = coverageFeatures("alpha beta gamma delta epsilon zeta eta theta");
    expect(coverageSimilarity(f, g)).toBe(1);
  });
});
