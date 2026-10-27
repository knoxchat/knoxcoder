/**
 * Recipe capture (MC-14): after a turn whose tools mutated files and whose
 * oracle passed, build a `candidate` recipe from the turn's checkpoint diff.
 *
 * This file is editor-free. The host supplies the evidence (soul events) and
 * the file changes (hashes from two checkpoints); nothing here reads files.
 * Capture is silent: it never changes what the agent does (milestone M1).
 */

import { extractSoulFiles } from "../../soul/extractToolFiles.js";
import { extractMentionedPaths, intentFingerprint } from "./intentFingerprint.js";
import { shouldVerifyTool } from "../../../tools/postEditVerification.js";
import { isSensitiveSecretFile } from "../../../util/redactSecrets.js";
import type { SoulOracle } from "../../soul/oracleVerdict.js";
import { deriveCheckpointLabel } from "../../soul/turnIntent.js";
import type { StoreInput } from "../brain/types.js";
import { computeFamilyIdFromRecipe, linkRecipeFamily } from "./family.js";
import { linkRecipeMemory } from "./memoryLink.js";
import {
  deriveEnvironmentPreconditions,
  derivePreconditions,
  type PreconditionEnv,
} from "./preconditions.js";
import { promoteIfEligible } from "./promotion.js";
import { replayableCommandProblem } from "./replayer.js";
import type { RecipeStore } from "./RecipeStore.js";
import type { NewRecipeInput, Recipe, RecipePrecondition, RecipeStep } from "./types.js";

/** Soul-history size at which older events have been dropped (see recordSoulEvent). */
export const SOUL_HISTORY_CAP = 20;
/** Bigger turns are not "a recipe", they are a project. */
export const MAX_RECIPE_FILES = 50;
/** Per-file text cap at capture (binary / huge files never become a recipe). */
export const MAX_RECIPE_FILE_TEXT_BYTES = 512 * 1024;
/** Whole-recipe text cap (project budget is 256 MB; a single recipe stays small). */
export const MAX_RECIPE_TEXT_BYTES = 2 * 1024 * 1024;

const NOISE_DIR_RE =
  /(^|\/)(node_modules|\.git|dist|build|out|target|coverage|\.knox|\.knox-debug|__pycache__|\.next|\.turbo|vendor)(\/|$)/i;
const NOISE_FILE_RE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|go\.sum|poetry\.lock|composer\.lock|gemfile\.lock)(\/|$)/i;
const NOISE_EXT_RE = /\.(lock|min\.(js|css)|map)$/i;
const GENERATED_RE = /\.(generated|gen)\.[a-z0-9]+$/i;

