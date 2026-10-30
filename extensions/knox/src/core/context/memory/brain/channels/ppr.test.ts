/**
 * MEM-25 — hub-damped push-PPR (pure).
 */
import { describe, expect, it } from "vitest";

import {
  PPR_ALPHA_DEFAULT,
  PPR_EPSILON_DEFAULT,
  exactPersonalizedPageRank,
  graphChannelScore,
  graphViewFromEdges,
  hubDampedTransitions,
  normalizeSeedMass,
  pprMass,
  pushPersonalizedPageRankSync,
  resolvePprAlpha,
  topPprEntities,
} from "./ppr.js";

describe("MEM-25 PPR helpers", () => {
  it("defaults are α=0.15 and a (0,1) ε", () => {
    expect(PPR_ALPHA_DEFAULT).toBe(0.15);
    expect(resolvePprAlpha(undefined)).toBe(0.15);
    expect(resolvePprAlpha(0)).toBe(0.15);
    expect(resolvePprAlpha(1)).toBe(0.15);
    expect(PPR_EPSILON_DEFAULT).toBeGreaterThan(0);
    expect(PPR_EPSILON_DEFAULT).toBeLessThan(1);
  });

  it("normalizes the query indicator e_q", () => {
    expect([...normalizeSeedMass([7, 7, 9]).entries()]).toEqual([
      [7, 2 / 3],
      [9, 1 / 3],
    ]);
    expect(normalizeSeedMass(new Map([[1, 0], [2, -1]])).size).toBe(0);
  });

  it("damps a hub destination relative to a leaf", () => {
    const neighbors = [
      { id: 2, weight: 1 },
      { id: 3, weight: 1 },
    ];
    const degreeOf = (id: number) => (id === 2 ? 9 : 1);
    const row = hubDampedTransitions(neighbors, degreeOf);
    const toHub = row.find((s) => s.id === 2)?.probability ?? 0;
    const toLeaf = row.find((s) => s.id === 3)?.probability ?? 0;
    expect(toLeaf).toBeGreaterThan(toHub);
    expect(toHub + toLeaf).toBeCloseTo(1, 10);
  });
});

describe("MEM-25 push-PPR", () => {
  it("approximates exact PPR on a path and personalizes the seed", () => {
    const view = graphViewFromEdges([
      { source: 1, target: 2, weight: 1 },
      { source: 2, target: 3, weight: 1 },
    ]);
    const exact = exactPersonalizedPageRank([1], view, { alpha: 0.15 });
    const approx = pushPersonalizedPageRankSync([1], view, { alpha: 0.15, epsilon: 1e-6 });

    expect(exact.get(1) ?? 0).toBeGreaterThan(exact.get(3) ?? 0);
    expect(exact.get(3) ?? 0).toBeGreaterThan(0);
    expect(pprMass(exact)).toBeCloseTo(1, 8);

    for (const id of [1, 2, 3]) {
      expect(approx.scores.get(id) ?? 0).toBeCloseTo(exact.get(id) ?? 0, 3);
    }
    expect(approx.depths.get(1)).toBe(0);
    expect(approx.depths.get(2)).toBe(1);
    expect(approx.depths.get(3)).toBe(2);
    expect(approx.pushes).toBeLessThan(1 / (0.15 * 1e-6) + 1);
  });

  it("does not spray mass through a hub the way uniform BFS would", () => {
    const edges = [
      { source: 1, target: 2, weight: 1 },
      { source: 1, target: 3, weight: 1 },
    ];
    for (let i = 10; i < 18; i++) {
      edges.push({ source: 2, target: i, weight: 1 });
    }
    const view = graphViewFromEdges(edges);
    const fromSeed = hubDampedTransitions(view.neighbors(1), view.degree);
    expect(fromSeed.find((s) => s.id === 3)!.probability).toBeGreaterThan(
      fromSeed.find((s) => s.id === 2)!.probability,
    );

    const result = pushPersonalizedPageRankSync([1], view, { alpha: 0.15, epsilon: 1e-5 });
    expect(result.scores.get(3) ?? 0).toBeGreaterThan(0);
    expect(result.scores.get(2) ?? 0).toBeGreaterThan(0);
    // A far dummy spoke of the hub stays below the seed's leaf.
    expect(result.scores.get(10) ?? 0).toBeLessThan(result.scores.get(3) ?? 0);
  });

  it("cost stays independent of a disconnected component", () => {
    const edges = [
      { source: 1, target: 2, weight: 1 },
    ];
    for (let i = 100; i < 300; i++) {
      edges.push({ source: i, target: i + 1, weight: 1 });
    }
    const view = graphViewFromEdges(edges);
    const result = pushPersonalizedPageRankSync([1], view, { alpha: 0.15, epsilon: 1e-4 });
    expect(result.scores.has(100)).toBe(false);
    expect(result.scores.get(1) ?? 0).toBeGreaterThan(0);
    expect(result.pushes).toBeLessThan(200);
    expect(result.pushes).toBeLessThan(1 / (0.15 * 1e-4) + 1);
  });

  it("S_graph is the max π over entities in the memory", () => {
    const ppr = new Map([
      [1, 0.4],
      [2, 0.25],
      [3, 0.05],
    ]);
    expect(graphChannelScore(ppr, [3, 2])).toBe(0.25);
    expect(graphChannelScore(ppr, [9])).toBe(0);
    expect(topPprEntities(ppr, 2).map((row) => row.id)).toEqual([1, 2]);
  });
});
