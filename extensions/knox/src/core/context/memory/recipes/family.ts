/**
 * Recipe families (P1): variants of the same procedure that differ by slots
 * (Button vs Card) or by snapshot bytes, not by identity-on-blob-hash.
 *
 * `Recipe.id` stays a content hash of the snapshot. `familyId` is fingerprint +
 * slot schema + path templates, so matching and promotion operate on the family
 * and replay picks a variant.
 */

import { createHash } from "crypto";

import { enforceFamilyVariantCap } from "./budget.js";
import { fingerprintSimilarity, intentFingerprint } from "./intentFingerprint.js";
import type { RecipeStore } from "./RecipeStore.js";
import { extractSlots, isSafeSlotValue, type SlotRun } from "./slots.js";
import type { Recipe, RecipeSlot, RecipeStep } from "./types.js";

/** Jaccard floor for two captures to be considered the same kind of work. */
export const FAMILY_MIN_SIMILARITY = 0.5;

export function templatizePath(path: string, slotValues: Record<string, string>): string {
  let out = path;
  const entries = Object.entries(slotValues)
    .filter(([, v]) => v)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, value] of entries) {
    out = out.split(value).join(`{${name}}`);
  }
  return out;
}

export function familyFingerprint(intentText: string, slotValues: Record<string, string>): string {
  let text = intentText;
  for (const [, value] of Object.entries(slotValues)
    .filter(([, v]) => v)
    .sort((a, b) => b[1].length - a[1].length)) {
    text = text.split(value).join(" $name ");
  }
  return intentFingerprint(text);
}

export function computeFamilyId(input: {
  projectId?: string;
  familyFingerprint: string;
  slots: readonly Pick<RecipeSlot, "name" | "kind">[];
  steps: readonly RecipeStep[];
  slotValues?: Record<string, string>;
}): string {
  const values = input.slotValues ?? {};
  const canonical = {
    p: input.projectId ?? "",
    f: input.familyFingerprint,
    slots: [...input.slots]
      .map((s) => ({ n: s.name, k: s.kind }))
      .sort((a, b) => a.n.localeCompare(b.n)),
    steps: input.steps.map((s) =>
      s.kind === "command"
        ? { k: "command", c: s.command ?? "" }
        : { k: s.kind, p: templatizePath(s.path ?? "", values) },
    ),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function computeFamilyIdFromRecipe(recipe: Pick<Recipe, "projectId" | "intentText" | "intentFingerprint" | "slots" | "slotValues" | "steps">): string {
  const values = recipe.slotValues ?? {};
  const fp =
    Object.keys(values).length > 0
      ? familyFingerprint(recipe.intentText, values)
      : recipe.intentFingerprint;
  return computeFamilyId({
    projectId: recipe.projectId,
    familyFingerprint: fp,
    slots: recipe.slots,
    steps: recipe.steps,
    slotValues: values,
  });
}

/** Same step kinds in order; command text must match; paths may differ by a slot. */
export function stepsShapeCompatible(a: readonly RecipeStep[], b: readonly RecipeStep[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((step, i) => {
    const other = b[i];
    if (step.kind !== other.kind) return false;
    if (step.kind === "command") return (step.command ?? "") === (other.command ?? "");
    return true;
  });
}

export function isFamilyCandidate(a: Recipe, b: Recipe): boolean {
  if (a.projectId !== b.projectId) return false;
  if (a.scope !== b.scope) return false;
  if (!stepsShapeCompatible(a.steps, b.steps)) return false;
  if (a.familyId && b.familyId && a.familyId === b.familyId) return true;
  if (a.intentFingerprint === b.intentFingerprint) return true;
  return fingerprintSimilarity(a.intentFingerprint, b.intentFingerprint) >= FAMILY_MIN_SIMILARITY;
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.slice(0, i);
}

function pathProximity(recipe: Recipe, openPaths: readonly string[]): number {
  const paths = recipe.steps.map((s) => s.path).filter((p): p is string => !!p);
  let n = 0;
  for (const p of paths) {
    if (openPaths.includes(p)) n += 2;
    else if (openPaths.some((o) => (dirOf(p) && o.startsWith(`${dirOf(p)}/`)) || (dirOf(o) && p.startsWith(`${dirOf(o)}/`)))) {
      n += 1;
    }
  }
  return n;
}

function variantScore(r: Recipe): number {
  return r.stats.ok * 2 - r.stats.reverted * 3 - r.stats.failedVerify * 2 + (r.status === "verified" ? 5 : 0);
}

/** Track record, then recency, then current-file proximity. */
export function pickBestVariant(variants: readonly Recipe[], openPaths: readonly string[] = []): Recipe {
  if (variants.length === 0) throw new Error("pickBestVariant needs at least one recipe");
  return [...variants].sort(
    (a, b) =>
      variantScore(b) - variantScore(a) ||
      (b.lastReplayedAt ?? b.updatedAt).localeCompare(a.lastReplayedAt ?? a.updatedAt) ||
      pathProximity(b, openPaths) - pathProximity(a, openPaths) ||
      a.id.localeCompare(b.id),
  )[0];
}

export function safeSlotExamples(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!isSafeSlotValue(v)) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= 8) break;
  }
  return out;
}

