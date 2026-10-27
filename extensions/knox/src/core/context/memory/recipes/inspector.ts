/**
 * Recipes inspector (P5): user-editable title, notes, pin, slots, and
 * file/dependency preconditions. Redacted and fail-closed — the same safety
 * gates as capture. Matcher pin boost lives here so the number is one place.
 */

import { redactSecrets } from "../../../util/redactSecrets.js";
import { isSafeRelPath } from "./preconditions.js";
import { isSafeSlotValue } from "./slots.js";
import type { RecipePrecondition, RecipeSlot } from "./types.js";

/** Modest score lift for a user-pinned recipe. Jaccard 0 still cannot match. */
export const RECIPE_PIN_BOOST = 1.08;

export const RECIPE_TITLE_MAX = 120;
export const RECIPE_NOTES_MAX = 2000;

const SLOT_KINDS = ["identifier", "path", "package", "text"] as const;
/** Power users may add/remove these; language/framework stay capture-derived. */
export const USER_PRECONDITION_KINDS = ["file_exists", "file_absent", "dependency"] as const;

export function isUserPreconditionKind(kind: string): boolean {
  return (USER_PRECONDITION_KINDS as readonly string[]).includes(kind);
}

export function sanitizeRecipeTitle(title: string): string {
  const text = redactSecrets(title).trim().slice(0, RECIPE_TITLE_MAX);
  if (!text) throw new Error("Recipe title cannot be empty");
  return text;
}

export function sanitizeRecipeNotes(notes: string): string {
  return redactSecrets(notes).slice(0, RECIPE_NOTES_MAX);
}

export function sanitizeUserSlots(slots: readonly RecipeSlot[]): RecipeSlot[] {
  const seen = new Set<string>();
  const out: RecipeSlot[] = [];
  for (const slot of slots) {
    const name = slot.name.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name)) {
      throw new Error(`Invalid slot name: ${name || "(empty)"}`);
    }
    if (seen.has(name)) throw new Error(`Duplicate slot: ${name}`);
    seen.add(name);
    if (!(SLOT_KINDS as readonly string[]).includes(slot.kind)) {
      throw new Error(`Invalid slot kind: ${slot.kind}`);
    }
    const examples = [...new Set((slot.examples ?? []).map((v) => redactSecrets(v)).filter(isSafeSlotValue))].slice(0, 8);
    out.push({ name, kind: slot.kind, ...(examples.length ? { examples } : {}) });
  }
  return out;
}

export function sanitizeUserPreconditions(pres: readonly RecipePrecondition[]): RecipePrecondition[] {
  const out: RecipePrecondition[] = [];
  const seen = new Set<string>();
  for (const pre of pres) {
    if (!isUserPreconditionKind(pre.kind)) {
      throw new Error("Only file_exists, file_absent, and dependency checks can be edited");
    }
    const value = redactSecrets(pre.value).trim();
    if (pre.kind === "dependency") {
      if (!isSafeSlotValue(value)) throw new Error(`Invalid dependency: ${value || "(empty)"}`);
    } else if (!isSafeRelPath(value)) {
      throw new Error(`Unsafe path: ${value || "(empty)"}`);
    }
    const key = `${pre.kind}\0${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: pre.kind, value });
  }
  return out;
}

export function mergeUserPreconditions(
  current: readonly RecipePrecondition[],
  user: readonly RecipePrecondition[],
): RecipePrecondition[] {
  const derived = current.filter((p) => !isUserPreconditionKind(p.kind));
  return [...derived, ...sanitizeUserPreconditions(user)];
}
