/**
 * MC-40 / MC-41: pure self-review over recorded history. Produces structured findings and
 * safe memory-update proposals. Nothing here writes; the sleep job applies the safe subset.
 */

import type { Recipe } from "./types";

export const REPEAT_THRESHOLD = 3;

export type ReviewEventKind = "tool_error" | "build_fail" | "user_correction" | "revert";

export interface ReviewEvent {
  kind: ReviewEventKind;
  /** Error text, correction text, or file path for reverts. */
  text: string;
  recipeId?: string;
  at?: string;
}

export interface Finding {
  kind: ReviewEventKind;
  signature: string;
  count: number;
  recipeIds: string[];
}

/** Collapse volatile parts (numbers, hex, paths, quotes) so equal failures share a signature. */
export function errorSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/(?:[a-z]:)?[\\/][^\s:'"]+/g, "<path>")
    .replace(/0x[0-9a-f]+|\b[0-9a-f]{7,}\b/g, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/["'`][^"'`]*["'`]/g, "<q>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function findRepeats(events: ReviewEvent[], threshold = REPEAT_THRESHOLD): Finding[] {
  const groups = new Map<string, Finding>();
  for (const e of events) {
    const signature = errorSignature(e.text);
    const key = `${e.kind}\u0000${signature}`;
    let f = groups.get(key);
    if (!f) groups.set(key, (f = { kind: e.kind, signature, count: 0, recipeIds: [] }));
    f.count++;
    if (e.recipeId && !f.recipeIds.includes(e.recipeId)) f.recipeIds.push(e.recipeId);
  }
  return [...groups.values()]
    .filter((f) => f.count >= threshold)
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
}

export type MemoryUpdate =
  | { action: "add_error_fix"; signature: string; count: number }
  | { action: "quarantine_recipe"; recipeId: string; reason: string }
  | { action: "merge_recipes"; keepId: string; dropIds: string[] };

function score(r: Recipe): number {
  return r.stats.ok * 2 - r.stats.reverted * 3 - r.stats.failedVerify * 2 + (r.status === "verified" ? 5 : 0);
}

/** Group live recipes with the same project + fingerprint + step shape; keep the best by stats. */
export function findDuplicateRecipes(recipes: Recipe[]): { keepId: string; dropIds: string[] }[] {
  const groups = new Map<string, Recipe[]>();
  for (const r of recipes) {
    if (r.status === "retired" || r.status === "quarantined") continue;
    const shape = r.steps.map((s) => `${s.kind}:${s.path ?? s.command ?? ""}`).join("|");
    const key = `${r.projectId}\u0000${r.intentFingerprint}\u0000${shape}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const out: { keepId: string; dropIds: string[] }[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => score(b) - score(a) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    out.push({ keepId: sorted[0].id, dropIds: sorted.slice(1).map((r) => r.id) });
  }
  return out;
}

/** Merged stats the surviving recipe should carry (sum of all members). */
export function mergedStats(group: Recipe[]): Recipe["stats"] {
  return group.reduce(
    (a, r) => ({
      replays: a.replays + r.stats.replays,
      ok: a.ok + r.stats.ok,
      reverted: a.reverted + r.stats.reverted,
      failedVerify: a.failedVerify + r.stats.failedVerify,
    }),
    { replays: 0, ok: 0, reverted: 0, failedVerify: 0 },
  );
}

export function planMemoryUpdates(events: ReviewEvent[], recipes: Recipe[], threshold = REPEAT_THRESHOLD): MemoryUpdate[] {
  const updates: MemoryUpdate[] = [];
  const live = new Set(recipes.filter((r) => r.status === "verified" || r.status === "candidate").map((r) => r.id));
  for (const f of findRepeats(events, threshold)) {
    if (f.kind === "tool_error" || f.kind === "build_fail") {
      updates.push({ action: "add_error_fix", signature: f.signature, count: f.count });
    }
    if (f.kind === "build_fail" || f.kind === "revert") {
      for (const id of f.recipeIds) {
        if (live.has(id)) updates.push({ action: "quarantine_recipe", recipeId: id, reason: `${f.kind} x${f.count}: ${f.signature}` });
      }
    }
  }
  for (const d of findDuplicateRecipes(recipes)) updates.push({ action: "merge_recipes", ...d });
  return updates;
}
