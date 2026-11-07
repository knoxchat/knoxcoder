/**
 * MEM-53 — database half of the summary-tree term sketches.
 *
 * Sketches are written synchronously on insert (φ₅). Summary **text** is the
 * only part deferred to φ₇. No dependency on `BrainStore` so invariants and
 * sleep can use this without an import cycle.
 */

import type { DatabaseConnection } from "../../../../util/refreshIndex.js";
import {
  bloomAdd,
  bloomBitsForHeight,
  bloomFromTerms,
  bloomHas,
  bloomNew,
  mergeTermCounts,
  parseLeafTerms,
  parseTermCounts,
  serializeLeafTerms,
  serializeTermCounts,
  sketchTerms,
  toBytes,
  type TermCounts,
} from "../treeSketch.js";

type NodeRow = {
  id: number;
  parent_id: number | null;
  kind: string;
  text: string;
  sketch_bloom: unknown;
  sketch_terms: string | null;
};

/** JSON term list stored on a leaf row. */
export function leafTermsJson(fullText: string): string {
  return serializeLeafTerms(sketchTerms(fullText));
}

/** A leaf's terms: the stored list, else derived from its display text (legacy rows). */
function termsOfLeaf(row: { sketch_terms: string | null; text: string }): string[] {
  const stored = parseLeafTerms(row.sketch_terms);
  return stored.length > 0 ? stored : sketchTerms(row.text ?? "");
}

/** Empty (all-zero) sketch for a freshly created node of the given height. */
export function emptyNodeSketch(height: number): { bloom: Uint8Array; terms: string } {
  return { bloom: bloomNew(bloomBitsForHeight(height)), terms: "{}" };
}

/**
 * Merge a leaf's terms into every ancestor, starting at the leaf's parent.
 * A node without a sketch (legacy / restored snapshot) is rebuilt from its
 * descendants instead; that already includes this leaf.
 */
export async function addTermsToAncestors(
  db: DatabaseConnection,
  startNodeId: number,
  terms: readonly string[],
): Promise<void> {
  const seen = new Set<number>();
  let current: number | null = startNodeId;
  while (current != null && current > 0 && !seen.has(current)) {
    seen.add(current);
    const row: { parent_id: number | null; sketch_bloom: unknown; sketch_terms: string | null } | undefined =
      await db.get("SELECT parent_id, sketch_bloom, sketch_terms FROM brain_summary_tree WHERE id = ?", [
        current,
      ]);
    if (!row) return;
    const bloom = toBytes(row.sketch_bloom);
    if (!bloom) {
      await rebuildSubtreeSketches(db, current);
    } else {
      const copy = Uint8Array.from(bloom);
      for (const t of terms) bloomAdd(copy, t);
      const counts = mergeTermCounts(parseTermCounts(row.sketch_terms), terms);
      await db.run("UPDATE brain_summary_tree SET sketch_bloom = ?, sketch_terms = ? WHERE id = ?", [
        Buffer.from(copy),
        serializeTermCounts(counts),
        current,
      ]);
    }
    current = row.parent_id;
  }
}

/**
 * Recompute every sketch under `nodeId` (post-order) from the leaves.
 * Returns the full term → leaf-count map and the node height.
 */
export async function rebuildSubtreeSketches(
  db: DatabaseConnection,
  nodeId: number,
): Promise<{ counts: TermCounts; height: number }> {
  const children = (await db.all(
    `SELECT id, parent_id, kind, text, sketch_terms FROM brain_summary_tree
      WHERE parent_id = ? ORDER BY id`,
    [nodeId],
  )) as NodeRow[];

  const counts: TermCounts = {};
  let height = 0;
  let hasNodeChild = false;
  for (const child of children) {
    if (child.kind === "node") {
      hasNodeChild = true;
      const sub = await rebuildSubtreeSketches(db, child.id);
      height = Math.max(height, sub.height + 1);
      for (const [t, n] of Object.entries(sub.counts)) counts[t] = (counts[t] ?? 0) + n;
    } else {
      for (const t of termsOfLeaf(child)) counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  if (!hasNodeChild) height = 0;

  const bloom = bloomFromTerms(Object.keys(counts), bloomBitsForHeight(height));
  await db.run("UPDATE brain_summary_tree SET sketch_bloom = ?, sketch_terms = ? WHERE id = ?", [
    Buffer.from(bloom),
    serializeTermCounts(counts),
    nodeId,
  ]);
  return { counts, height };
}

export interface StaleSketch {
  leaf_tree_id: number;
  node_id: number | null;
  reason: "missing" | "term_absent";
}

/**
 * Freshness probe (MEM-54): for the most recent linked leaves, every ancestor
 * must carry a sketch that contains the leaf's terms. A miss means a write
 * reached the tree without its sketch update.
 */
export async function findStaleSketches(
  db: DatabaseConnection,
  options: { limit?: number } = {},
): Promise<{ checked: number; stale: StaleSketch[] }> {
  const limit = Math.max(1, options.limit ?? 50);
  const leaves = (await db.all(
    `SELECT id, parent_id, kind, text, sketch_terms FROM brain_summary_tree
      WHERE kind = 'leaf' ORDER BY id DESC LIMIT ?`,
    [limit],
  )) as NodeRow[];

  const stale: StaleSketch[] = [];
  for (const leaf of leaves) {
    const terms = termsOfLeaf(leaf).slice(0, 20);
    let current = leaf.parent_id;
    const seen = new Set<number>();
    while (current != null && current > 0 && !seen.has(current)) {
      seen.add(current);
      const node = (await db.get(
        "SELECT id, parent_id, sketch_bloom FROM brain_summary_tree WHERE id = ?",
        [current],
      )) as { id: number; parent_id: number | null; sketch_bloom: unknown } | undefined;
      if (!node) break;
      const bloom = toBytes(node.sketch_bloom);
      if (!bloom) {
        stale.push({ leaf_tree_id: leaf.id, node_id: node.id, reason: "missing" });
        break;
      }
      if (terms.some((t) => !bloomHas(bloom, t))) {
        stale.push({ leaf_tree_id: leaf.id, node_id: node.id, reason: "term_absent" });
        break;
      }
      current = node.parent_id;
    }
  }
  return { checked: leaves.length, stale };
}
