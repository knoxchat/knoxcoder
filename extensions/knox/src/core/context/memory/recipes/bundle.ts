/**
 * Recipes inside checkpoint bundles (MC-63).
 *
 * Export writes a trimmed description of verified recipes; import treats every entry as hostile
 * input (README: "Imported recipe poisoning") and rebuilds a `candidate` that has to be verified
 * again locally. Nothing arrives as `verified`, with an oracle, with stats, or with a command step.
 * Pure: the host supplies the bundle's blob hashes and the receiving project id.
 */

import { containsSecret } from "../../../util/redactSecrets.js";
import type { NewRecipeInput, Recipe, RecipePrecondition, RecipeSlot, RecipeStep } from "./types.js";

export const MAX_BUNDLE_RECIPES = 200;
export const MAX_BUNDLE_STEPS = 50;
const SHA256 = /^[0-9a-f]{64}$/;
const SLOT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const SLOT_KINDS = new Set(["identifier", "path", "package", "text"]);
const MAX_TEXT = 500;

/** What travels. No status, stats, oracle, project id, session id, memory id or checkpoint ids. */
export interface BundleRecipe {
  title: string;
  intentText: string;
  intentFingerprint: string;
  slots: RecipeSlot[];
  preconditions: RecipePrecondition[];
  steps: { kind: "write_file" | "delete_file"; path: string; blobHash?: string; baseBlobHash?: string }[];
}

/** Blob hashes an exported recipe needs the bundle to carry. */
export function bundleRecipeBlobHashes(recipe: BundleRecipe): string[] {
  return recipe.steps.flatMap((s) => [s.blobHash, s.baseBlobHash].filter((h): h is string => !!h));
}

/** Only verified recipes without command steps are shareable; returns undefined otherwise. */
export function toBundleRecipe(recipe: Recipe): BundleRecipe | undefined {
  if (recipe.status !== "verified") return undefined;
  if (recipe.steps.some((s) => s.kind === "command")) return undefined;
  return {
    title: recipe.title,
    intentText: recipe.intentText,
    intentFingerprint: recipe.intentFingerprint,
    slots: recipe.slots.map((s) => ({ name: s.name, kind: s.kind })),
    preconditions: recipe.preconditions.map((p) => ({ kind: p.kind, value: p.value })),
    steps: recipe.steps.map((s) => ({
      kind: s.kind as "write_file" | "delete_file",
      path: s.path ?? "",
      ...(s.blobHash ? { blobHash: s.blobHash } : {}),
      ...(s.baseBlobHash ? { baseBlobHash: s.baseBlobHash } : {}),
    })),
  };
}

export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 400 || p.includes("\0") || p.includes("\\")) return false;
  if (p.startsWith("/") || p.startsWith("~") || /^[A-Za-z]:/.test(p)) return false;
  return !p.split("/").some((seg) => seg === ".." || seg === "");
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): string | undefined =>
  typeof v === "string" && v.length <= max ? v : undefined;

export interface RejectedRecipe {
  index: number;
  reason: string;
}

export interface ParsedBundleRecipes {
  inputs: NewRecipeInput[];
  rejected: RejectedRecipe[];
}

function parseOne(raw: unknown, blobs: ReadonlySet<string>, projectId: string): NewRecipeInput | string {
  if (!isObject(raw)) return "not an object";
  const title = text(raw.title) ?? "";
  const intentText = text(raw.intentText, 2000);
  const intentFingerprint = text(raw.intentFingerprint);
  if (intentText === undefined || !intentFingerprint?.trim()) return "missing intent";

  const slots: RecipeSlot[] = [];
  for (const s of Array.isArray(raw.slots) ? raw.slots : []) {
    if (!isObject(s) || typeof s.name !== "string" || !SLOT_NAME.test(s.name) || typeof s.kind !== "string" || !SLOT_KINDS.has(s.kind)) {
      return "invalid slot";
    }
    slots.push({ name: s.name, kind: s.kind as RecipeSlot["kind"] });
  }

  const preconditions: RecipePrecondition[] = [];
  for (const p of Array.isArray(raw.preconditions) ? raw.preconditions : []) {
    const kind = isObject(p) ? text(p.kind, 60) : undefined;
    const value = isObject(p) ? text(p.value) : undefined;
    if (!kind || value === undefined) return "invalid precondition";
    preconditions.push({ kind, value });
  }

  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > MAX_BUNDLE_STEPS) return "bad step count";
  const steps: RecipeStep[] = [];
  for (const s of raw.steps) {
    if (!isObject(s)) return "invalid step";
    // Commands are never imported: they would execute on the receiver's machine.
    if (s.kind !== "write_file" && s.kind !== "delete_file") return `step kind "${String(s.kind)}" is not importable`;
    if (typeof s.path !== "string" || !isSafeRelativePath(s.path)) return "unsafe step path";
    const step: RecipeStep = { kind: s.kind, path: s.path };
    if (s.kind === "write_file") {
      if (typeof s.blobHash !== "string" || !SHA256.test(s.blobHash)) return "invalid blob hash";
      if (!blobs.has(s.blobHash)) return "step blob is not in the bundle";
      step.blobHash = s.blobHash;
    }
    // Drift baseline is optional; keep it only when the bundle can actually serve it.
    if (typeof s.baseBlobHash === "string" && SHA256.test(s.baseBlobHash) && blobs.has(s.baseBlobHash)) {
      step.baseBlobHash = s.baseBlobHash;
    }
    steps.push(step);
  }

  const all = [title, intentText, intentFingerprint, ...preconditions.map((p) => p.value), ...steps.map((s) => s.path ?? "")];
  if (all.some((t) => containsSecret(t))) return "contains a secret";

  return { projectId, scope: "project", title, intentText, intentFingerprint, slots, preconditions, steps };
}

/**
 * Validates untrusted bundle entries. Valid ones become `NewRecipeInput`s for the receiving project;
 * `RecipeStore.create` always stores them as `candidate`.
 */
export function parseBundleRecipes(raw: unknown, blobHashes: ReadonlySet<string>, projectId: string): ParsedBundleRecipes {
  const out: ParsedBundleRecipes = { inputs: [], rejected: [] };
  if (raw === undefined) return out;
  if (!Array.isArray(raw)) return { inputs: [], rejected: [{ index: -1, reason: "recipes is not a list" }] };
  raw.slice(0, MAX_BUNDLE_RECIPES).forEach((entry, index) => {
    const r = parseOne(entry, blobHashes, projectId);
    if (typeof r === "string") out.rejected.push({ index, reason: r });
    else out.inputs.push(r);
  });
  if (raw.length > MAX_BUNDLE_RECIPES) out.rejected.push({ index: MAX_BUNDLE_RECIPES, reason: `more than ${MAX_BUNDLE_RECIPES} recipes; the rest were ignored` });
  return out;
}
