/**
 * MEM-59 — ablation probes.
 *
 * A memory the model uses without citing it looks useless to the log: it only
 * ever collects ω of unhelpful evidence (MEM-57). A probe protects it. For
 * `ablation_rate` (2%) of successful turns, offline, one injected-but-uncited
 * memory is removed and the answer is regenerated. If the answer changes, the
 * memory shaped it: h += 1, a useful FSRS update, and the ω charge is refunded.
 *
 * Decision (docs §11.2.3): the probe costs LLM calls, so it is
 *   - opt-in (`ablation_enabled`, default false),
 *   - budgeted (`ablation_daily_budget` probes per UTC day),
 *   - offline (queued after the turn, drained in the background or in sleep),
 *   - judged lexically. "Changed" is a normalized-token distance between a
 *     control answer (all memory) and the ablated answer, plus a drop in how
 *     much of the removed memory's vocabulary the answer carries, or the
 *     turn's own pass/fail oracle when the runner has one. Never a neural judge.
 */

import { BrainStore } from "./BrainStore.js";
import {
  loadCiteText,
  persistAttributionDecision,
  memoryCiteToken,
  type AttributableMemType,
  type MemoryCite,
  type TurnAttributionOutcome,
} from "./attribution.js";
import { ablationTurnId } from "./calibration.js";
import { getTheoremParamsV2 } from "./memoryConfigAccess.js";
import { contentWords } from "./RetrievalQuery.js";
import { parseFeatures } from "./store/attribution.js";
import type { AttributionRow } from "./store/attribution.js";
import type { Rng } from "./thompson.js";

/** Lexical distance (1 − Jaccard of content words) at or above which an answer "changed". */
export const ABLATION_DISTANCE_THRESHOLD = 0.3;
/** Drop in removed-memory vocabulary coverage that must accompany a changed answer. */
export const ABLATION_COVERAGE_DROP = 0.1;
export const ABLATION_MAX_QUEUE = 20;
export const ABLATION_MAX_MEMORIES_IN_PROMPT = 8;

export interface AblationMemory {
  cite: MemoryCite;
  title: string;
  text: string;
}

export interface AblationJob {
  turn_id: string;
  session_id: string | null;
  scope_key: string;
  user_message: string;
  original_answer: string;
  /** The memory removed for this probe. */
  removed: AblationMemory;
  /** Every other injected memory, kept in the regenerated answer's context. */
  remaining: AblationMemory[];
  score: number | null;
  channel: string | null;
  propensity: number | null;
  features: ReturnType<typeof parseFeatures>;
}

export interface AblationRunResult {
  /** Answer with `removed` taken out of the context. */
  ablated: string;
  /** Answer with every memory kept. Without it the verdict compares to `original_answer`. */
  control?: string;
  /** The turn's own oracle (tests / build) on the ablated run, when one exists. */
  ablated_succeeded?: boolean;
  /** The oracle on the control run. */
  control_succeeded?: boolean;
}

export interface AblationRunner {
  regenerate(job: AblationJob): Promise<AblationRunResult | null>;
}

export type AblationStatus =
  | "changed"
  | "unchanged"
  | "skipped"
  | "error";

export interface AblationOutcome {
  status: AblationStatus;
  distance?: number;
  coverage_drop?: number;
  via?: "oracle" | "lexical";
}

// ── Lexical judge (pure) ────────────────────────────────────────────────────

export function lexicalDistance(a: string, b: string): number {
  const sa = new Set(contentWords(a));
  const sb = new Set(contentWords(b));
  if (sa.size === 0 && sb.size === 0) return 0;
  let shared = 0;
  for (const word of sa) if (sb.has(word)) shared += 1;
  const union = sa.size + sb.size - shared;
  return union > 0 ? 1 - shared / union : 0;
}

/** Share of the memory's content words that appear in `answer`. */
export function vocabularyCoverage(answer: string, memoryText: string): number {
  const memory = new Set(contentWords(memoryText));
  if (memory.size === 0) return 0;
  const words = new Set(contentWords(answer));
  let hit = 0;
  for (const word of memory) if (words.has(word)) hit += 1;
  return hit / memory.size;
}

export function judgeAblation(
  run: AblationRunResult,
  context: { original_answer: string; memory_text: string },
): AblationOutcome {
  // The turn's own oracle wins when both runs have one.
  if (run.control_succeeded != null && run.ablated_succeeded != null) {
    return {
      status: run.control_succeeded && !run.ablated_succeeded ? "changed" : "unchanged",
      via: "oracle",
    };
  }
  if (run.ablated_succeeded === false) {
    return { status: "changed", via: "oracle" };
  }
  const control = run.control ?? context.original_answer;
  const distance = lexicalDistance(control, run.ablated);
  const drop =
    vocabularyCoverage(control, context.memory_text) - vocabularyCoverage(run.ablated, context.memory_text);
  const changed = distance >= ABLATION_DISTANCE_THRESHOLD && drop >= ABLATION_COVERAGE_DROP;
  return {
    status: changed ? "changed" : "unchanged",
    distance,
    coverage_drop: drop,
    via: "lexical",
  };
}

