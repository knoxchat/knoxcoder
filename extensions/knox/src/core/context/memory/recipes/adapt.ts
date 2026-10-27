/**
 * RecipeReplayer.adapt() (MC-32): reuse a verified recipe for a task that is close but not identical.
 *
 * One model call. The model sees the recipe's saved files and the new request and answers with a
 * small patch (apply_patch format) against the saved files, not with whole files. The patch is
 * validated, applied in memory, merged with any local edits, and handed to `replayExact` as
 * `merged` content, so pre-replay checkpoint, tool path, oracle re-run and rollback all still apply.
 *
 * Strict by design: a patch that renames or deletes a file, does not match its context, or
 * conflicts with local edits is refused, and the caller falls back to the normal model loop.
 * Paths the recipe did not write are held as `extraFiles` and are never written unless the
 * caller passes them in `approvedExtraPaths`.
 */

import { applyHunksToContent, parseApplyPatch } from "../../../tools/applyPatchFormat.js";
import { isSensitiveSecretFile, redactSecrets } from "../../../util/redactSecrets.js";
import { lineDelta, merge3, unifiedDiff } from "./merge3.js";
import { isSafeRelPath } from "./preconditions.js";
import { previewReplay, type PreviewPorts, type ReplayPreview } from "./replayPreview.js";
import { planReplay, replayExact, type ExactOptions, type ReplayPorts, type ReplayResult } from "./replayer.js";
import type { Recipe } from "./types.js";

/** Total saved text sent to the model; larger recipes are not adapted (the model should generate). */
export const ADAPT_MAX_PROMPT_CHARS = 24_000;

export interface AdaptPorts extends PreviewPorts {
  /** One model call: prompt in, text out. */
  complete(prompt: string): Promise<string>;
}

export interface AdaptExtraFile {
  path: string;
  action: "create" | "modify";
  content: string;
}

export type AdaptPlan =
  | {
      ok: true;
      /** Final content per touched path (patch applied, merged with local edits). */
      merged: Map<string, string>;
      touched: string[];
      /** Paths the recipe did not write. Not applied unless `approvedExtraPaths` includes them. */
      extraFiles: AdaptExtraFile[];
      prompt: string;
      response: string;
    }
  | { ok: false; reason: string; outsidePaths?: string[]; prompt?: string; response?: string };

const decoder = new TextDecoder("utf-8", { fatal: false });

function asText(bytes: string | Uint8Array): string | undefined {
  const text = typeof bytes === "string" ? bytes : decoder.decode(bytes);
  return text.includes("\0") || text.includes("\uFFFD") ? undefined : text;
}

export function buildAdaptPrompt(request: string, recipe: Recipe, files: readonly { path: string; text: string }[]): string {
  const lines = [
    "You are adapting a verified piece of work to a new request.",
    `New request: ${JSON.stringify(redactSecrets(request))}`,
    `The saved version (title ${JSON.stringify(redactSecrets(recipe.title || recipe.intentText))}) wrote the files below.`,
    "Answer with ONLY a patch in this format, changing as little as possible, and nothing else:",
    "*** Begin Patch",
    "*** Update File: <one of the paths below>",
    "@@",
    " <unchanged context line>",
    "-<old line>",
    "+<new line>",
    "*** End Patch",
    "Rules: only update the files listed; no new files, renames or deletes; context lines must match the saved file exactly.",
    "If the saved version already satisfies the request, answer with exactly: NO_CHANGES",
    "",
  ];
  for (const f of files) lines.push(`### ${f.path}`, "```", redactSecrets(f.text), "```");
  return lines.join("\n");
}

