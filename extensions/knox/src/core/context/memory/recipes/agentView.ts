/**
 * Agent-facing recipe summaries (P6.1 / P6.2). Text only, secrets redacted,
 * no file bytes. Apply still goes through the host replayer — this file never writes.
 */

import { redactSecrets } from "../../../util/redactSecrets.js";
import type { Recipe, RecipeStatus } from "./types.js";

export interface RecipeAgentRow {
  id: string;
  title: string;
  status: RecipeStatus;
  scope: string;
  uses: number;
  reverts: number;
  files: number;
  slots: string[];
  paths: string[];
  oracle?: string;
  pinned?: boolean;
}

export function toRecipeAgentRow(recipe: Recipe): RecipeAgentRow {
  return {
    id: recipe.id,
    title: redactSecrets(recipe.title || recipe.intentText || recipe.id.slice(0, 8)),
    status: recipe.status,
    scope: recipe.scope,
    uses: recipe.stats.ok,
    reverts: recipe.stats.reverted,
    files: recipe.steps.filter((s) => s.kind !== "command").length,
    slots: recipe.slots.map((s) => s.name),
    paths: recipe.steps.filter((s) => s.path).map((s) => s.path as string).slice(0, 8),
    oracle: recipe.oracle?.kind
      ? `${recipe.oracle.kind}${recipe.oracle.command ? ` \`${redactSecrets(recipe.oracle.command)}\`` : ""}`
      : undefined,
    pinned: recipe.pinned === true,
  };
}

export function formatRecipeAgentList(rows: readonly RecipeAgentRow[], extra?: { why?: string }): string {
  if (!rows.length) {
    return extra?.why
      ? `No matching recipes. ${redactSecrets(extra.why)}`
      : "No recipes in this project. Capture verified work with knoxchat.recipes.enabled, or attach one with @recipe.";
  }
  const lines = [
    `${rows.length} recipe(s). Apply goes through the verified replayer (confirm=true); do not rewrite these files yourself.`,
  ];
  for (const row of rows) {
    const bits = [
      `${row.status} ${row.scope}`,
      `${row.files} file(s)`,
      `used ${row.uses}x`,
      `${row.reverts} revert(s)`,
    ];
    if (row.pinned) bits.push("pinned");
    if (row.slots.length) bits.push(`slots ${row.slots.join(",")}`);
    if (row.oracle) bits.push(`oracle ${row.oracle}`);
    lines.push(`- ${row.title} id=${row.id} (${bits.join("; ")})`);
    if (row.paths.length) lines.push(`  files: ${row.paths.join(", ")}`);
  }
  return lines.join("\n");
}

export function formatRecipeAgentMeta(recipe: Recipe, extra?: { why?: string; preview?: string }): string {
  const row = toRecipeAgentRow(recipe);
  const lines = [
    `<recipe id=${JSON.stringify(row.id)} title=${JSON.stringify(row.title)} status=${row.status}>`,
    extra?.why ? redactSecrets(extra.why) : "",
    `Intent: ${redactSecrets(recipe.intentText || recipe.title || "")}`.trim(),
    recipe.slots.length
      ? `Slots: ${recipe.slots.map((s) => `${s.name} (${s.kind}${s.examples?.[0] ? ` e.g. ${s.examples[0]}` : ""})`).join(", ")}`
      : "",
    recipe.preconditions.length
      ? `Preconditions: ${recipe.preconditions.map((p) => `${p.kind}=${redactSecrets(p.value)}`).join("; ")}`
      : "",
    `Oracle: ${row.oracle ?? "none"}`,
    `Stats: used ${row.uses}x, ${row.reverts} reverts, ${recipe.stats.failedVerify} failed verify`,
  ];
  for (const step of recipe.steps.slice(0, 16)) {
    if (step.kind === "command") lines.push(`Step: run ${redactSecrets(step.command ?? "")}`);
    else if (step.kind === "delete_file") lines.push(`Step: delete ${step.path}`);
    else lines.push(`Step: write ${step.path}`);
  }
  if (recipe.steps.length > 16) lines.push("… (more steps omitted)");
  if (extra?.preview) lines.push("", extra.preview);
  lines.push("Do not copy file bodies blindly. Apply with builtin_recipe action=apply confirm=true so the replayer, permissions, and ask card run.");
  lines.push("</recipe>");
  return lines.filter((l) => l.length > 0).join("\n");
}

/** Filter a list by a lexical query (title, intent, paths, slots). */
export function filterRecipesByQuery(recipes: readonly Recipe[], query: string, limit = 8): Recipe[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...recipes].slice(0, limit);
  const scored = recipes
    .map((r) => {
      const hay = [r.title, r.intentText, r.intentFingerprint, ...r.slots.map((s) => s.name), ...r.steps.map((s) => s.path ?? s.command ?? "")]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q) && !q.split(/\s+/).every((w) => hay.includes(w))) return undefined;
      const titleHit = r.title.toLowerCase().includes(q) ? 2 : 0;
      return { r, score: titleHit + (hay.includes(q) ? 1 : 0) };
    })
    .filter((x): x is { r: Recipe; score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score || b.r.stats.ok - a.r.stats.ok);
  return scored.map((s) => s.r).slice(0, limit);
}
