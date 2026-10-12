/**
 * MC-42: turn a verified, repeatedly-replayed recipe into a `SKILL.md` proposal.
 * Pure: returns text and a target name. The caller shows it to the user and writes it only on approval.
 * Only metadata and paths are emitted (never file bytes); text is passed through `redactSecrets`.
 */

import { redactSecrets } from "../../../util/redactSecrets";
import type { Recipe } from "./types";

/** Replays (all ok) required before "Promote to skill" is offered. */
export const SKILL_PROMOTION_MIN_OK = 3;

export interface SkillProposal {
  name: string;
  description: string;
  content: string;
}

export function isSkillEligible(recipe: Recipe, minOk = SKILL_PROMOTION_MIN_OK): boolean {
  return (
    recipe.status === "verified" &&
    recipe.stats.ok >= minOk &&
    recipe.stats.reverted === 0 &&
    recipe.stats.failedVerify === 0
  );
}

export function skillNameFor(recipe: Recipe): string {
  const base = recipe.title || recipe.intentFingerprint || "recipe";
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || `recipe-${recipe.id.slice(0, 8)}`;
}

function oneLine(s: string, max: number): string {
  const t = redactSecrets(s).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Returns undefined when the recipe is not eligible. */
export function buildSkillFromRecipe(recipe: Recipe, minOk = SKILL_PROMOTION_MIN_OK): SkillProposal | undefined {
  if (!isSkillEligible(recipe, minOk)) return undefined;
  const name = skillNameFor(recipe);
  const title = oneLine(recipe.title || recipe.intentText || name, 80);
  const description = oneLine(`Repeat the verified workflow: ${recipe.intentText || recipe.title || name}`, 200);

  const lines: string[] = [];
  lines.push("---", `name: ${name}`, `description: ${JSON.stringify(description)}`, "---", "", `# ${title}`, "");
  lines.push(
    `Verified ${recipe.stats.ok} time(s) with no reverts` +
      (recipe.oracle ? ` (oracle: ${recipe.oracle.kind}${recipe.oracle.command ? ` \`${oneLine(recipe.oracle.command, 80)}\`` : ""}).` : "."),
    "",
  );
  if (recipe.slots.length) {
    lines.push("## Inputs", "");
    for (const s of recipe.slots) lines.push(`- \`${s.name}\` (${s.kind})`);
    lines.push("");
  }
  if (recipe.preconditions.length) {
    lines.push("## Preconditions", "");
    for (const p of recipe.preconditions) lines.push(`- ${oneLine(`${p.kind}: ${p.value}`, 120)}`);
    lines.push("");
  }
  lines.push("## Steps", "");
  recipe.steps.forEach((st, i) => {
    if (st.kind === "command") lines.push(`${i + 1}. Run \`${oneLine(st.command ?? "", 120)}\``);
    else if (st.kind === "delete_file") lines.push(`${i + 1}. Delete \`${oneLine(st.path ?? "", 120)}\``);
    else lines.push(`${i + 1}. Create or update \`${oneLine(st.path ?? "", 120)}\``);
  });
  lines.push("", "## Verify", "", recipe.oracle?.command ? `Run \`${oneLine(recipe.oracle.command, 120)}\` and confirm it passes.` : "Confirm the project builds and tests pass.", "");
  return { name, description, content: lines.join("\n") };
}