export async function planAdapt(
  recipe: Recipe,
  request: string,
  ports: AdaptPorts,
): Promise<AdaptPlan> {
  const plan = planReplay(recipe);
  if (!plan.ok) return { ok: false, reason: plan.reason! };

  const saved = new Map<string, string>();
  const baseHash = new Map<string, string | undefined>();
  let size = 0;
  for (const step of recipe.steps) {
    if (step.kind !== "write_file") continue;
    const bytes = await ports.readBlob(step.blobHash!);
    const text = bytes === undefined ? undefined : asText(bytes);
    if (text === undefined) return { ok: false, reason: `saved version of ${step.path} is unavailable or not text` };
    size += text.length;
    saved.set(step.path!, text);
    baseHash.set(step.path!, step.baseBlobHash);
  }
  if (saved.size === 0) return { ok: false, reason: "recipe writes no files to adapt" };
  if (size > ADAPT_MAX_PROMPT_CHARS) return { ok: false, reason: "recipe is too large to adapt; the model should generate" };

  const prompt = buildAdaptPrompt(request, recipe, [...saved].map(([path, text]) => ({ path, text })));
  const response = (await ports.complete(prompt)).trim();
  if (response === "NO_CHANGES") return { ok: true, merged: new Map(), touched: [], extraFiles: [], prompt, response };

  let ops;
  try {
    ops = parseApplyPatch(response);
  } catch (err) {
    return { ok: false, reason: `model did not return a valid patch: ${(err as Error).message}`, prompt, response };
  }

  const extraFiles: AdaptExtraFile[] = [];
  const adapted = new Map<string, string>();
  for (const op of ops) {
    if (op.type === "delete") return { ok: false, reason: `patch deletes ${op.path}; deletes are not adapted`, prompt, response };
    if (op.type === "update" && op.moveTo) return { ok: false, reason: `patch renames ${op.path}; renames are not adapted`, prompt, response };
    if (!isSafeRelPath(op.path)) return { ok: false, reason: `unsafe path in patch: ${op.path}`, prompt, response };
    if (isSensitiveSecretFile(op.path)) return { ok: false, reason: `patch touches a secret file: ${op.path}`, prompt, response };
    if (!saved.has(op.path)) {
      try {
        if (op.type === "add") {
          extraFiles.push({ path: op.path, action: "create", content: op.content });
        } else {
          const current = (await ports.readCurrent(op.path)) ?? "";
          extraFiles.push({
            path: op.path,
            action: current ? "modify" : "create",
            content: applyHunksToContent(current, op.hunks, op.path),
          });
        }
      } catch (err) {
        return { ok: false, reason: (err as Error).message, prompt, response };
      }
      continue;
    }
    try {
      adapted.set(
        op.path,
        op.type === "add" ? op.content : applyHunksToContent(adapted.get(op.path) ?? saved.get(op.path)!, op.hunks, op.path),
      );
    } catch (err) {
      return { ok: false, reason: (err as Error).message, prompt, response };
    }
  }

  // Apply the model's change on top of what is on disk now, never over it.
  const merged = new Map<string, string>();
  for (const [path, next] of adapted) {
    const original = saved.get(path)!;
    if (next === original) continue;
    const hash = await ports.currentHash(path);
    const current = hash === undefined ? undefined : await ports.readCurrent(path);
    if (current === undefined || hash === baseHash.get(path)) {
      merged.set(path, next);
      continue;
    }
    const m = merge3(original, current, next);
    if (!m.ok) return { ok: false, reason: `${path}: ${m.reason}`, prompt, response };
    merged.set(path, m.text);
  }
  return { ok: true, merged, touched: [...merged.keys()], extraFiles, prompt, response };
}

export type AdaptReplayResult = ReplayResult & { adapt?: Extract<AdaptPlan, { ok: true }> };

/** Apply an already-validated plan (e.g. one the user approved in a preview). */
export function replayAdaptPlan(
  recipe: Recipe,
  plan: Extract<AdaptPlan, { ok: true }>,
  ports: ReplayPorts,
  opts: ExactOptions & { approvedExtraPaths?: readonly string[] } = {},
): Promise<ReplayResult> {
  const merged = new Map([...(opts.merged ?? []), ...plan.merged]);
  const approved = new Set(opts.approvedExtraPaths ?? []);
  const extraWrites = new Map<string, string>();
  for (const extra of plan.extraFiles) {
    if (approved.has(extra.path)) extraWrites.set(extra.path, extra.content);
  }
  return replayExact(recipe, ports, {
    label: `pre-adapt: ${recipe.title || recipe.id.slice(0, 8)}`,
    ...opts,
    merged,
    extraWrites: extraWrites.size ? extraWrites : undefined,
  });
}

/** Plan, then apply. Never throws for a refused plan: returns `refused` so the caller can fall back. */
export async function replayAdapt(
  recipe: Recipe,
  request: string,
  ports: ReplayPorts & AdaptPorts,
  opts: ExactOptions = {},
): Promise<AdaptReplayResult> {
  const plan = await planAdapt(recipe, request, ports);
  if (!plan.ok) {
    return { status: "refused", recipeId: recipe.id, restored: false, appliedPaths: [], driftedPaths: [], reason: plan.reason };
  }
  const result = await replayAdaptPlan(recipe, plan, ports, opts);
  return { ...result, adapt: plan };
}

/**
 * Preview of an adapted replay: the recipe's own preview, with the touched files replaced by the
 * diff of what would really be written (current -> adapted). Shown before anything is applied.
 */
export async function previewAdaptPlan(
  recipe: Recipe,
  plan: Extract<AdaptPlan, { ok: true }>,
  ports: PreviewPorts,
): Promise<ReplayPreview> {
  const preview = await previewReplay(recipe, ports);
  if (!preview.allowed) return preview;
  for (const path of plan.touched) {
    const next = plan.merged.get(path)!;
    const hash = await ports.currentHash(path);
    const current = hash === undefined ? undefined : await ports.readCurrent(path);
    const entry = {
      path,
      action: current === undefined ? ("create" as const) : ("modify" as const),
      ...lineDelta(current ?? "", next),
      diff: unifiedDiff(path, current, next),
    };
    const i = preview.entries.findIndex((e) => e.path === path);
    if (i >= 0) preview.entries[i] = entry;
    else preview.entries.push(entry);
    preview.conflicts = preview.conflicts.filter((c) => c !== path);
    preview.merged.delete(path);
  }
  for (const extra of plan.extraFiles) {
    const hash = await ports.currentHash(extra.path);
    const current = hash === undefined ? undefined : await ports.readCurrent(extra.path);
    preview.entries.push({
      path: extra.path,
      action: extra.action,
      ...lineDelta(current ?? "", extra.content),
      diff: unifiedDiff(extra.path, current, extra.content),
      needsApproval: true,
    });
  }
  preview.totals = { files: 0, added: 0, removed: 0 };
  for (const e of preview.entries) {
    if (e.action === "unchanged" || e.action === "conflict" || e.action === "missing_blob") continue;
    preview.totals.files++;
    preview.totals.added += e.added;
    preview.totals.removed += e.removed;
  }
  return preview;
}
