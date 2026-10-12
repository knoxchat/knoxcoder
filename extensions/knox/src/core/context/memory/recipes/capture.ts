/**
 * Recipe capture (MC-14): after a turn whose tools mutated files and whose
 * oracle passed, build a `candidate` recipe from the turn's checkpoint diff.
 *
 * This file is editor-free. The host supplies the evidence (soul events) and
 * the file changes (hashes from two checkpoints); nothing here reads files.
 * Capture is silent: it never changes what the agent does (milestone M1).
 */

import { intentFingerprint } from "./intentFingerprint.js";
import { shouldVerifyTool } from "../../../tools/postEditVerification.js";
import { isSensitiveSecretFile, redactSecrets } from "../../../util/redactSecrets.js";
import type { SoulOracle } from "../../soul/oracleVerdict.js";
import type { StoreInput } from "../brain/types.js";
import { linkRecipeMemory } from "./memoryLink.js";
import { promoteIfEligible } from "./promotion.js";
import type { RecipeStore } from "./RecipeStore.js";
import type { NewRecipeInput, Recipe, RecipeStep } from "./types.js";

/** Soul-history size at which older events have been dropped (see recordSoulEvent). */
export const SOUL_HISTORY_CAP = 20;
/** Bigger turns are not "a recipe", they are a project. */
export const MAX_RECIPE_FILES = 50;

export interface TurnSoulEvent {
  episodicId: number;
  kind: string;
  toolName?: string;
  files: string[];
  workspaceCheckpointId?: string;
  oracle?: SoulOracle;
}

export type CaptureSkipReason =
  | "no_session"
  | "no_turn_mark"
  | "history_truncated"
  | "no_mutation"
  | "no_oracle"
  | "oracle_failed"
  | "no_checkpoint"
  | "no_changes"
  | "too_many_files"
  | "secret_detected"
  | "no_intent";

export interface TurnEvidence {
  /** Checkpoint taken before the turn's first mutation (the "before" state). */
  baseCheckpointId: string;
  oracle: SoulOracle;
}

/**
 * Decide whether the turn qualifies. `markEpisodicId` is the newest soul event
 * id seen when the turn started; only later events belong to this turn.
 * A turn qualifies only if a mutating tool succeeded and the *last* oracle
 * verdict passed. Missing verdicts are never treated as a pass.
 */
export function selectTurnEvidence(
  events: readonly TurnSoulEvent[],
  markEpisodicId: number,
): TurnEvidence | CaptureSkipReason {
  const turn = events.filter((e) => e.episodicId > markEpisodicId);

  // The soul history keeps the last N events. If it is full and its oldest
  // event is already part of this turn, earlier events were dropped and the
  // "before" checkpoint may be wrong: refuse rather than capture a partial diff.
  if (events.length >= SOUL_HISTORY_CAP && events[0].episodicId > markEpisodicId) {
    return "history_truncated";
  }

  const mutated = turn.some(
    (e) =>
      e.kind === "tool_success" &&
      e.files.length > 0 &&
      !!e.toolName &&
      shouldVerifyTool(e.toolName),
  );
  if (!mutated) return "no_mutation";

  const verdicts = turn.filter((e) => e.oracle);
  const last = verdicts[verdicts.length - 1]?.oracle;
  if (!last) return "no_oracle";
  if (!last.passed) return "oracle_failed";

  const base = turn.find((e) => e.workspaceCheckpointId)?.workspaceCheckpointId;
  if (!base) return "no_checkpoint";

  return { baseCheckpointId: base, oracle: last };
}

/** One file that differs between the "before" and "after" checkpoint. */
export interface TurnFileChange {
  /** Workspace-relative, posix. */
  path: string;
  /** Blob hash after the turn; absent when the file was deleted. */
  hash?: string;
  /** Blob hash before the turn; absent when the file was created. */
  baseHash?: string;
  deleted?: boolean;
  /** Content looked like it holds a secret. Bytes cannot be redacted, so such a turn is skipped. */
  hasSecret?: boolean;
}

/**
 * Provisional until MC-20 (real fingerprinting): lowercase, collapse
 * whitespace, cap length. Only used as a dedupe/lookup key.
 */
export function provisionalIntentFingerprint(message: string): string {
  return intentFingerprint(message);
}

