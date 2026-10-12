/** Recipe model (MC-11). See `README.md` for the rules this must keep. */

export type RecipeStatus = "candidate" | "verified" | "quarantined" | "retired";
export type RecipeScope = "project" | "global";
export type RecipeOracleKind = "build" | "test" | "lsp" | "user";
export type RecipeStepKind = "write_file" | "delete_file" | "command";

export interface RecipeSlot {
  name: string;
  kind: "identifier" | "path" | "package" | "text";
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
  /** sha256 of the canonical form (see `canonicalRecipeId`). */
  id: string;
  projectId: string;
  scope: RecipeScope;
  status: RecipeStatus;
  title: string;
  intentText: string;
  intentFingerprint: string;
  slots: RecipeSlot[];
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
  slots?: RecipeSlot[];
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
  limit?: number;
}
