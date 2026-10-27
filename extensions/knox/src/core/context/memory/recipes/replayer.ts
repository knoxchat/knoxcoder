/**
 * RecipeReplayer (MC-30, MC-31, MC-33, MC-36).
 *
 * Applies a verified recipe from checkpoint blobs with zero LLM calls.
 * The replayer is pure orchestration: every side effect goes through
 * `ReplayPorts`, which the host binds to the normal tool path
 * (`callTool` -> middleware -> staged edits) so permissions, review mode,
 * path boundary and checkpoints still apply. It never touches `fs` itself.
 *
 * Order of operations (README safety rules):
 *   1. refuse unless verified; refuse unsafe paths and unsafe commands
 *   2. detect drift per file; any drift => `drifted` (caller picks adapt/suggest)
 *   3. pre-replay checkpoint
 *   4. apply steps in order
 *   5. run the recipe's oracle; on any failure restore the pre-replay
 *      checkpoint, count `failedVerify`, and hand the failure back so the
 *      caller can continue with the normal LLM loop.
 */

import { detectDangerousCommand } from "../../../tools/commandGuard.js";
import { isSafeRelPath } from "./preconditions.js";
import type { Recipe, RecipeStep } from "./types.js";

export interface ReplayPorts {
  /** Bytes of a checkpoint blob, or undefined when evicted/corrupt. */
  readBlob(hash: string): Promise<string | Uint8Array | undefined>;
  /** sha256 of the file now on disk, or undefined when it does not exist. */
  currentHash(relPath: string): Promise<string | undefined>;
  /** Pre-replay checkpoint; returns its id. */
  createCheckpoint(label: string): Promise<string>;
  restoreCheckpoint(id: string): Promise<void>;
  /** Writes go through the normal tool path. `ok:false` includes review-mode rejection. */
  writeFile(relPath: string, content: string | Uint8Array): Promise<{ ok: boolean; error?: string }>;
  deleteFile(relPath: string): Promise<{ ok: boolean; error?: string }>;
  runCommand(command: string): Promise<{ ok: boolean; output?: string }>;
  /** Re-run the recipe's oracle (postEditVerification / verifyCommand). */
  verify(recipe: Recipe): Promise<{ ok: boolean; detail?: string }>;
}

export type ReplayStatus = "applied" | "refused" | "drifted" | "failed_verify" | "failed_apply";

export interface ReplayResult {
  status: ReplayStatus;
  recipeId: string;
  /** Pre-replay checkpoint (one-click undo). Set once a checkpoint was taken. */
  checkpointId?: string;
  /** True when the pre-replay checkpoint was restored. */
  restored: boolean;
  /** Human-readable cause; for failures this is fed to the LLM as context. */
  reason?: string;
  appliedPaths: string[];
  driftedPaths: string[];
  /** Fingerprint of the recipe for the caller to count as `ok` / `failedVerify`. */
  outcome?: "ok" | "failedVerify";
}

// ── Command steps (MC-33) ──────────────────────────────────────────────────

const NETWORK_RE =
  /\b(curl|wget|fetch|scp|sftp|ssh|rsync|nc|ncat|telnet|ftp|git\s+(?:push|pull|fetch|clone|remote)|npm\s+(?:publish|login|adduser)|gh\b|aws\b|gcloud\b|az\b|kubectl\b|docker\s+(?:push|pull|login))\b|https?:\/\//i;