export interface BuildCandidateArgs {
  projectId: string;
  sessionId: string;
  userMessage: string;
  afterCheckpointId: string;
  changes: readonly TurnFileChange[];
  oracle: SoulOracle;
  now?: Date;
}

export function buildCandidateInput(args: BuildCandidateArgs): NewRecipeInput | CaptureSkipReason {
  const intentFingerprint = provisionalIntentFingerprint(args.userMessage);
  if (!intentFingerprint) return "no_intent";
  if (args.changes.length === 0) return "no_changes";
  if (args.changes.length > MAX_RECIPE_FILES) return "too_many_files";
  if (args.changes.some((c) => c.hasSecret || isSensitiveSecretFile(c.path))) {
    return "secret_detected";
  }

  const steps: RecipeStep[] = [...args.changes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((c) =>
      c.deleted
        ? {
            kind: "delete_file" as const,
            path: c.path,
            ...(c.baseHash ? { baseBlobHash: c.baseHash } : {}),
            checkpointId: args.afterCheckpointId,
          }
        : {
            kind: "write_file" as const,
            path: c.path,
            blobHash: c.hash,
            ...(c.baseHash ? { baseBlobHash: c.baseHash } : {}),
            checkpointId: args.afterCheckpointId,
          },
    );

  return {
    projectId: args.projectId,
    title: args.userMessage.trim().replace(/\s+/g, " ").slice(0, 80),
    intentText: args.userMessage.trim().slice(0, 2000),
    intentFingerprint,
    steps,
    oracle: {
      kind: args.oracle.kind,
      passedAt: (args.now ?? new Date()).toISOString(),
      ...(args.oracle.command ? { command: args.oracle.command } : {}),
    },
    sourceSessionId: args.sessionId,
  };
}

export interface CaptureDeps {
  store: RecipeStore;
  /**
   * Take the "after" checkpoint and return the files that differ from
   * `baseCheckpointId`. Return undefined when no checkpoint could be made.
   */
  diffAgainst(baseCheckpointId: string): Promise<{ afterCheckpointId: string; changes: TurnFileChange[] } | undefined>;
  /** Stores a semantic memory (MC-17). When absent, verified recipes are not linked to memory. */
  storeMemory?: (input: StoreInput) => Promise<number>;
}

export type CaptureResult =
  | { captured: true; created: boolean; recipe: Recipe; promoted: boolean }
  | { captured: false; reason: CaptureSkipReason };

export async function captureRecipeFromTurn(
  deps: CaptureDeps,
  input: {
    events: readonly TurnSoulEvent[];
    markEpisodicId: number | undefined;
    sessionId: string;
    projectId: string;
    userMessage: string;
  },
): Promise<CaptureResult> {
  if (!input.sessionId) return { captured: false, reason: "no_session" };
  if (input.markEpisodicId === undefined) return { captured: false, reason: "no_turn_mark" };

  const evidence = selectTurnEvidence(input.events, input.markEpisodicId);
  if (typeof evidence === "string") return { captured: false, reason: evidence };

  const diff = await deps.diffAgainst(evidence.baseCheckpointId);
  if (!diff) return { captured: false, reason: "no_changes" };

  const candidate = buildCandidateInput({
    projectId: input.projectId,
    sessionId: input.sessionId,
    userMessage: input.userMessage,
    afterCheckpointId: diff.afterCheckpointId,
    changes: diff.changes,
    oracle: evidence.oracle,
  });
  if (typeof candidate === "string") return { captured: false, reason: candidate };

  const { recipe: stored, created } = await deps.store.create(candidate);
  // Identical work seen again after a passing oracle is a second success (MC-15).
  if (!created && candidate.oracle && (stored.status === "candidate" || stored.status === "verified")) {
    await deps.store.recordCapture(stored.id, candidate.oracle);
  }
  let { recipe, promoted } = await promoteIfEligible(deps.store, stored.id);
  if (deps.storeMemory && recipe.status === "verified" && recipe.memoryId == null) {
    // Linking is best-effort: a memory failure must not lose the capture.
    recipe = await linkRecipeMemory(deps.store, recipe, deps.storeMemory).catch(() => recipe);
  }
  return { captured: true, created, recipe, promoted };
}
