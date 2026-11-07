/**
 * MEM-66 — reserved candidate slots for tree-routed leaves.
 *
 * Candidates = top `fusedCap` fused **plus** every tree-routed leaf
 * (≤ `B·b`, or `tree_reserved_slots` when that is set). Other channels
 * can add, never evict a tree-routed leaf.
 */

export interface ReservedRanked {
  key: string;
}

export function resolveReservedTreeSlots(input: {
  configured: number;
  beam: number;
  branching: number;
}): number {
  if (Number.isFinite(input.configured) && input.configured > 0) {
    return Math.floor(input.configured);
  }
  const beam = Math.max(1, Math.floor(input.beam) || 1);
  const branching = Math.max(1, Math.floor(input.branching) || 1);
  return beam * branching;
}

/**
 * Keep the fused head, then append tree-routed keys that the head dropped,
 * in the original rank order, up to `reservedCap`.
 */
export function mergeReservedCandidates<T extends ReservedRanked>(
  ranked: readonly T[],
  fusedCap: number,
  treeKeys: ReadonlySet<string>,
  reservedCap: number,
): T[] {
  const cap = Math.max(1, Math.floor(fusedCap) || 1);
  const extra = Math.max(0, Math.floor(reservedCap) || 0);
  const head = ranked.slice(0, cap);
  if (extra <= 0 || treeKeys.size === 0) return head;
  const seen = new Set(head.map((r) => r.key));
  const out = [...head];
  let added = 0;
  for (const row of ranked) {
    if (seen.has(row.key)) continue;
    if (!treeKeys.has(row.key)) continue;
    out.push(row);
    seen.add(row.key);
    if (++added >= extra) break;
  }
  return out;
}