const SECRET_RE =
  /(?:^|[\s=])(?:[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*)=|\$\{?[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE_?KEY)[A-Z0-9_]*\}?|--(?:token|password|api-?key|secret)\b|\b(?:sk|ghp|gho|xox[bap])-?[A-Za-z0-9_]{16,}/i;

/** Null when the recorded command may be replayed, else the reason it may not. */
export function replayableCommandProblem(command: string): string | null {
  const dangerous = detectDangerousCommand(command);
  if (dangerous) return `command blocked by guard: ${dangerous}`;
  if (SECRET_RE.test(command)) return "command carries a secret";
  if (NETWORK_RE.test(command)) return "command uses the network";
  return null;
}

// ── Pre-flight ─────────────────────────────────────────────────────────────

export interface ReplayPlan {
  ok: boolean;
  reason?: string;
}

/** Static checks that need no I/O. */
export function planReplay(recipe: Recipe): ReplayPlan {
  if (recipe.status !== "verified") return { ok: false, reason: `recipe is ${recipe.status}, not verified` };
  if (!recipe.oracle) return { ok: false, reason: "recipe has no oracle to verify the replay" };
  if (recipe.steps.length === 0) return { ok: false, reason: "recipe has no steps" };
  // MC-82: the oracle command runs after the files land, so it gets the same network/secret gate.
  if (recipe.oracle.command) {
    const problem = replayableCommandProblem(recipe.oracle.command);
    if (problem) return { ok: false, reason: `oracle ${problem}` };
  }
  for (const step of recipe.steps) {
    if (step.kind === "command") {
      const problem = replayableCommandProblem(step.command ?? "");
      if (problem) return { ok: false, reason: problem };
    } else if (!step.path || !isSafeRelPath(step.path)) {
      return { ok: false, reason: `unsafe path in recipe: ${step.path ?? "(none)"}` };
    }
  }
  return { ok: true };
}

// ── Drift (MC-36) ──────────────────────────────────────────────────────────

export type DriftKind = "clean" | "already_applied" | "drifted";

/**
 * 3-way compare by hash: `base` is what the file was when captured, `result`
 * what the recipe wrote. Matching base = safe to overwrite; matching result =
 * nothing to do; anything else = the user changed it since, so exact replay
 * would clobber their work.
 */
export function classifyDrift(step: RecipeStep, current: string | undefined): DriftKind {
  if (step.kind === "delete_file") {
    if (current === undefined) return "already_applied";
    return !step.baseBlobHash || current === step.baseBlobHash ? "clean" : "drifted";
  }
  if (step.blobHash && current === step.blobHash) return "already_applied";
  if (current === undefined) return step.baseBlobHash ? "drifted" : "clean"; // created fresh vs. deleted since
  if (!step.baseBlobHash) return "drifted"; // recipe created it, but a file is there now
  return current === step.baseBlobHash ? "clean" : "drifted";
}

export async function detectDrift(
  recipe: Recipe,
  currentHash: ReplayPorts["currentHash"],
): Promise<{ drifted: string[]; skip: Set<number> }> {
  const drifted: string[] = [];
  const skip = new Set<number>();
  for (const [i, step] of recipe.steps.entries()) {
    if (step.kind === "command" || !step.path) continue;
    const kind = classifyDrift(step, await currentHash(step.path));
    if (kind === "drifted") drifted.push(step.path);
    else if (kind === "already_applied") skip.add(i);
  }
  return { drifted, skip };
}

// ── Exact replay ───────────────────────────────────────────────────────────

export interface ExactOptions {
  /** Label for the pre-replay checkpoint. */
  label?: string;
  /** Clean 3-way merge results from `previewReplay` (MC-36). Written instead of the blob; these paths are not drift. */
  merged?: ReadonlyMap<string, string>;
  /** One-off partial apply: only these recipe paths (P4.7). Commands still run. */
  includePaths?: readonly string[];
  /** Approved extra adapt files (P4.3). Written through the same tool path after recipe steps. */
  extraWrites?: ReadonlyMap<string, string>;
}

function fail(
  recipe: Recipe,
  status: ReplayStatus,
  reason: string,
  extra: Partial<ReplayResult> = {},
): ReplayResult {
  return { status, recipeId: recipe.id, restored: false, appliedPaths: [], driftedPaths: [], reason, ...extra };
}

export async function replayExact(recipe: Recipe, ports: ReplayPorts, opts: ExactOptions = {}): Promise<ReplayResult> {
  const plan = planReplay(recipe);
  if (!plan.ok) return fail(recipe, "refused", plan.reason!);

  // Blobs first: a missing blob means we cannot reproduce the bytes at all.
  const contents = new Map<number, string | Uint8Array>();
  for (const [i, step] of recipe.steps.entries()) {
    if (step.kind !== "write_file") continue;
    const bytes = await ports.readBlob(step.blobHash!);
    if (bytes === undefined) return fail(recipe, "refused", `blob for ${step.path} is no longer available`);
    contents.set(i, bytes);
  }

  const include = opts.includePaths ? new Set(opts.includePaths) : undefined;
  const extraWrites = opts.extraWrites;
  const fileSteps = recipe.steps.filter((s) => s.kind === "write_file" || s.kind === "delete_file");
  const selectedFiles = include ? fileSteps.filter((s) => s.path && include.has(s.path)) : fileSteps;
  if (fileSteps.length > 0 && selectedFiles.length === 0 && !extraWrites?.size) {
    return fail(recipe, "refused", "no files selected");
  }

  const detected = await detectDrift(recipe, ports.currentHash);
  const { skip } = detected;
  const drifted = detected.drifted.filter((p) => !opts.merged?.has(p) && (!include || include.has(p)));
  if (drifted.length > 0) {
    return fail(recipe, "drifted", `files changed since capture: ${drifted.join(", ")}`, { driftedPaths: drifted });
  }

  const checkpointId = await ports.createCheckpoint(opts.label ?? `pre-replay: ${recipe.title || recipe.id.slice(0, 8)}`);
  const applied: string[] = [];

  const rollback = async (status: ReplayStatus, reason: string): Promise<ReplayResult> => {
    let restored = false;
    let note = reason;
    try {
      await ports.restoreCheckpoint(checkpointId);
      restored = true;
    } catch (err) {
      note = `${reason}; restore of checkpoint ${checkpointId} FAILED: ${err instanceof Error ? err.message : String(err)}`;
    }
    return fail(recipe, status, note, {
      checkpointId,
      restored,
      appliedPaths: restored ? [] : applied,
      outcome: status === "failed_verify" ? "failedVerify" : undefined,
    });
  };

  for (const [i, step] of recipe.steps.entries()) {
    // Already on disk, unless adapted content still has to land on top of it.
    if (skip.has(i) && !(step.path && opts.merged?.has(step.path))) continue;
    if (step.kind === "command") {
      const res = await ports.runCommand(step.command!);
      if (!res.ok) return rollback("failed_apply", `command failed: ${step.command}`);
      continue;
    }
    if (include && step.path && !include.has(step.path)) continue;
    const res =
      step.kind === "delete_file"
        ? await ports.deleteFile(step.path!)
        : await ports.writeFile(step.path!, opts.merged?.get(step.path!) ?? contents.get(i)!);
    if (!res.ok) return rollback("failed_apply", `could not apply ${step.path}: ${res.error ?? "rejected"}`);
    applied.push(step.path!);
  }

  if (extraWrites) {
    for (const [path, text] of extraWrites) {
      if (!isSafeRelPath(path)) return rollback("failed_apply", `unsafe extra path: ${path}`);
      const res = await ports.writeFile(path, text);
      if (!res.ok) return rollback("failed_apply", `could not apply extra file ${path}: ${res.error ?? "rejected"}`);
      applied.push(path);
    }
  }

  const verdict = await ports.verify(recipe);
  if (!verdict.ok) {
    return rollback("failed_verify", `replay failed verification${verdict.detail ? `: ${verdict.detail}` : ""}`);
  }
  return {
    status: "applied",
    recipeId: recipe.id,
    checkpointId,
    restored: false,
    appliedPaths: applied,
    driftedPaths: [],
    outcome: "ok",
  };
}

/**
 * Text handed to the LLM loop when a replay did not land, so the model starts
 * from what went wrong instead of repeating it.
 */
export interface ReplayFailureExtras {
  preview?: string;
  unfilledSlots?: string[];
  failedSlots?: string[];
  preconditionFailures?: string[];
}

export function replayFailureContext(result: ReplayResult, extras: ReplayFailureExtras = {}): string {
  if (result.status === "applied") return "";
  const lines = [`A saved recipe was tried first and did not apply (${result.status}).`];
  if (result.reason) lines.push(`Reason: ${result.reason}`);
  if (result.driftedPaths.length) lines.push(`Changed since capture: ${result.driftedPaths.join(", ")}`);
  if (extras.unfilledSlots?.length) lines.push(`Unfilled slots: ${extras.unfilledSlots.join(", ")}`);
  if (extras.failedSlots?.length) lines.push(`Slot substitution refused: ${extras.failedSlots.join(", ")}`);
  if (extras.preconditionFailures?.length) {
    lines.push(`Preconditions failed: ${extras.preconditionFailures.join("; ")}`);
  }
  lines.push(result.restored ? "Files were restored to their state before the attempt." : "No files were changed.");
  if (extras.preview) {
    const preview = extras.preview.length > 4000 ? `${extras.preview.slice(0, 4000)}\n… (truncated)` : extras.preview;
    lines.push("", "Preview of what was attempted:", preview);
  }
  lines.push("Do not retry the same writes. Continue from the current files.");
  return lines.join("\n");
}
