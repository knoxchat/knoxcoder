/**
 * RecipeMatcher (MC-21): given the user's message, rank the recipes worth
 * reusing and say why.
 *
 * Pipeline: exact intent-fingerprint match -> fusion retrieval evidence ->
 * file/buffer overlap -> rerank by track record. Pure scoring: the host
 * retrieves Ω(q) via `RecipeStore.search` / `matchRecipesFromChannel` (MEM-34)
 * and passes those candidates in. Do not feed `RecipeStore.list` (the 1000-row
 * inventory page) as the recall path.
 *
 * Only `verified` recipes are ever returned (README rule 1). `candidate`,
 * `quarantined` and `retired` recipes are invisible here.
 *
 * Lexical floor: no shared fingerprint tokens → no match. Fusion and file
 * overlap may lift a similar hit; they cannot admit a miss with Jaccard 0.
 */

import { pickBestVariant } from "./family.js";
import { RECIPE_PIN_BOOST } from "./inspector.js";
import { computeIntentFingerprint, extractMentionedPaths, fingerprintSimilarity } from "./intentFingerprint.js";
import { slotCandidates } from "./slots.js";
import type { Recipe, RecipeSearchFilter, RecipeStatus } from "./types.js";
import { RECIPE_CHANNEL_CANDIDATE_CAP } from "./types.js";

export { RECIPE_CHANNEL_CANDIDATE_CAP };

/** Scores at or above this may drive replay (exact/adapt). Below it, only suggest. */
export const REPLAY_THRESHOLD = 0.85;
/** Below this a recipe is not worth mentioning at all. */
export const MIN_MATCH_SCORE = 0.3;

/** Explicit, testable mix. Fingerprint stays the majority so overlap cannot buy a replay alone. */
export const FINGERPRINT_WEIGHT = 0.7;
export const FUSION_WEIGHT = 0.15;
export const OVERLAP_WEIGHT = 0.15;

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
  /** Overlap of recipe paths with message / open-editor paths, 0..1. */
  fileOverlap: number;
  /** True when `score >= REPLAY_THRESHOLD`. */
  replayable: boolean;
}

export interface MatchArgs {
  message: string;
  /** Ω(q) candidates from the recipe channel — not an inventory dump. */
  recipes: readonly Recipe[];
  fusionHits?: readonly FusionHit[];
  /** Project being worked in. Project-scope recipes of any other project (or with no project id given) never match. */
  projectId?: string;
  /** Open / recently edited paths: variant pick + file-overlap evidence. */
  openPaths?: readonly string[];
  /** Extra paths (e.g. @-mentions) counted toward file overlap. */
  mentionedPaths?: readonly string[];
  limit?: number;
}