async function slotRun(
  recipe: Recipe,
  readBlob?: (hash: string) => Promise<string | Uint8Array | undefined>,
): Promise<SlotRun> {
  const files: SlotRun["files"][number][] = [];
  for (const step of recipe.steps) {
    if (!step.path || step.kind === "command") continue;
    let content: string | undefined;
    if (step.blobHash && readBlob) {
      const bytes = await readBlob(step.blobHash);
      if (typeof bytes === "string") content = bytes;
      else if (bytes) content = new TextDecoder("utf-8").decode(bytes);
    }
    files.push({ path: step.path, content });
  }
  return { intentText: recipe.intentText, files };
}

function slotValuesFromPairs(pairs: { slot: RecipeSlot; values: [string, string] }[], index: 0 | 1): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    if (isSafeSlotValue(p.values[index])) out[p.slot.name] = p.values[index];
  }
  return out;
}

/**
 * When a new capture is a near-miss of an existing recipe, extract slots and
 * put both variants in the same family. Identical snapshots are already
 * deduped by `RecipeStore.create`.
 */
export async function linkRecipeFamily(
  store: RecipeStore,
  recipe: Recipe,
  opts?: { readBlob?: (hash: string) => Promise<string | Uint8Array | undefined> },
): Promise<Recipe> {
  if (recipe.status !== "candidate" && recipe.status !== "verified") return recipe;

  const live = await store.list({
    projectId: recipe.projectId,
    status: ["candidate", "verified"],
    limit: 1000,
  });
  const siblings = live.filter((s) => s.id !== recipe.id && isFamilyCandidate(s, recipe));
  if (siblings.length === 0) {
    const familyId = computeFamilyIdFromRecipe(recipe);
    if (recipe.familyId === familyId) return recipe;
    return store.setFamily(recipe.id, { familyId, slots: recipe.slots, slotValues: recipe.slotValues ?? {} });
  }

  const peer = pickBestVariant(siblings);
  const pairs = extractSlots(await slotRun(peer, opts?.readBlob), await slotRun(recipe, opts?.readBlob));
  const identicalPaths = peer.steps.every((s, i) => (s.path ?? s.command ?? "") === (recipe.steps[i]?.path ?? recipe.steps[i]?.command ?? ""));

  let slots: RecipeSlot[] = recipe.slots.length ? recipe.slots : peer.slots;
  let peerValues = peer.slotValues ?? {};
  let newValues = recipe.slotValues ?? {};

  if (pairs.length > 0) {
    const extracted: RecipeSlot[] = pairs.map((p) => ({
      name: p.slot.name,
      kind: p.slot.kind,
      examples: safeSlotExamples([p.values[0], p.values[1], ...(peer.slots.find((s) => s.name === p.slot.name)?.examples ?? []), ...(recipe.slots.find((s) => s.name === p.slot.name)?.examples ?? [])]),
    }));
    slots = extracted;
    peerValues = { ...peerValues, ...slotValuesFromPairs(pairs, 0) };
    newValues = { ...newValues, ...slotValuesFromPairs(pairs, 1) };
  } else if (!identicalPaths && slots.length === 0) {
    const familyId = computeFamilyIdFromRecipe(recipe);
    if (recipe.familyId === familyId) return recipe;
    return store.setFamily(recipe.id, { familyId, slots: recipe.slots, slotValues: recipe.slotValues ?? {} });
  } else {
    const examplesByName = new Map<string, string[]>();
    for (const s of [...peer.slots, ...recipe.slots]) {
      examplesByName.set(s.name, safeSlotExamples([...(examplesByName.get(s.name) ?? []), ...(s.examples ?? [])]));
    }
    slots = slots.map((s) => ({ ...s, examples: examplesByName.get(s.name) ?? s.examples }));
  }

  const familyId = computeFamilyId({
    projectId: recipe.projectId,
    familyFingerprint: familyFingerprint(recipe.intentText, newValues) || familyFingerprint(peer.intentText, peerValues) || recipe.intentFingerprint,
    slots,
    steps: recipe.steps,
    slotValues: newValues,
  });

  const members = [peer, recipe, ...siblings.filter((s) => s.id !== peer.id && (s.familyId === peer.familyId || s.familyId === recipe.familyId || !s.familyId))];
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    const values = member.id === recipe.id ? newValues : member.id === peer.id ? peerValues : member.slotValues ?? {};
    const memberSlots = slots.map((s) => ({
      ...s,
      examples: safeSlotExamples([...(s.examples ?? []), values[s.name]].filter((v): v is string => !!v)),
    }));
    await store.setFamily(member.id, { familyId, slots: memberSlots, slotValues: values });
  }
  await enforceFamilyVariantCap(store, familyId);
  return (await store.get(recipe.id)) ?? recipe;
}
