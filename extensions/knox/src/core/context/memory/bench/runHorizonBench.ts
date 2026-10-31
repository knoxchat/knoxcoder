/**
 * MEM-41: Answerable horizon H_0.85.
 *
 * Seeds gold facts, warps `last_accessed_at` / `created_at` to age L, and
 * measures E[Rec | fact age = L] through the live pre-turn pipeline.
 *
 *   H_ρ = sup { L : that expectation ≥ ρ },  ρ = 0.85
 *
 * Rec is treated as nonincreasing in L (forgetting). The published number
 * is the prefix-sup on the measured curve; `censored` means Rec never
 * dropped below ρ, so H is a lower bound (at least the last L).
 *
 *   KNOX_HORIZON_LS=0,14,60 npx vitest run context/memory/bench/horizon
 *
 * Fillers stay fresh so aged needles compete with current history.
 * Each run also publishes σ / ε_B / ε_S (MEM-42).
 */
import fs from "fs";
import os from "os";
import path from "path";

import {
  HORIZON_LS,
  HORIZON_RHO,
  answerableHorizon,
  type AnswerableHorizon,
} from "./gate";
import {
  aggregateQueryErrors,
  buildTheoremErrorReport,
  keysFromRefs,
  selectionMissRate,
} from "./errors";
import { BENCH_MEMORIES, BENCH_QUERIES, type BenchMemory, type BenchQuery } from "./fixtures";

export { HORIZON_LS, HORIZON_RHO, answerableHorizon };

/** Fresh distractors so aged needles are not the only rows in Ω(q). */
export const HORIZON_FILLERS = 40;

export interface HorizonQueryResult {
  id: string;
  r_q: string[];
  c_q: string[];
  rec: number;
  c_use: number;
  ms: number;
}

export interface HorizonPoint {
  /** Fact age L in days. */
  l: number;
  /** E[Rec(q) | fact age = L] over queries with |R(q)| > 0. */
  rec: number;
  recallAtK: number;
  c_use_mean: number;
  c_use_max: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
  misses: Array<{ id: string; missing: string[]; injected: string[] }>;
  perQuery: HorizonQueryResult[];
  epsilon_b: number | null;
  epsilon_b_note?: string;
  epsilon_s: number;
  theorem_held?: boolean;
  tree_ready?: boolean;
}

export interface HorizonReport {
  rho: number;
  /** Discrete prefix-sup. */
  h_0_85: number;
  /** Interpolated first crossing, when Rec drops. */
  h_interp?: number;
  /** Rec never fell below ρ — H is a lower bound. */
  censored: boolean;
  first_miss_l?: number;
  points: HorizonPoint[];
  fillers: number;
  seedMs: number;
  nowMs: number;
  sigma: number;
  epsilon_b: number | null;
  epsilon_b_note?: string;
  epsilon_s: number;
  theorem_held: boolean;
  tree_ready?: boolean;
}

export interface HorizonBenchOptions {
  ls?: number[];
  fillers?: number;
  memories?: BenchMemory[];
  queries?: BenchQuery[];
  /** Frozen "now" for the age warp. Default `Date.now()`. */
  nowMs?: number;
}

const MS_PER_DAY = 86_400_000;
const round = (n: number, digits = 3) => Number(n.toFixed(digits));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCAB = (
  "token database test deploy cache user session service module config build release branch " +
  "request handler error log queue worker schema index query network file parser client server " +
  "retry timeout feature flag style format package import export function class interface " +
  "memory thread buffer stream event hook route page widget layout theme color font icon " +
  "invoice order cart payment ledger audit report metric alert dashboard billing tenant quota"
).split(" ");

export function resolveHorizonLs(env: NodeJS.ProcessEnv = process.env): number[] {
  const raw = env.KNOX_HORIZON_LS?.trim();
  const ls = raw
    ? raw.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0)
    : [...HORIZON_LS];
  return [...new Set(ls)].sort((a, b) => a - b);
}

/** ISO timestamp `nowMs − L days`. Used to warp `last_accessed_at` / `created_at`. */
export function factAgeTimestamp(lDays: number, nowMs: number = Date.now()): string {
  const t = nowMs - Math.max(0, lDays) * MS_PER_DAY;
  return new Date(t).toISOString();
}

export async function ageSemanticFacts(
  db: { run: (sql: string, params?: unknown[]) => Promise<unknown> },
  titles: readonly string[],
  lDays: number,
  nowMs: number = Date.now(),
): Promise<string> {
  const stamped = factAgeTimestamp(lDays, nowMs);
  for (const title of titles) {
    await db.run(
      `UPDATE brain_semantic SET last_accessed_at = ?, created_at = ? WHERE title = ?`,
      [stamped, stamped, title],
    );
  }
  return stamped;
}

export function horizonFromPoints(
  points: readonly Pick<HorizonPoint, "l" | "rec">[],
  rho: number = HORIZON_RHO,
): AnswerableHorizon {
  return answerableHorizon(
    points.map((p) => ({ l: p.l, rec: p.rec })),
    rho,
  );
}