export interface RecipeChannelSearch {
  searchVisibleTo(projectId: string, filter?: Omit<RecipeSearchFilter, "projectId">): Promise<Recipe[]>;
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

export function recipeStepPaths(recipe: Pick<Recipe, "steps">): string[] {
  return recipe.steps.filter((s) => s.path).map((s) => s.path!.replace(/\\/g, "/"));
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

/**
 * 1 when the same relative paths appear, 0.5-scaled when only directories match.
 * Empty either side is 0 — overlap never invents a match.
 */
export function fileOverlapScore(recipePaths: readonly string[], evidencePaths: readonly string[]): number {
  const rec = [...new Set(recipePaths.map(normalizePath).filter(Boolean))];
  const ev = [...new Set(evidencePaths.map(normalizePath).filter(Boolean))];
  if (rec.length === 0 || ev.length === 0) return 0;
  const recSet = new Set(rec);
  let exact = 0;
  for (const p of ev) if (recSet.has(p)) exact++;
  if (exact > 0) return Math.min(1, exact / Math.min(rec.length, ev.length));
  const recDirs = new Set(rec.map(dirname).filter(Boolean));
  if (recDirs.size === 0) return 0;
  let dirHits = 0;
  for (const p of ev) if (recDirs.has(dirname(p))) dirHits++;
  if (dirHits === 0) return 0;
  return Math.round(0.5 * (dirHits / ev.length) * 1000) / 1000;
}

function tokenSet(fp: string): Set<string> {
  return new Set(fp.split(" ").filter(Boolean));
}

function dropSlotTokens(recipe: Recipe, message: string): Set<string> {
  const drop = new Set<string>();
  for (const slot of recipe.slots) {
    for (const v of [...(slot.examples ?? []), recipe.slotValues?.[slot.name] ?? ""]) {
      if (!v) continue;
      for (const t of computeIntentFingerprint(v).tokens) drop.add(t);
    }
    for (const v of slotCandidates(message, slot.kind)) {
      for (const t of computeIntentFingerprint(v).tokens) drop.add(t);
    }
  }
  return drop;
}

/** Intent overlap after treating known slot values as interchangeable. */
export function familyFingerprintSimilarity(messageFp: string, message: string, recipe: Recipe): number {
  const raw =
    recipe.intentFingerprint === messageFp ? 1 : fingerprintSimilarity(messageFp, recipe.intentFingerprint);
  if (!recipe.slots.length) return raw;
  const drop = dropSlotTokens(recipe, message);
  if (drop.size === 0) return raw;
  const strip = (fp: string) => [...tokenSet(fp)].filter((t) => !drop.has(t)).sort().join(" ");
  const a = strip(messageFp);
  const b = strip(recipe.intentFingerprint);
  if (!a || !b) return raw;
  const msgSet = tokenSet(a);
  const recSet = tokenSet(b);
  if (a === b) return 1;
  // "create a component" vs "create a React component Button": after stripping
  // slot values, the user's tokens are a subset of the procedure's tokens.
  if (msgSet.size >= 2 && [...msgSet].every((t) => recSet.has(t))) return 1;
  if (recSet.size >= 2 && [...recSet].every((t) => msgSet.has(t))) return 1;
  const slotted = fingerprintSimilarity(a, b);
  return Math.max(raw, slotted);
}

function describeWhy(recipe: Recipe, fp: string, sim: number, fus: number, overlap: number, reason: MatchReason): string {
  const title = recipe.title || recipe.intentFingerprint;
  if (recipe.intentFingerprint === fp) return "same intent as a verified recipe";
  if (reason === "fingerprint_exact") return "same kind of work as a verified recipe (parameterized)";
  const pct = Math.round(sim * 100);
  const bits = [`${pct}% overlap`];
  if (fus > 0) bits.push(`memory match ${Math.round(fus * 100)}%`);
  if (overlap > 0) bits.push("files overlap");
  return `similar to "${title}", ${bits.join(", ")}`;
}

export function matchRecipes(args: MatchArgs): RecipeMatch[] {
  const fp = computeIntentFingerprint(args.message).key;
  if (!fp) return [];
  const fusion = new Map<number, number>();
  for (const h of args.fusionHits ?? []) {
    fusion.set(h.memoryId, Math.max(fusion.get(h.memoryId) ?? 0, Math.min(1, Math.max(0, h.score))));
  }
  const evidencePaths = [
    ...extractMentionedPaths(args.message),
    ...(args.mentionedPaths ?? []),
    ...(args.openPaths ?? []),
  ];

  const out: RecipeMatch[] = [];
  for (const recipe of args.recipes) {
    if (recipe.status !== "verified") continue;
    // MC-53: fail closed. Without a project id only explicitly promoted global recipes can match.
    if (!recipeAppliesInProject(recipe, args.projectId)) continue;

    const sim = familyFingerprintSimilarity(fp, args.message, recipe);
    // Fusion / overlap are supporting evidence only: no lexical intent overlap, no match.
    if (sim === 0) continue;
    const fus = recipe.memoryId != null ? (fusion.get(recipe.memoryId) ?? 0) : 0;
    const overlap = fileOverlapScore(recipeStepPaths(recipe), evidencePaths);
    let base: number;
    let reason: MatchReason;
    if (sim === 1) {
      base = 1;
      reason = "fingerprint_exact";
    } else {
      base = FINGERPRINT_WEIGHT * sim + FUSION_WEIGHT * fus + OVERLAP_WEIGHT * overlap;
      reason = fus > 0 ? "fingerprint_similar_fusion" : "fingerprint_similar";
    }
    const track = trackRecordFactor(recipe.stats);
    const boosted = recipe.pinned ? Math.min(1, base * track * RECIPE_PIN_BOOST) : base * track;
    const score = Math.round(boosted * 1000) / 1000;
    if (score < MIN_MATCH_SCORE) continue;

    const why = describeWhy(recipe, fp, sim, fus, overlap, reason);
    out.push({
      recipe,
      score,
      reason,
      why: recipe.stats.reverted + recipe.stats.failedVerify > 0 ? `${why}; has ${recipe.stats.reverted} reverts, ${recipe.stats.failedVerify} failed verifies` : why,
      fingerprintSimilarity: sim,
      fusionScore: fus,
      fileOverlap: overlap,
      replayable: score >= REPLAY_THRESHOLD,
    });
  }
  const byFamily = new Map<string, RecipeMatch[]>();
  for (const m of out) {
    const key = m.recipe.familyId || m.recipe.id;
    const list = byFamily.get(key);
    if (list) list.push(m);
    else byFamily.set(key, [m]);
  }
  const collapsed: RecipeMatch[] = [];
  for (const group of byFamily.values()) {
    const best = pickBestVariant(
      group.map((g) => g.recipe),
      args.openPaths ?? [],
    );
    const top = group.find((g) => g.recipe.id === best.id) ?? group[0];
    const score = Math.max(...group.map((g) => g.score));
    collapsed.push({ ...top, recipe: best, score, replayable: score >= REPLAY_THRESHOLD });
  }
  collapsed.sort(
    (a, b) =>
      b.score - a.score ||
      Number(Boolean(b.recipe.pinned)) - Number(Boolean(a.recipe.pinned)) ||
      b.recipe.stats.ok - a.recipe.stats.ok ||
      (b.recipe.lastReplayedAt ?? b.recipe.updatedAt).localeCompare(a.recipe.lastReplayedAt ?? a.recipe.updatedAt) ||
      a.recipe.id.localeCompare(b.recipe.id),
  );
  return collapsed.slice(0, args.limit ?? 5);
}

export function bestMatch(args: MatchArgs): RecipeMatch | undefined {
  return matchRecipes({ ...args, limit: 1 })[0];
}

/**
 * MEM-34: retrieve Ω(q) via the recipe channel, then score. Callers that
 * still have a tiny in-memory list (tests) use `matchRecipes` directly.
 */
export async function matchRecipesFromChannel(
  search: RecipeChannelSearch,
  args: Omit<MatchArgs, "recipes"> & { status?: RecipeStatus | RecipeStatus[] },
): Promise<RecipeMatch[]> {
  const memoryIds = [...new Set((args.fusionHits ?? []).map((h) => h.memoryId))];
  const recipes = await search.searchVisibleTo(args.projectId ?? "", {
    query: args.message,
    status: args.status ?? "verified",
    memoryIds,
    mentionedPaths: [...(args.mentionedPaths ?? []), ...(args.openPaths ?? [])],
    limit: RECIPE_CHANNEL_CANDIDATE_CAP,
  });
  return matchRecipes({ ...args, recipes });
}
