/**
 * RecipeMatcher (MC-21): given the user's message, rank the recipes worth
 * reusing and say why.
 *
 * Pipeline: exact intent-fingerprint match -> fusion retrieval evidence ->
 * rerank by track record. Pure: the host runs `RetrievalFusion` (recipes are
 * linked to `workflow` memories by MC-17) and passes the hits in, so this
 * stays testable and never touches the DB.
 *
 * Only `verified` recipes are ever returned (README rule 1). `candidate`,
 * `quarantined` and `retired` recipes are invisible here.
 */

import { computeIntentFingerprint, fingerprintSimilarity } from "./intentFingerprint.js";
import type { Recipe } from "./types.js";

/** Scores at or above this may drive replay (exact/adapt). Below it, only suggest. */
export const REPLAY_THRESHOLD = 0.85;
/** Below this a recipe is not worth mentioning at all. */
export const MIN_MATCH_SCORE = 0.3;

const FINGERPRINT_WEIGHT = 0.7;
const FUSION_WEIGHT = 0.3;

export type MatchReason = "fingerprint_exact" | "fingerprint_similar_fusion" | "fingerprint_similar";

export interface FusionHit {
  /** Semantic memory id (matches `Recipe.memoryId`). */
  memoryId: number;
  /** Fusion score 0..1. */
  score: number;
}

export interface RecipeMatch {
  recipe: Recipe;
  /** Final score 0..1 after rerank. */
  score: number;
  reason: MatchReason;
  /** Human-readable explanation (shown by MC-25). */
  why: string;
  fingerprintSimilarity: number;
  fusionScore: number;
  /** True when `score >= REPLAY_THRESHOLD`. */
  replayable: boolean;
}

export interface MatchArgs {
  message: string;
  recipes: readonly Recipe[];
  fusionHits?: readonly FusionHit[];
  /** Project being worked in. Project-scope recipes of any other project (or with no project id given) never match. */
  projectId?: string;
  limit?: number;
}

/**
 * MC-82 / MC-90: project-scope recipes never apply outside the capture project.
 * Global recipes always apply. Missing project id is fail-closed (MC-53).
 */
export function recipeAppliesInProject(
  recipe: Pick<Recipe, "scope" | "projectId">,
  projectId: string | undefined,
): boolean {
  if (recipe.scope !== "project") {
    return true;
  }
  return Boolean(projectId) && recipe.projectId === projectId;
}

/** 1 for a clean track record, down to 0.5 for one that mostly reverts or fails. */
export function trackRecordFactor(stats: Recipe["stats"]): number {
  const bad = stats.reverted + stats.failedVerify;
  const total = stats.ok + bad;
  if (total === 0) return 1;
  return 1 - 0.5 * (bad / total);
}

export function matchRecipes(args: MatchArgs): RecipeMatch[] {
  const fp = computeIntentFingerprint(args.message).key;
  if (!fp) return [];
  const fusion = new Map<number, number>();
  for (const h of args.fusionHits ?? []) {
    fusion.set(h.memoryId, Math.max(fusion.get(h.memoryId) ?? 0, Math.min(1, Math.max(0, h.score))));
  }

  const out: RecipeMatch[] = [];
  for (const recipe of args.recipes) {
    if (recipe.status !== "verified") continue;
    // MC-53: fail closed. Without a project id only explicitly promoted global recipes can match.
    if (!recipeAppliesInProject(recipe, args.projectId)) continue;

    const sim = recipe.intentFingerprint === fp ? 1 : fingerprintSimilarity(fp, recipe.intentFingerprint);
    // Fusion is supporting evidence only: no lexical intent overlap, no match.
    if (sim === 0) continue;
    const fus = recipe.memoryId != null ? (fusion.get(recipe.memoryId) ?? 0) : 0;
    let base: number;
    let reason: MatchReason;
    if (sim === 1) {
      base = 1;
      reason = "fingerprint_exact";
    } else {
      base = FINGERPRINT_WEIGHT * sim + FUSION_WEIGHT * fus;
      reason = fus > 0 ? "fingerprint_similar_fusion" : "fingerprint_similar";
    }
    const score = Math.round(base * trackRecordFactor(recipe.stats) * 1000) / 1000;
    if (score < MIN_MATCH_SCORE) continue;

    const why =
      reason === "fingerprint_exact"
        ? "same intent as a verified recipe"
        : `similar intent (${Math.round(sim * 100)}% overlap${fus > 0 ? `, memory match ${Math.round(fus * 100)}%` : ""})`;
    out.push({
      recipe,
      score,
      reason,
      why: recipe.stats.reverted + recipe.stats.failedVerify > 0 ? `${why}; has ${recipe.stats.reverted} reverts, ${recipe.stats.failedVerify} failed verifies` : why,
      fingerprintSimilarity: sim,
      fusionScore: fus,
      replayable: score >= REPLAY_THRESHOLD,
    });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      b.recipe.stats.ok - a.recipe.stats.ok ||
      (b.recipe.lastReplayedAt ?? b.recipe.updatedAt).localeCompare(a.recipe.lastReplayedAt ?? a.recipe.updatedAt) ||
      a.recipe.id.localeCompare(b.recipe.id),
  );
  return out.slice(0, args.limit ?? 5);
}

export function bestMatch(args: MatchArgs): RecipeMatch | undefined {
  return matchRecipes({ ...args, limit: 1 })[0];
}