// ── Gate, queue, runner ─────────────────────────────────────────────────────

let runner: AblationRunner | null = null;
let probeRng: Rng = Math.random;
const queue: AblationJob[] = [];
let draining = false;

export function setAblationRunner(next: AblationRunner | null): void {
  runner = next;
}

export function getAblationRunner(): AblationRunner | null {
  return runner;
}

export function setAblationRng(rng: Rng | null): void {
  probeRng = rng ?? Math.random;
}

export function pendingAblations(): number {
  return queue.length;
}

export function clearAblationQueue(): void {
  queue.length = 0;
}

/** Probes already logged since 00:00 UTC. Durable, so a restart cannot reset the budget. */
export async function ablationsToday(now: Date = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  try {
    const db = await BrainStore.get();
    const row = (await db.get(
      `SELECT COUNT(DISTINCT turn_id) AS n FROM brain_attribution
       WHERE source = 'ablation' AND date(created_at) = ?`,
      [day],
    )) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

export async function ablationBudgetRemaining(now: Date = new Date()): Promise<number> {
  const budget = Math.max(0, Math.trunc(getTheoremParamsV2().ablationDailyBudget));
  const used = await ablationsToday(now);
  return Math.max(0, budget - used - queue.length);
}

function pickCandidate(rows: AttributionRow[]): AttributionRow | null {
  const eligible = rows.filter(
    (row) =>
      (row.source ?? "turn") === "turn" &&
      row.injected === 1 &&
      row.cited === 0 &&
      (row.mem_type === "semantic" || row.mem_type === "episodic"),
  );
  if (eligible.length === 0) return null;
  return eligible[Math.min(eligible.length - 1, Math.floor(probeRng() * eligible.length))];
}

async function memoryOf(type: AttributableMemType, memId: string): Promise<AblationMemory> {
  const cite: MemoryCite = { type, mem_id: memId, token: memoryCiteToken(type, memId) };
  const text = await loadCiteText(cite);
  return { cite, title: text.title, text: text.content };
}

/**
 * Decide, after a turn, whether to queue a probe. Returns the queued job or
 * null. Never throws: a probe is optional.
 */
export async function maybeEnqueueAblation(input: {
  turn_id: string;
  session_id?: string | null;
  scope_key?: string;
  user_message: string;
  original_answer: string;
  outcome: TurnAttributionOutcome;
}): Promise<AblationJob | null> {
  try {
    const params = getTheoremParamsV2();
    if (!params.ablationEnabled || !runner) return null;
    if (input.outcome !== "succeeded") return null;
    if (queue.length >= ABLATION_MAX_QUEUE) return null;
    if (!(params.ablationRate > 0) || !(probeRng() < params.ablationRate)) return null;
    if ((await ablationBudgetRemaining()) <= 0) return null;

    const rows = await BrainStore.listAttributionsForTurn(input.turn_id);
    const chosen = pickCandidate(rows);
    if (!chosen) return null;

    const removed = await memoryOf(chosen.mem_type as AttributableMemType, chosen.mem_id);
    if (!removed.text.trim()) return null;
    const remaining: AblationMemory[] = [];
    for (const row of rows) {
      if (row === chosen || row.injected !== 1 || remaining.length >= ABLATION_MAX_MEMORIES_IN_PROMPT) continue;
      if (row.mem_type !== "semantic" && row.mem_type !== "episodic") continue;
      const memory = await memoryOf(row.mem_type as AttributableMemType, row.mem_id);
      if (memory.text.trim()) remaining.push(memory);
    }
    const job: AblationJob = {
      turn_id: input.turn_id,
      session_id: input.session_id ?? null,
      scope_key: input.scope_key ?? chosen.scope_key ?? "",
      user_message: input.user_message,
      original_answer: input.original_answer,
      removed,
      remaining,
      score: chosen.score,
      channel: chosen.channel,
      propensity: chosen.propensity ?? null,
      features: parseFeatures(chosen.features),
    };
    queue.push(job);
    return job;
  } catch {
    return null;
  }
}

async function refundUncitedCharge(cite: MemoryCite): Promise<void> {
  const omega = getTheoremParamsV2().utilityOmega;
  if (!(omega > 0)) return;
  const id = Number(cite.mem_id);
  if (!(id > 0)) return;
  const table = cite.type === "episodic" ? "brain_episodic" : "brain_semantic";
  const db = await BrainStore.get();
  await db.run(
    `UPDATE ${table} SET unhelpful_count = MAX(0, COALESCE(unhelpful_count, 0) - ?) WHERE id = ?`,
    [omega, id],
  );
}

/** Run one probe and write its `source='ablation'` row. */
export async function runAblationJob(job: AblationJob, using: AblationRunner): Promise<AblationOutcome> {
  let run: AblationRunResult | null;
  try {
    run = await using.regenerate(job);
  } catch {
    return { status: "error" };
  }
  if (!run || typeof run.ablated !== "string") return { status: "skipped" };

  const verdict = judgeAblation(run, {
    original_answer: job.original_answer,
    memory_text: `${job.removed.title} ${job.removed.text}`,
  });
  const turnId = ablationTurnId(job.turn_id);
  const base = {
    turn_id: turnId,
    session_id: job.session_id,
    cite: job.removed.cite,
    injected: true,
    cited: false,
    channel: job.channel,
    score: job.score,
    source: "ablation" as const,
    propensity: job.propensity,
    scope_key: job.scope_key,
    features: job.features,
  };
  if (verdict.status === "changed") {
    // h += 1 and a useful FSRS update through the one attribution path.
    await persistAttributionDecision({ ...base, helpful: true });
    await refundUncitedCharge(job.removed.cite).catch(() => {});
  } else {
    // Log the negative as calibration evidence only. No h/u change: ω already covers it.
    await BrainStore.upsertAttribution({
      turn_id: turnId,
      session_id: job.session_id,
      mem_type: job.removed.cite.type,
      mem_id: job.removed.cite.mem_id,
      injected: true,
      cited: false,
      helpful: false,
      channel: job.channel,
      score: job.score,
      source: "ablation",
      propensity: job.propensity,
      scope_key: job.scope_key,
      features: job.features,
    });
  }
  await BrainStore.auditLog("ablation", job.removed.cite.type, job.removed.cite.mem_id, {
    turn_id: job.turn_id,
    status: verdict.status,
    via: verdict.via,
    distance: verdict.distance,
    coverage_drop: verdict.coverage_drop,
  }).catch(() => {});
  return verdict;
}

/** Drain the queue with `using` (or the registered runner). Safe to call concurrently. */
export async function drainAblationQueue(
  using: AblationRunner | null = runner,
  max = ABLATION_MAX_QUEUE,
): Promise<AblationOutcome[]> {
  if (!using || draining) return [];
  draining = true;
  const out: AblationOutcome[] = [];
  try {
    for (let i = 0; i < max && queue.length > 0; i++) {
      const job = queue.shift() as AblationJob;
      out.push(await runAblationJob(job, using));
    }
  } finally {
    draining = false;
  }
  return out;
}

// ── Default LLM runner ──────────────────────────────────────────────────────

function promptFor(job: AblationJob, memories: AblationMemory[]): string {
  const notes = memories
    .map((m) => `${m.cite.token} ${m.title ? `${m.title}: ` : ""}${m.text}`.slice(0, 1200))
    .join("\n");
  return [
    "Answer the task using the quoted notes only where they help.",
    notes ? `Notes:\n${notes}` : "Notes: (none)",
    `Task:\n${job.user_message.slice(0, 4000)}`,
    "Answer concisely.",
  ].join("\n\n");
}

/**
 * Two completions per probe (control + ablated). The control measures how much
 * a rerun varies on its own, so a different sampling is not mistaken for
 * "the memory mattered". No oracle: the verdict is the lexical judge.
 */
export function createLlmAblationRunner(
  getLlm: () => import("../../../index.js").ILLM | null,
): AblationRunner {
  return {
    async regenerate(job) {
      const llm = getLlm();
      if (!llm) return null;
      if (!(await BrainStore.checkRateLimit(1500))) return null;
      const { ResilientLlm } = await import("./LlmResilience.js");
      const withAll = [job.removed, ...job.remaining];
      const control = await ResilientLlm.complete(llm, promptFor(job, withAll), {
        maxTokens: 700,
        skipCache: true,
      });
      const ablated = await ResilientLlm.complete(llm, promptFor(job, job.remaining), {
        maxTokens: 700,
        skipCache: true,
      });
      return { control, ablated };
    },
  };
}

export const Ablation = {
  lexicalDistance,
  vocabularyCoverage,
  judgeAblation,
  maybeEnqueueAblation,
  runAblationJob,
  drainAblationQueue,
  setAblationRunner,
  getAblationRunner,
  setAblationRng,
  pendingAblations,
  clearAblationQueue,
  ablationsToday,
  ablationBudgetRemaining,
  createLlmAblationRunner,
};

