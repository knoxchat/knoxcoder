/**
 * Recipe hint (suggest/adapt/exact-not-yet-replayable): a worked example injected into the
 * prompt so the model reuses verified work instead of re-deriving it. Pure; the host supplies
 * blob bytes. Text only, secrets redacted, size capped. Never contains file bytes of binary blobs.
 */

import { redactSecrets } from "../../../util/redactSecrets.js";
import type { Recipe } from "./types.js";

export const HINT_MAX_CHARS = 6000;
export const HINT_FILE_MAX_CHARS = 2000;

const decoder = new TextDecoder("utf-8", { fatal: false });

function toText(bytes: string | Uint8Array): string | undefined {
  const text = typeof bytes === "string" ? bytes : decoder.decode(bytes);
  return text.includes("\0") ? undefined : text;
}

export async function buildRecipeHint(
  recipe: Recipe,
  readBlob: (hash: string) => Promise<string | Uint8Array | undefined>,
  maxChars = HINT_MAX_CHARS,
): Promise<string> {
  const head = [
    `<verified_recipe title=${JSON.stringify(redactSecrets(recipe.title || recipe.intentText || recipe.id.slice(0, 8)))}>`,
    `A similar task was done before and verified (${recipe.oracle?.kind ?? "oracle"} passed; used ${recipe.stats.ok}x, ${recipe.stats.reverted} reverts).`,
    "Reuse its approach where it fits this task; adjust names and paths, and do not copy blindly.",
  ];
  if (recipe.slots.length) head.push(`Values that usually vary: ${recipe.slots.map((s) => s.name).join(", ")}.`);
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
        const clipped = clean.length > HINT_FILE_MAX_CHARS ? `${clean.slice(0, HINT_FILE_MAX_CHARS)}\n… (truncated)` : clean;
        block = `File: ${step.path}\n\`\`\`\n${clipped}\n\`\`\``;
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
