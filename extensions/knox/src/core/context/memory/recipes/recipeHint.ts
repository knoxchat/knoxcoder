/**
 * Recipe hint (suggest/adapt/exact-not-yet-replayable): a worked example injected into the
 * prompt so the model reuses verified work instead of re-deriving it. Pure; the host supplies
 * blob bytes. Text only, secrets redacted, size capped. Never contains file bytes of binary blobs.
 */

import { redactSecrets } from "../../../util/redactSecrets.js";
import { memoryCiteToken } from "../brain/attribution.js";
import { unifiedDiff } from "./merge3.js";
import type { Recipe } from "./types.js";

export const HINT_MAX_CHARS = 6000;
/** P6.3: cap file bodies harder; prefer diffs against current files. */
export const HINT_FILE_MAX_CHARS = 800;
export const HINT_DIFF_MAX_CHARS = 600;
export const RECIPE_STUB_MARKER = "verified_recipe_stub";

export interface RecipeHintExtra {
  why?: string;
  readCurrent?: (path: string) => Promise<string | undefined>;
}

/** Title + paths + slots, no file bodies. Survives turnBudget when the full hint is dropped. */
export function buildRecipeStub(recipe: Recipe, extra?: { why?: string }): string {
  const paths = recipe.steps.filter((s) => s.path).map((s) => s.path as string).slice(0, 8);
  const more = recipe.steps.filter((s) => s.path).length - paths.length;
  const slots = recipe.slots.map((s) => s.name);
  const pres = recipe.preconditions.slice(0, 6).map((p) => `${p.kind}=${redactSecrets(p.value)}`);
  const title = redactSecrets(recipe.title || recipe.intentText || recipe.id.slice(0, 8));
  const lines = [
    memoryCiteToken("recipe", recipe.id),
    `<${RECIPE_STUB_MARKER} title=${JSON.stringify(title)} id=${JSON.stringify(recipe.id)}>`,
    extra?.why ? redactSecrets(extra.why) : "",
    `recipe_id: ${recipe.id}`,
    paths.length ? `Files: ${paths.join(", ")}${more > 0 ? ` (+${more})` : ""}` : "",
    slots.length ? `Slots: ${slots.join(", ")}` : "",
    pres.length ? `Preconditions: ${pres.join("; ")}` : "",
    `</${RECIPE_STUB_MARKER}>`,
  ].filter((l) => l.length > 0);
  return lines.join("\n");
}

const decoder = new TextDecoder("utf-8", { fatal: false });

function toText(bytes: string | Uint8Array): string | undefined {
  const text = typeof bytes === "string" ? bytes : decoder.decode(bytes);
  return text.includes("\0") ? undefined : text;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}

export async function buildRecipeHint(
  recipe: Recipe,
  readBlob: (hash: string) => Promise<string | Uint8Array | undefined>,
  maxChars = HINT_MAX_CHARS,
  extra?: RecipeHintExtra,
): Promise<string> {
  const title = redactSecrets(recipe.title || recipe.intentText || recipe.id.slice(0, 8));
  const head = [
    memoryCiteToken("recipe", recipe.id),
    `<verified_recipe title=${JSON.stringify(title)} id=${JSON.stringify(recipe.id)}>`,
    `recipe_id: ${recipe.id}`,
    extra?.why ? redactSecrets(extra.why) : "",
    `A similar task was done before and verified (${recipe.oracle?.kind ?? "oracle"} passed; used ${recipe.stats.ok}x, ${recipe.stats.reverted} reverts).`,
    "Reuse its approach where it fits this task; adjust names and paths, and do not copy blindly.",
  ].filter((l) => l.length > 0);
  if (recipe.slots.length) {
    head.push(
      `Values that usually vary: ${recipe.slots
        .map((s) => `${s.name}${s.examples?.[0] ? ` (e.g. ${s.examples[0]})` : ""}`)
        .join(", ")}.`,
    );
  }
  if (recipe.preconditions.length) {
    head.push(
      `Preconditions: ${recipe.preconditions.map((p) => `${p.kind}=${redactSecrets(p.value)}`).join("; ")}.`,
    );
  }
  const parts: string[] = [head.join("\n")];
  let used = parts[0].length + 20;

  for (const step of recipe.steps) {
    let block: string;
    if (step.kind === "command") {
      block = `Command: ${redactSecrets(step.command ?? "")}`;
    } else if (step.kind === "delete_file") {
      block = `Deleted: ${step.path}`;
    } else {
      const bytes = step.blobHash ? await readBlob(step.blobHash).catch(() => undefined) : undefined;
      const text = bytes === undefined ? undefined : toText(bytes);
      if (text === undefined) {
        block = `File: ${step.path} (content unavailable)`;
      } else {
        const clean = redactSecrets(text);
        const current = step.path && extra?.readCurrent ? await extra.readCurrent(step.path).catch(() => undefined) : undefined;
        if (current !== undefined && current !== clean) {
          const diff = redactSecrets(unifiedDiff(step.path ?? "file", current, clean, 40));
          block = `File: ${step.path}\n${clip(diff, HINT_DIFF_MAX_CHARS)}`;
        } else {
          block = `File: ${step.path}\n\`\`\`\n${clip(clean, HINT_FILE_MAX_CHARS)}\n\`\`\``;
        }
      }
    }
    if (used + block.length > maxChars) {
      parts.push("… (more steps omitted)");
      break;
    }
    parts.push(block);
    used += block.length + 1;
  }
  parts.push("</verified_recipe>");
  return parts.join("\n");
}