export interface TurnSoulEvent {
  episodicId: number;
  kind: string;
  toolName?: string;
  files: string[];
  workspaceCheckpointId?: string;
  oracle?: SoulOracle;
  /** Terminal command when this event ran a shell tool. */
  command?: string;
  summary?: string;
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
  | "no_intent"
  | "delete_not_replayable"
  | "user_refused"
  | "too_large";

export interface TurnEvidence {
  /** Checkpoint taken before the turn's first mutation (the "before" state). */
  baseCheckpointId: string;
  oracle: SoulOracle;
}

export interface SelectTurnEvidenceOpts {
  /** Checkpoint taken (or already current) when the turn started. */
  turnStartCheckpointId?: string;
  /** Opt-in: a passing oracle plus safe commands can qualify without file writes. */
  allowCommandRecipes?: boolean;
}

function turnMutatedFiles(turn: readonly TurnSoulEvent[]): boolean {
  return turn.some(
    (e) =>
      e.kind === "tool_success" &&
      e.files.length > 0 &&
      !!e.toolName &&
      shouldVerifyTool(e.toolName),
  );
}

function historyWasTruncated(events: readonly TurnSoulEvent[], markEpisodicId: number): boolean {
  return events.length >= SOUL_HISTORY_CAP && events[0].episodicId > markEpisodicId;
}

/**
 * Decide whether the turn qualifies. `markEpisodicId` is the newest soul event
 * id seen when the turn started; only later events belong to this turn.
 * A turn qualifies only if a mutating tool succeeded and the *last* oracle
 * verdict passed. Missing verdicts are never treated as a pass.
 *
 * When soul history dropped early events, a turn-start checkpoint is enough to
 * diff against — refusing a long successful turn is the opposite of remembering
 * verified work.
 */
export function selectTurnEvidence(
  events: readonly TurnSoulEvent[],
  markEpisodicId: number,
  opts?: SelectTurnEvidenceOpts,
): TurnEvidence | CaptureSkipReason {
  const turn = events.filter((e) => e.episodicId > markEpisodicId);
  const truncated = historyWasTruncated(events, markEpisodicId);

  const mutated = turnMutatedFiles(turn);
  const verdicts = turn.filter((e) => e.oracle);
  const last = verdicts[verdicts.length - 1]?.oracle;
  if (!last) {
    if (!mutated) return "no_mutation";
    return "no_oracle";
  }
  if (!last.passed) return "oracle_failed";
  const commands = extractReplayableCommands(events, markEpisodicId, last.command);
  const oracleRunnable = Boolean(last.command && !replayableCommandProblem(last.command));
  const commandOnly = !mutated && Boolean(opts?.allowCommandRecipes) && (commands.length > 0 || oracleRunnable);
  if (!mutated && !commandOnly) return "no_mutation";

  const fromEvents = turn.find((e) => e.workspaceCheckpointId)?.workspaceCheckpointId;
  const base = opts?.turnStartCheckpointId || fromEvents;
  if (truncated && !opts?.turnStartCheckpointId) return "history_truncated";
  if (!base) return "no_checkpoint";

  return { baseCheckpointId: base, oracle: last };
}

/** Tool rows from `knox/finishTurn`, used when soul history dropped the writes. */
export interface TurnToolHint {
  name: string;
  status: string;
  args?: unknown;
  command?: string;
}

function commandFromToolHint(tool: TurnToolHint): string | undefined {
  if (tool.command?.trim()) return tool.command.trim();
  const parsed = tool.args && typeof tool.args === "object" ? (tool.args as Record<string, unknown>) : undefined;
  return typeof parsed?.command === "string" ? parsed.command.trim() : undefined;
}

/**
 * Synthesize soul-shaped events from the GUI's settled tool list so plan-apply
 * / truncated history still has mutation + command evidence.
 */
export function soulEventsFromTurnTools(
  tools: readonly TurnToolHint[],
  markEpisodicId: number,
): TurnSoulEvent[] {
  const out: TurnSoulEvent[] = [];
  let id = markEpisodicId + 1;
  for (const tool of tools) {
    if (tool.status !== "done") continue;
    const files = extractSoulFiles(tool.name, tool.args);
    const command = commandFromToolHint(tool);
    out.push({
      episodicId: id++,
      kind: "tool_success",
      toolName: tool.name,
      files,
      ...(command ? { command } : {}),
    });
  }
  return out;
}

export function mergeTurnToolEvents(
  events: readonly TurnSoulEvent[],
  tools: readonly TurnToolHint[] | undefined,
  markEpisodicId: number,
): TurnSoulEvent[] {
  if (!tools?.length) return [...events];
  const extra = soulEventsFromTurnTools(tools, markEpisodicId);
  if (extra.length === 0) return [...events];
  const seen = new Set(events.map((e) => `${e.toolName ?? ""}:${(e.files ?? []).join(",")}:${e.command ?? ""}`));
  const merged = [...events];
  for (const event of extra) {
    const key = `${event.toolName ?? ""}:${event.files.join(",")}:${event.command ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  return merged;
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
  /** Optional text for slot extraction; never stored on the recipe. */
  content?: string;
  /** Base64 / NUL bytes — never captured. */
  binary?: boolean;
  /** UTF-8 byte length of `content` when known. */
  byteLength?: number;
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
  /** Safe terminal commands from this turn (already gated). */
  commands?: readonly string[];
  /** Language / framework checks from the workspace at capture time. */
  envPreconditions?: readonly RecipePrecondition[];
  /** Paths the user asked to keep even if they look like noise. */
  includePaths?: readonly string[];
  /** Command-only recipes may have zero file changes. */
  allowCommandRecipes?: boolean;
}

/** Lockfiles, build output, generated bundles — they blow the file cap and never replay well. */
export function isRecipeNoisePath(rel: string): boolean {
  const p = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p) return false;
  if (NOISE_DIR_RE.test(p) || NOISE_FILE_RE.test(p) || NOISE_EXT_RE.test(p) || GENERATED_RE.test(p)) {
    return true;
  }
  return false;
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export interface SelectRecipeChangesResult {
  kept: TurnFileChange[];
  droppedNoise: number;
  droppedOverflow: number;
}

/**
 * Drop noise, fail closed on secrets, then cap to `MAX_RECIPE_FILES` preferring
 * paths mentioned in the intent or an explicit include list.
 */
export function selectRecipeChanges(
  changes: readonly TurnFileChange[],
  opts?: { intent?: string; includePaths?: readonly string[] },
): SelectRecipeChangesResult | CaptureSkipReason {
  if (changes.some((c) => c.hasSecret || isSensitiveSecretFile(c.path))) {
    return "secret_detected";
  }
  if (changes.some((c) => c.binary || (c.content && c.content.includes("\0")))) {
    return "too_large";
  }
  const include = new Set((opts?.includePaths ?? []).map(normalizeRel).filter(Boolean));
  const mentioned = new Set(extractMentionedPaths(opts?.intent ?? "").map(normalizeRel));
  const signal = (c: TurnFileChange) => include.has(normalizeRel(c.path)) || mentioned.has(normalizeRel(c.path));
  const kept: TurnFileChange[] = [];
  let droppedNoise = 0;
  for (const change of changes) {
    if (!signal(change) && isRecipeNoisePath(change.path)) {
      droppedNoise++;
      continue;
    }
    kept.push(change);
  }
  kept.sort((a, b) => {
    const as = signal(a) ? 0 : 1;
    const bs = signal(b) ? 0 : 1;
    return as - bs || a.path.localeCompare(b.path);
  });
  let droppedOverflow = 0;
  let selected = kept;
  if (kept.length > MAX_RECIPE_FILES) {
    const preferred = kept.filter(signal);
    selected = (preferred.length > 0 ? preferred : kept).slice(0, MAX_RECIPE_FILES);
    droppedOverflow = kept.length - selected.length;
  }
  if (selected.length === 0 && droppedNoise === 0 && droppedOverflow === 0) return "no_changes";
  if (selected.length === 0) return "no_changes";
  const tooBig = (c: TurnFileChange) =>
    !c.deleted &&
    (c.byteLength ?? (c.content ? Buffer.byteLength(c.content) : 0)) > MAX_RECIPE_FILE_TEXT_BYTES;
  if (selected.some(tooBig)) return "too_large";
  const total = selected.reduce(
    (n, c) => n + (c.byteLength ?? (c.content ? Buffer.byteLength(c.content) : 0)),
    0,
  );
  if (total > MAX_RECIPE_TEXT_BYTES) return "too_large";
  return { kept: selected, droppedNoise, droppedOverflow };
}

/** Attach `knoxchat.verifyCommand` to an LSP/user pass so replay has a real check. */
export function withVerifyCommand(oracle: SoulOracle, verifyCommand?: string): SoulOracle {
  const command = verifyCommand?.trim();
  if (!command || oracle.command) return oracle;
  if (replayableCommandProblem(command)) return oracle;
  return { ...oracle, command };
}

const COMMAND_TOOLS = new Set(["builtin_run_terminal_command"]);
const MAX_COMMAND_STEPS = 8;

function commandFromEvent(event: TurnSoulEvent): string | undefined {
  const explicit = event.command?.trim();
  if (explicit) return explicit;
  if (event.toolName !== "builtin_run_terminal_command") return undefined;
  const fromSummary = /(?:exited \d+|killed):\s+(.+)$/m.exec(event.summary ?? "");
  return fromSummary?.[1]?.trim() || undefined;
}

/** Terminal commands this turn ran that are safe to replay with the files. */
export function extractReplayableCommands(
  events: readonly TurnSoulEvent[],
  markEpisodicId: number,
  oracleCommand?: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const oracle = oracleCommand?.trim();
  for (const event of events) {
    if (event.episodicId <= markEpisodicId) continue;
    if (event.kind !== "tool_success") continue;
    if (!event.toolName || !COMMAND_TOOLS.has(event.toolName)) continue;
    const command = commandFromEvent(event);
    if (!command || command === oracle) continue;
    if (replayableCommandProblem(command)) continue;
    if (seen.has(command)) continue;
    seen.add(command);
    out.push(command);
    if (out.length >= MAX_COMMAND_STEPS) break;
  }
  return out;
}

export function recipeTitleFromIntent(userMessage: string, paths: readonly string[]): string {
  return (
    deriveCheckpointLabel({ intent: userMessage, files: paths }) ||
    userMessage.trim().replace(/\s+/g, " ").slice(0, 80)
  );
}

export function buildCandidateInput(args: BuildCandidateArgs): NewRecipeInput | CaptureSkipReason {
  const intentFingerprint = provisionalIntentFingerprint(args.userMessage);
  if (!intentFingerprint) return "no_intent";
  const selected = args.changes.length
    ? selectRecipeChanges(args.changes, { intent: args.userMessage, includePaths: args.includePaths })
    : { kept: [] as TurnFileChange[], droppedNoise: 0, droppedOverflow: 0 };
  if (typeof selected === "string") return selected;
  const commands = args.commands ?? [];
  const commandList =
    commands.length > 0
      ? commands
      : selected.kept.length === 0 && args.allowCommandRecipes && args.oracle.command && !replayableCommandProblem(args.oracle.command)
        ? [args.oracle.command]
        : [];
  if (selected.kept.length === 0 && commandList.length === 0) {
    return args.changes.length > MAX_RECIPE_FILES ? "too_many_files" : "no_changes";
  }

  const fileSteps: RecipeStep[] = [...selected.kept]
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
  const commandSteps: RecipeStep[] = commandList.map((command) => ({
    kind: "command" as const,
    command,
  }));
  const steps = [...fileSteps, ...commandSteps];
  if (steps.length === 0) return "no_changes";
  const preconditions = [
    ...derivePreconditions(fileSteps),
    ...(args.envPreconditions ?? []),
  ];
  const intentText = args.userMessage.trim().slice(0, 2000);
  const familyId = computeFamilyIdFromRecipe({
    projectId: args.projectId,
    intentText,
    intentFingerprint,
    slots: [],
    slotValues: {},
    steps,
  });

  return {
    projectId: args.projectId,
    title: recipeTitleFromIntent(
      args.userMessage,
      fileSteps.map((s) => s.path!).filter(Boolean),
    ),
    intentText,
    intentFingerprint,
    familyId,
    preconditions,
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
  /** When set, verified recipes whose linked memory row is gone are relinked. */
  memoryExists?: (memoryId: number) => Promise<boolean>;
  /** Workspace probe for language / framework preconditions. */
  env?: PreconditionEnv;
  /** Blob bytes for slot extraction against an existing sibling recipe. */
  readBlob?(hash: string): Promise<string | Uint8Array | undefined>;
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
    turnStartCheckpointId?: string;
    turnTools?: readonly TurnToolHint[];
    allowCommandRecipes?: boolean;
    includePaths?: readonly string[];
    verifyCommand?: string;
  },
): Promise<CaptureResult> {
  if (!input.sessionId) return { captured: false, reason: "no_session" };
  if (input.markEpisodicId === undefined) return { captured: false, reason: "no_turn_mark" };

  const events = mergeTurnToolEvents(input.events, input.turnTools, input.markEpisodicId);
  const evidence = selectTurnEvidence(events, input.markEpisodicId, {
    turnStartCheckpointId: input.turnStartCheckpointId,
    allowCommandRecipes: input.allowCommandRecipes,
  });
  if (typeof evidence === "string") return { captured: false, reason: evidence };

  const diff = await deps.diffAgainst(evidence.baseCheckpointId);
  if (!diff && !(input.allowCommandRecipes && extractReplayableCommands(events, input.markEpisodicId, evidence.oracle.command).length)) {
    return { captured: false, reason: "no_changes" };
  }

  const envPreconditions = deps.env ? await deriveEnvironmentPreconditions(deps.env).catch(() => []) : [];
  const oracle = withVerifyCommand(evidence.oracle, input.verifyCommand);
  const candidate = buildCandidateInput({
    projectId: input.projectId,
    sessionId: input.sessionId,
    userMessage: input.userMessage,
    afterCheckpointId: diff?.afterCheckpointId ?? evidence.baseCheckpointId,
    changes: diff?.changes ?? [],
    oracle,
    commands: extractReplayableCommands(events, input.markEpisodicId, oracle.command),
    envPreconditions,
    includePaths: input.includePaths,
    allowCommandRecipes: input.allowCommandRecipes,
  });
  if (typeof candidate === "string") return { captured: false, reason: candidate };

  const { recipe: stored, created } = await deps.store.create(candidate);
  // Identical work seen again after a passing oracle is a second success (MC-15).
  if (!created && candidate.oracle && (stored.status === "candidate" || stored.status === "verified")) {
    await deps.store.recordCapture(stored.id, candidate.oracle);
  }
  const linked = await linkRecipeFamily(deps.store, (await deps.store.get(stored.id)) ?? stored, {
    readBlob: deps.readBlob,
  }).catch(() => stored);
  let { recipe, promoted } = await promoteIfEligible(deps.store, linked.id);
  if (created && recipe.familyId) {
    const family = await deps.store.list({ projectId: recipe.projectId, familyId: recipe.familyId, status: ["candidate", "verified"] });
    for (const member of family) {
      if (member.id === recipe.id) continue;
      await promoteIfEligible(deps.store, member.id).catch(() => undefined);
    }
    recipe = (await deps.store.get(recipe.id)) ?? recipe;
  }
  if (deps.storeMemory && recipe.status === "verified") {
    // Linking is best-effort: a memory failure must not lose the capture.
    recipe = await linkRecipeMemory(deps.store, recipe, deps.storeMemory, deps.memoryExists).catch(() => recipe);
  }
  return { captured: true, created, recipe, promoted };
}
