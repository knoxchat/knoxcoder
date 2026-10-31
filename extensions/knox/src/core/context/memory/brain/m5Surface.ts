/**
 * MEM-37 — one M₅ surface.
 *
 * Product M₅ is live recipes (and their linked workflow, once). Leftover
 * `brain_procedures` / BasalGanglia learning patterns yield when a live
 * recipe already owns the same intent fingerprint. They stay the inject
 * and C_addr surface only when no recipe covers them (recipes stay off
 * by default).
 */

import { intentFingerprint } from "../recipes/intentFingerprint.js";
import { BrainStore } from "./BrainStore.js";

/** Candidate / verified / quarantined — retired recipes are not M₅. */
export const LIVE_RECIPE_SQL = "status IN ('candidate', 'verified', 'quarantined')";

export interface LiveRecipeCoverage {
  fingerprints: Set<string>;
  memoryIds: Set<number>;
}

export function leftoverIntentFingerprint(
  ...parts: Array<string | null | undefined>
): string {
  return intentFingerprint(parts.filter((part) => String(part ?? "").trim()).join(" "));
}

/** Distinct fingerprints of leftover name / trigger / description text. */
export function leftoverFingerprints(
  parts: Array<string | null | undefined>,
): string[] {
  const texts = parts.map((part) => String(part ?? "").trim()).filter(Boolean);
  const out = new Set<string>();
  const joined = leftoverIntentFingerprint(...texts);
  if (joined) out.add(joined);
  for (const text of texts) {
    const fp = intentFingerprint(text);
    if (fp) out.add(fp);
  }
  return [...out];
}

/** Exact fingerprint match — EN/ZH paraphrases already collapse in `intentFingerprint`. */
export function leftoverCoveredByFingerprints(
  leftoverFps: Iterable<string>,
  recipeFingerprints: Iterable<string>,
): boolean {
  const recipes =
    recipeFingerprints instanceof Set
      ? recipeFingerprints
      : new Set([...recipeFingerprints].filter(Boolean));
  if (recipes.size === 0) return false;
  for (const fp of leftoverFps) {
    if (fp && recipes.has(fp)) return true;
  }
  return false;
}

export function leftoverTextCovered(
  text: string,
  recipeFingerprints: Iterable<string>,
): boolean {
  return leftoverCoveredByFingerprints(leftoverFingerprints([text]), recipeFingerprints);
}

export async function loadLiveRecipeCoverage(): Promise<LiveRecipeCoverage> {
  const empty: LiveRecipeCoverage = { fingerprints: new Set(), memoryIds: new Set() };
  try {
    const db = await BrainStore.get();
    const rows = (await db.all(
      `
      SELECT title, intent_text, intent_fingerprint, memory_id
      FROM brain_recipes
      WHERE ${LIVE_RECIPE_SQL}
      `,
    )) as {
      title?: string | null;
      intent_text?: string | null;
      intent_fingerprint?: string | null;
      memory_id?: number | null;
    }[];
    const fingerprints = new Set<string>();
    const memoryIds = new Set<number>();
    for (const row of rows) {
      const stored = String(row.intent_fingerprint ?? "").trim();
      if (stored) fingerprints.add(stored);
      const derived = leftoverIntentFingerprint(row.title, row.intent_text);
      if (derived) fingerprints.add(derived);
      const id = Math.trunc(Number(row.memory_id));
      if (id > 0) memoryIds.add(id);
    }
    return { fingerprints, memoryIds };
  } catch {
    return empty;
  }
}
