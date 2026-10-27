/**
 * Recipe <-> memory link (MC-17).
 *
 * A verified recipe gets a `workflow` semantic memory so normal recall can
 * find it by intent. The memory carries a `recipe_id: <sha256>` marker line
 * (semantic rows have no metadata column), and `brain_recipes.memory_id`
 * points back. The memory holds a description only: paths and counts, never
 * file bytes. Only verified recipes are linked (README rule 1).
 */

import { redactSecrets } from "../../../util/redactSecrets.js";
import { isCommonNounEntityName } from "../brain/GraphRetrieval.js";
import type { AddEntityInput, StoreInput } from "../brain/types.js";
import type { RecipeStore } from "./RecipeStore.js";
import type { Recipe } from "./types.js";

const MARKER = /^recipe_id: ([0-9a-f]{64})$/m;
const MAX_LISTED_PATHS = 12;

/** Recipe id carried by a memory's content, if any. */
export function parseRecipeId(content: string | undefined | null): string | undefined {
  return content ? MARKER.exec(content)?.[1] : undefined;
}

/**
 * RelevanceGate `verified` flag for a semantic row: a linked recipe is proven
 * work unless outcomes recorded a revert. Non-recipe memories keep outcome-only
 * verified-ness.
 */
export function recipeMemoryIsVerified(
  content: string | undefined | null,
  outcome?: { verified: number; reverted: number },
): boolean | undefined {
  if (outcome && outcome.reverted > 0) return false;
  if (parseRecipeId(content)) return true;
  if (outcome && outcome.verified > 0) return true;
  return undefined;
}

/** Build the memory describing a recipe. Pure. */
export function buildRecipeMemory(recipe: Recipe): StoreInput {
  const files = recipe.steps.filter((s) => s.kind !== "command" && s.path).map((s) => `${s.kind === "delete_file" ? "-" : "+"} ${s.path}`);
  const commands = recipe.steps.filter((s) => s.kind === "command" && s.command).map((s) => `$ ${s.command}`);
  const listed = files.slice(0, MAX_LISTED_PATHS);
  const lines = [
    `Verified recipe: ${recipe.intentText || recipe.title}`,
    ...listed,
    ...(files.length > listed.length ? [`... and ${files.length - listed.length} more files`] : []),
    ...commands,
    recipe.oracle ? `Verified by: ${recipe.oracle.kind}${recipe.oracle.command ? ` (${recipe.oracle.command})` : ""}` : "",
    recipe.slots.length ? `Varies by: ${recipe.slots.map((s) => s.name).join(", ")}` : "",
    `recipe_id: ${recipe.id}`,
  ].filter(Boolean);

  return {
    category: "workflow",
    title: redactSecrets(`Recipe: ${recipe.title || recipe.intentFingerprint}`).slice(0, 120),
    content: redactSecrets(lines.join("\n")),
    importance: 0.7,
    ...(recipe.sourceSessionId ? { session_id: recipe.sourceSessionId } : {}),
  };
}

/**
 * Store the recipe's memory once and record its id on the recipe. No-op for
 * recipes that are not verified or already linked. `storeMemory` is the brain's
 * normal `store` (sanitizing, deduping); a deduped id is accepted as the link.
 */
export async function linkRecipeMemory(
  store: RecipeStore,
  recipe: Recipe,
  storeMemory: (input: StoreInput) => Promise<number>,
  /**
   * MC-85: after a Memory DB rollback the linked memory row can be gone. When this says so the
   * recipe is relinked (ids are AUTOINCREMENT, so the stale id never points at a different memory).
   */
  memoryExists?: (memoryId: number) => Promise<boolean>,
): Promise<Recipe> {
  if (recipe.status !== "verified") return recipe;
  if (recipe.memoryId != null && (!memoryExists || (await memoryExists(recipe.memoryId)))) return recipe;
  const memoryId = await storeMemory(buildRecipeMemory(recipe));
  const linked = await store.setMemoryId(recipe.id, memoryId);
  await associateRecipeGraph(linked).catch(() => undefined);
  return linked;
}

function basenameStem(rel: string): string {
  const base = rel.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.replace(/\.[^.]+$/, "");
}

/** File / symbol / package entities a recipe memory should own. Pure. */
export function recipeGraphEntities(recipe: Recipe): AddEntityInput[] {
  const out: AddEntityInput[] = [];
  const seen = new Set<string>();
  const add = (input: AddEntityInput) => {
    const name = input.name.trim();
    if (name.length < 3 || isCommonNounEntityName(name)) return;
    const key = `${input.entity_type}:${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...input, name });
  };
  for (const step of recipe.steps) {
    if (!step.path || step.kind === "command") continue;
    add({
      name: step.path.replace(/\\/g, "/"),
      entity_type: "file",
      description: "File touched by a verified recipe",
      confidence: 0.8,
    });
    const stem = basenameStem(step.path);
    if (/^[A-Z][A-Za-z0-9]+$/.test(stem) && stem.length >= 3) {
      add({
        name: stem,
        entity_type: "class",
        description: "Symbol from a verified recipe path",
        confidence: 0.65,
      });
    }
  }
  for (const pre of recipe.preconditions) {
    if (pre.kind === "framework" || pre.kind === "dependency" || pre.kind === "language") {
      add({
        name: pre.value.trim(),
        entity_type: "technology",
        description: `Recipe ${pre.kind}`,
        confidence: 0.75,
      });
    }
  }
  for (const slot of recipe.slots) {
    if (slot.kind !== "package") continue;
    for (const v of slot.examples ?? []) {
      add({ name: v, entity_type: "technology", description: "Recipe package slot", confidence: 0.6 });
    }
  }
  return out;
}

/** Best-effort graph write; never throws into capture. */
export async function associateRecipeGraph(recipe: Recipe): Promise<number> {
  const entities = recipeGraphEntities(recipe);
  if (entities.length === 0) return 0;
  const { KnowledgeGraph } = await import("../brain/KnowledgeGraph.js");
  const ids: number[] = [];
  for (const input of entities) {
    ids.push(await KnowledgeGraph.addEntity(input));
  }
  for (let i = 0; i < ids.length - 1; i++) {
    await KnowledgeGraph.addEdge({
      source_entity_id: ids[i],
      target_entity_id: ids[i + 1],
      relationship: "recipe_co_touched",
      weight: 0.4,
    });
  }
  return ids.length;
}
