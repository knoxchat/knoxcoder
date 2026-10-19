/**
 * Replay preview and drift resolution (MC-35, MC-36). Read-only: nothing here writes.
 *
 * Shows exactly what a replay would change before it is applied, and decides what to do about
 * files the user edited since capture: a clean 3-way merge (base blob + current + recipe result)
 * becomes `merged` content; any conflict means the caller must pick adapt or suggest.
 */

import { lineDelta, merge3, unifiedDiff } from "./merge3.js";
import { classifyDrift, planReplay, type ReplayPorts } from "./replayer.js";
import type { Recipe } from "./types.js";

export interface PreviewPorts extends Pick<ReplayPorts, "readBlob" | "currentHash"> {
  /** Text of the file now on disk, or undefined when it does not exist. */
  readCurrent(relPath: string): Promise<string | undefined>;
}

export type PreviewAction = "create" | "modify" | "delete" | "unchanged" | "merge" | "conflict" | "missing_blob";

export interface PreviewEntry {
  path: string;
  action: PreviewAction;
  added: number;
  removed: number;
  /** Unified diff of what would change on disk (empty for unchanged/conflict/missing). */
  diff: string;
  /** Why this entry is a conflict or missing. */
  reason?: string;
}

export interface ReplayPreview {
  recipeId: string;
  /** False when the static plan already refuses the recipe (see `refusal`). */
  allowed: boolean;
  refusal?: string;
  entries: PreviewEntry[];
  commands: string[];
  /** Paths whose current content could not be reconciled with the recipe. */
  conflicts: string[];
  /** Any file differs from the capture-time base (merged or conflicting). Feeds `DecisionInput.drifted`. */
  drifted: boolean;
  /** Clean merge results keyed by path; pass to `replayExact({ merged })`. */
  merged: Map<string, string>;
  totals: { files: number; added: number; removed: number };
}

const decoder = new TextDecoder("utf-8", { fatal: false });
const asText = (b: string | Uint8Array): string => (typeof b === "string" ? b : decoder.decode(b));

export async function previewReplay(recipe: Recipe, ports: PreviewPorts): Promise<ReplayPreview> {
  const out: ReplayPreview = {
    recipeId: recipe.id,
    allowed: true,
    entries: [],
    commands: [],
    conflicts: [],
    drifted: false,
    merged: new Map(),
    totals: { files: 0, added: 0, removed: 0 },
  };
  const plan = planReplay(recipe);
  if (!plan.ok) return { ...out, allowed: false, refusal: plan.reason };

  for (const step of recipe.steps) {
    if (step.kind === "command") {
      out.commands.push(step.command ?? "");
      continue;
    }
    const path = step.path!;
    const hash = await ports.currentHash(path);
    const current = hash === undefined ? undefined : await ports.readCurrent(path);
    const drift = classifyDrift(step, hash);

    if (step.kind === "delete_file") {
      if (drift === "already_applied") out.entries.push({ path, action: "unchanged", added: 0, removed: 0, diff: "" });
      else if (drift === "drifted") {
        out.drifted = true;
        out.conflicts.push(path);
        out.entries.push({ path, action: "conflict", added: 0, removed: 0, diff: "", reason: "file changed since capture" });
      } else {
        const d = lineDelta(current ?? "", "");
        out.entries.push({ path, action: "delete", ...d, diff: unifiedDiff(path, current, undefined) });
      }
      continue;
    }

    const blob = await ports.readBlob(step.blobHash!);
    if (blob === undefined) {
      out.conflicts.push(path);
      out.entries.push({ path, action: "missing_blob", added: 0, removed: 0, diff: "", reason: "saved bytes are no longer available" });
      continue;
    }
    const result = asText(blob);

    if (drift === "already_applied") {
      out.entries.push({ path, action: "unchanged", added: 0, removed: 0, diff: "" });
    } else if (drift === "clean") {
      out.entries.push({
        path,
        action: current === undefined ? "create" : "modify",
        ...lineDelta(current ?? "", result),
        diff: unifiedDiff(path, current, result),
      });
    } else {
      out.drifted = true;
      const baseBlob = step.baseBlobHash ? await ports.readBlob(step.baseBlobHash) : undefined;
      if (baseBlob === undefined || current === undefined) {
        out.conflicts.push(path);
        out.entries.push({ path, action: "conflict", added: 0, removed: 0, diff: "", reason: "cannot merge: no base version or file missing" });
        continue;
      }
      const m = merge3(asText(baseBlob), current, result);
      if (!m.ok) {
        out.conflicts.push(path);
        out.entries.push({ path, action: "conflict", added: 0, removed: 0, diff: "", reason: m.reason });
      } else {
        out.merged.set(path, m.text);
        out.entries.push({ path, action: "merge", ...lineDelta(current, m.text), diff: unifiedDiff(path, current, m.text) });
      }
    }
  }

  for (const e of out.entries) {
    if (e.action === "unchanged" || e.action === "conflict" || e.action === "missing_blob") continue;
    out.totals.files++;
    out.totals.added += e.added;
    out.totals.removed += e.removed;
  }
  return out;
}

/**
 * MC-90: listing the preview is cheap; Apply is the real tool+oracle path.
 * Same wording regardless of locale; the GUI wraps it in localized chrome.
 */
export const REPLAY_APPLY_LATENCY_NOTE =
  "This listing is instant; Apply runs the real tool path and the recorded check, which can take seconds.";

/**
 * Text for the `ask` preview card and chat: one summary line per file, then the diffs.
 * Same wording regardless of locale; the GUI wraps it in localized chrome.
 */
export function formatReplayPreview(preview: ReplayPreview, maxDiffChars = 8000): string {
  if (!preview.allowed) return `Replay refused: ${preview.refusal}`;
  const lines = [
    REPLAY_APPLY_LATENCY_NOTE,
    `${preview.totals.files} file(s), +${preview.totals.added} -${preview.totals.removed}`,
  ];
  for (const e of preview.entries) {
    lines.push(`${e.action.padEnd(9)} ${e.path}${e.reason ? ` (${e.reason})` : ""}`);
  }
  for (const c of preview.commands) lines.push(`command   ${c}`);
  let diffs = preview.entries.map((e) => e.diff).filter(Boolean).join("\n\n");
  if (diffs.length > maxDiffChars) diffs = `${diffs.slice(0, maxDiffChars)}\n… (truncated)`;
  return diffs ? `${lines.join("\n")}\n\n${diffs}` : lines.join("\n");
}

/** What the caller should do given a preview (MC-36): conflicts force adapt; merged-only is still adapt-level risk. */
export function driftAction(preview: ReplayPreview): "exact" | "merge" | "adapt" {
  if (preview.conflicts.length > 0) return "adapt";
  if (preview.merged.size > 0) return "merge";
  return "exact";
}
