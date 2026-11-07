/**
 * MEM-68 — beam capacity (A4).
 *
 * If the first hop returns more than `B` distinct tree-routed leaves, the
 * planner re-plans (H→P) and Hippocampus runs a second retrieval hop.
 * The share of queries with `|G_W| > B` is published for the bench.
 */

export interface BeamCapacityStats {
  queries: number;
  over_beam: number;
}

let queries = 0;
let overBeam = 0;

export function treeRoutedCount(hits: ReadonlyArray<{ ranks?: { tree?: number }; scores?: { tree?: number } }>): number {
  let n = 0;
  for (const hit of hits) {
    const rank = hit.ranks?.tree;
    if (rank != null && Number.isFinite(rank) && rank >= 1) {
      n++;
      continue;
    }
    if ((hit.scores?.tree ?? 0) > 0) n++;
  }
  return n;
}

export function exceedsBeamCapacity(leafCount: number, beam: number): boolean {
  const b = Math.max(1, Math.floor(beam) || 1);
  return leafCount > b;
}

export function recordBeamCapacity(over: boolean): void {
  queries += 1;
  if (over) overBeam += 1;
}

export function beamCapacityStats(): BeamCapacityStats {
  return { queries, over_beam: overBeam };
}

/** Share of recorded queries with |G_W| > B. `null` until anything is recorded. */
export function beamCapacityShare(): number | null {
  if (queries <= 0) return null;
  return overBeam / queries;
}

export function resetBeamCapacityForTests(): void {
  queries = 0;
  overBeam = 0;
}

export const BeamCapacity = {
  treeRoutedCount,
  exceedsBeamCapacity,
  record: recordBeamCapacity,
  stats: beamCapacityStats,
  share: beamCapacityShare,
  resetForTests: resetBeamCapacityForTests,
};
