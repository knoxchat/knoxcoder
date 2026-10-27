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
