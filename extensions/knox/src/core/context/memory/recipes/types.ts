/** Recipe model (MC-11). See `README.md` for the rules this must keep. */

export type RecipeStatus = "candidate" | "verified" | "quarantined" | "retired";
export type RecipeScope = "project" | "global";
export type RecipeOracleKind = "build" | "test" | "lsp" | "user";
export type RecipeStepKind = "write_file" | "delete_file" | "command";

export interface RecipeSlot {
  name: string;
  kind: "identifier" | "path" | "package" | "text";
  /** Example values seen across variants (redacted, `isSafeSlotValue`-gated). */
  examples?: string[];
}

export interface RecipePrecondition {
  kind: string;
  value: string;
}

/** Bytes are never stored: file steps point at a checkpoint blob by sha256. */
export interface RecipeStep {
  kind: RecipeStepKind;
  path?: string;
  blobHash?: string;
  /** Blob the file had before the recipe ran (for drift detection). */
  baseBlobHash?: string;
  checkpointId?: string;
  command?: string;
}

export interface RecipeOracle {
  kind: RecipeOracleKind;
  passedAt: string;
  command?: string;
}

export interface RecipeStats {
  replays: number;
  ok: number;
  reverted: number;
  failedVerify: number;
}

export interface Recipe {
  /** sha256 of the canonical form (see `canonicalRecipeId`). Snapshot identity (includes blob hashes). */
  id: string;
  /**
   * Family identity: project + slotted fingerprint + slot schema + path templates.
   * Does not include blob hashes. Empty on rows captured before families existed.
   */
  familyId?: string;
  projectId: string;
  scope: RecipeScope;
  status: RecipeStatus;
  title: string;
  intentText: string;
  intentFingerprint: string;
  slots: RecipeSlot[];
  /** This variant's captured slot values (`Button`, `src/a.ts`). */
  slotValues?: Record<string, string>;
  preconditions: RecipePrecondition[];
  steps: RecipeStep[];
  /** Distinct checkpoint ids referenced by steps (derived). */
  sourceCheckpointIds: string[];
  oracle?: RecipeOracle;
  stats: RecipeStats;
  /** Times this exact work was captured after a passing oracle (>= 1). Promotion evidence (MC-15). */
  captureCount: number;
  /** When the user accepted the diff this recipe came from. Promotion evidence (MC-15). */
  userAcceptedAt?: string;
  sourceSessionId?: string;
  memoryId?: number;
  /** User pin: matcher ranks this family first among similar hits. */
  pinned?: boolean;
  /** Free-text note (redacted). */
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastReplayedAt?: string;
  /**
   * MEM-39 hint-attribution leaf h. Added to replay `stats.ok` for Value.
   * Omitted / 0 means no hint outcomes yet.
   */
  helpfulCount?: number;
  /**
   * MEM-39 hint-attribution leaf u. Added to
   * `stats.reverted + stats.failedVerify` for Value.
   */
  unhelpfulCount?: number;
  /** Power-law S (days). Missing → workflow S₀ = 30. */
  stability?: number;
  /** Prior I₀. Missing → 0.5. */
  i0?: number;
}

export interface NewRecipeInput {
  projectId?: string;
  scope?: RecipeScope;
  title?: string;
  intentText?: string;
  intentFingerprint: string;
  familyId?: string;
  slots?: RecipeSlot[];
  slotValues?: Record<string, string>;
  preconditions?: RecipePrecondition[];
  steps: RecipeStep[];
  oracle?: RecipeOracle;
  sourceSessionId?: string;
  memoryId?: number;
}

export interface RecipeListFilter {
  projectId?: string;
  status?: RecipeStatus | RecipeStatus[];
  intentFingerprint?: string;
  familyId?: string;
  limit?: number;
}

/**
 * MEM-34: recipe recall over Ω(q). Not an inventory page — the channel cap
 * is 50 (same as fusion candidates), never RecipeStore.list's 1000.
 */
export const RECIPE_CHANNEL_CANDIDATE_CAP = 50;

export interface RecipeSearchFilter {
  projectId?: string;
  status?: RecipeStatus | RecipeStatus[];
  query?: string;
  /** Union recipes whose linked workflow memory was a fusion hit. */
  memoryIds?: readonly number[];
  /** Extra FTS terms (open / @-mentioned paths). */
  mentionedPaths?: readonly string[];
  /** Channel cap; default `RECIPE_CHANNEL_CANDIDATE_CAP`. */
  limit?: number;
}