export async function runHorizonBench(
  options: HorizonBenchOptions = {},
): Promise<HorizonReport> {
  const memories = options.memories ?? BENCH_MEMORIES;
  const queries = options.queries ?? BENCH_QUERIES;
  const ls = options.ls ?? resolveHorizonLs();
  const fillers = Math.max(0, Math.floor(options.fillers ?? HORIZON_FILLERS));
  const nowMs = options.nowMs ?? Date.now();
  const rho = HORIZON_RHO;

  const dir = path.join(os.tmpdir(), `brain-horizon-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  const prevGlobal = process.env.KNOX_GLOBAL_DIR;
  const prevMaxBytes = process.env.KNOX_BRAIN_MAX_BYTES;
  process.env.KNOX_GLOBAL_DIR = dir;
  process.env.KNOX_BRAIN_MAX_BYTES = "0";

  const { close } = await import("../brain/store/connection.js");
  await close();

  const { BrainManager } = await import("../brain/BrainManager.js");
  const { BrainStore } = await import("../brain/BrainStore.js");
  const { MemoryPipeline } = await import("../brain/MemoryPipeline.js");
  const { get } = await import("../brain/store/connection.js");

  try {
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "project");

    const sessionId = "horizon-query";
    await BrainManager.trackSession(sessionId, "Horizon query", path.join(dir, "project-horizon"));

    const idByTitle = new Map<string, string>();
    const keyById = new Map<number, string>();
    const goldLeaves: Array<{ type: "semantic"; id: number }> = [];
    const goldTitles: string[] = [];
    for (const memory of memories) {
      const id = await BrainManager.store({
        category: memory.category,
        title: memory.title,
        content: memory.content,
        keywords: memory.keywords,
        session_id: sessionId,
        importance: memory.importance,
      });
      idByTitle.set(memory.title, memory.key);
      goldTitles.push(memory.title);
      if (Number.isFinite(id) && id > 0) {
        keyById.set(id, memory.key);
        goldLeaves.push({ type: "semantic", id });
      }
    }

    const db = await get();
    const seedStart = performance.now();
    await seedFreshFillers(db, sessionId, fillers, rng(41));
    const { ingestSessionLeaves } = await import("../brain/SummaryTree.js");
    await ingestSessionLeaves(sessionId, { db });

    const gold = queries.filter((q) => q.expected.length > 0);
    if (gold[0]) {
      await MemoryPipeline.runPreTurn({
        message: gold[0].message,
        session_id: sessionId,
        goal: gold[0].message,
      });
    }

    const points: HorizonPoint[] = [];
    for (const l of ls) {
      await ageSemanticFacts(db, goldTitles, l, nowMs);
      points.push(
        await measureHorizonPoint({
          MemoryPipeline,
          queries: gold,
          idByTitle,
          keyById,
          goldLeaves,
          sessionId,
          l,
        }),
      );
    }

    const horizon = horizonFromPoints(points, rho);
    const n = memories.length + fillers;
    const theorem = buildTheoremErrorReport({
      sigma: 1,
      epsilonB: points.find((p) => p.epsilon_b != null)?.epsilon_b ?? null,
      epsilonS: points.length ? points.reduce((s, p) => s + (p.epsilon_s ?? 0), 0) / points.length : 0,
      treeReady: points.some((p) => p.tree_ready),
      epsilonBNote: points.find((p) => p.epsilon_b == null)?.epsilon_b_note,
      points: points.map((p) => ({ n_q: n, rec: p.rec })),
    });
    return {
      rho,
      h_0_85: horizon.h,
      h_interp: horizon.hInterp,
      censored: horizon.censored,
      first_miss_l: horizon.firstMissL,
      points,
      fillers,
      seedMs: Math.round(performance.now() - seedStart),
      nowMs,
      sigma: theorem.sigma,
      epsilon_b: theorem.epsilon_b,
      epsilon_b_note: theorem.epsilon_b_note,
      epsilon_s: theorem.epsilon_s,
      theorem_held: theorem.theorem_held,
      tree_ready: theorem.tree_ready,
    };
  } finally {
    try {
      await close();
    } catch {
      // best effort
    }
    if (prevGlobal === undefined) delete process.env.KNOX_GLOBAL_DIR;
    else process.env.KNOX_GLOBAL_DIR = prevGlobal;
    if (prevMaxBytes === undefined) delete process.env.KNOX_BRAIN_MAX_BYTES;
    else process.env.KNOX_BRAIN_MAX_BYTES = prevMaxBytes;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // temp dir cleanup is best effort
    }
  }
}

async function seedFreshFillers(
  db: any,
  sessionId: string,
  fillers: number,
  rand: () => number,
): Promise<void> {
  if (fillers <= 0) return;
  const pick = () => VOCAB[Math.floor(rand() * VOCAB.length)];
  const words = (count: number) => Array.from({ length: count }, pick).join(" ");
  const categories = ["fact", "decision", "preference"];

  await db.exec("BEGIN");
  const insert = await db.prepare?.(
    `INSERT INTO brain_semantic (category, title, content, source_session_id, keywords, importance_score, salience)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    for (let i = 0; i < fillers; i++) {
      const params = [
        categories[i % 3],
        `${words(4)} note ${i}`,
        `${words(24)}.`,
        sessionId,
        `${pick()}, ${pick()}, ${pick()}`,
        0.2 + rand() * 0.5,
        0.2 + rand() * 0.5,
      ];
      if (insert) await insert.run(...params);
      else {
        await db.run(
          `INSERT INTO brain_semantic (category, title, content, source_session_id, keywords, importance_score, salience)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          params,
        );
      }
    }
  } finally {
    if (insert) await insert.finalize();
    await db.exec("COMMIT");
  }
}

async function measureHorizonPoint(args: {
  MemoryPipeline: typeof import("../brain/MemoryPipeline.js").MemoryPipeline;
  queries: BenchQuery[];
  idByTitle: Map<string, string>;
  keyById: Map<number, string>;
  goldLeaves: Array<{ type: "semantic"; id: number }>;
  sessionId: string;
  l: number;
}): Promise<HorizonPoint> {
  const recs: number[] = [];
  const cUses: number[] = [];
  const latencies: number[] = [];
  const misses: HorizonPoint["misses"] = [];
  const perQuery: HorizonQueryResult[] = [];
  const samples: import("./errors").QueryErrorSample[] = [];
  let hits = 0;
  let expectedTotal = 0;
  const { measureTreeBeamMiss } = await import("../brain/SummaryTree.js");
  const n = args.goldLeaves.length;

  for (const query of args.queries) {
    const t0 = performance.now();
    const result = await args.MemoryPipeline.runPreTurn({
      message: query.message,
      session_id: args.sessionId,
      goal: query.message,
    });
    const ms = performance.now() - t0;
    const injected = (result.context?.items ?? [])
      .filter((item) => item.kind === "semantic")
      .map((item) => args.idByTitle.get(item.title) ?? (item.id != null ? args.keyById.get(item.id) : undefined))
      .filter((key): key is string => Boolean(key));
    const candidateKeys = keysFromRefs(result.context?.cand ?? [], args.idByTitle, args.keyById);
    const found = query.expected.filter((key) => injected.includes(key));
    const rec = query.expected.length ? found.length / query.expected.length : 1;
    const select = selectionMissRate({
      relevant: query.expected,
      candidates: candidateKeys,
      selected: injected,
    });
    const relevantLeaves = args.goldLeaves.filter((leaf) => {
      const key = args.keyById.get(leaf.id);
      return Boolean(key && query.expected.includes(key));
    });
    const beam = await measureTreeBeamMiss({
      query: query.message,
      sessionId: args.sessionId,
      includeEpisodic: false,
      relevantLeaves,
    });
    samples.push({
      epsilonB: beam.epsilonB,
      epsilonBNote: beam.epsilonBNote,
      epsilonBOpportunities: beam.opportunities,
      epsilonBMisses: beam.misses,
      epsilonS: select.epsilonS,
      epsilonSOpportunities: select.opportunities,
      epsilonSMisses: select.misses,
      n_q: n,
      n,
      rec,
    });
    const cUse =
      result.context?.c_use ??
      Math.ceil((result.context?.context ?? "").length / 4);

    recs.push(rec);
    cUses.push(cUse);
    latencies.push(ms);
    expectedTotal += query.expected.length;
    hits += found.length;
    if (found.length < query.expected.length) {
      misses.push({
        id: query.id,
        missing: query.expected.filter((key) => !injected.includes(key)),
        injected,
      });
    }
    perQuery.push({
      id: query.id,
      r_q: query.expected,
      c_q: found,
      rec: round(rec),
      c_use: cUse,
      ms: round(ms, 1),
    });
  }

  latencies.sort((a, b) => a - b);
  const theorem = aggregateQueryErrors(samples, { rec: mean(recs), n_q: n });
  return {
    l: args.l,
    rec: round(mean(recs)),
    recallAtK: round(expectedTotal ? hits / expectedTotal : 1),
    c_use_mean: Math.round(mean(cUses)),
    c_use_max: Math.max(0, ...cUses),
    latencyP50Ms: round(percentile(latencies, 0.5), 1),
    latencyP95Ms: round(percentile(latencies, 0.95), 1),
    latencyMaxMs: round(latencies[latencies.length - 1] ?? 0, 1),
    misses,
    perQuery,
    epsilon_b: theorem.epsilon_b,
    epsilon_b_note: theorem.epsilon_b_note,
    epsilon_s: round(theorem.epsilon_s),
    theorem_held: theorem.theorem_held,
    tree_ready: theorem.tree_ready,
  };
}
