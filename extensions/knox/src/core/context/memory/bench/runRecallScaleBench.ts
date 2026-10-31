/**
 * MEM-40: Recall-versus-N scale bench.
 *
 * Seeds gold memories `R(q)` into one project and overlapping-vocab filler
 * across several projects so `N_q = σ N` (project scope), not one flat
 * session of 100k. Measures Rec, |C(q)|, and pre-turn latency at each N.
 *
 *   N ∈ {1e3, 1e4, 1e5} by default. 1e6 is nightly (`KNOX_SCALE_NIGHTLY=1`).
 *   Cap / override with `KNOX_SCALE_ITEMS` or `KNOX_RECALL_SCALE_NS=1000,10000`.
 *
 * Publishes σ, ε_B, ε_S on every point (MEM-42). ε_B is `n/a — flat FTS`
 * until the query-session tree has ≥ b leaves. `theorem_held` is true only
 * when ε_B is finite and Rec stays at `1 − ε_S − ε_B ⌈log_b N_q⌉`.
 */
import fs from "fs";
import os from "os";
import path from "path";

import {
  RECALL_SCALE_NIGHTLY_N,
  RECALL_SCALE_NS,
  RECALL_SCALE_TREE_B,
} from "./gate";
import {
  aggregateQueryErrors,
  buildTheoremErrorReport,
  keysFromRefs,
  selectionMissRate,
  type TheoremErrorReport,
} from "./errors";
import { BENCH_MEMORIES, BENCH_QUERIES, type BenchMemory, type BenchQuery } from "./fixtures";

export { RECALL_SCALE_NIGHTLY_N, RECALL_SCALE_NS };

/** Projects in the seeded brain. Query project is index 0, so σ ≈ 1 / this. */
export const RECALL_SCALE_PROJECTS = 5;

/** Full φ₅ ingest stays cheap below this N_q; larger N still ingest gold so ε_B is defined. */
const TREE_INGEST_CAP = 512;

export interface RecallScaleQueryResult {
  id: string;
  /** Gold relevant set R(q). */
  r_q: string[];
  /** Gold keys that reached C(q). */
  c_q: string[];
  rec: number;
  /** |C(q)| tokens for this call. */
  c_use: number;
  n_q: number;
  ms: number;
  candidates: string[];
  epsilon_b: number | null;
  epsilon_s: number;
}

export interface RecallScalePoint {
  n: number;
  n_q: number;
  sigma: number;
  /** E[Rec(q)] over queries with |R(q)| > 0. */
  rec: number;
  /** Micro-average |R ∩ C| / |R| (same shape as the fixture `recallAtK`). */
  recallAtK: number;
  c_use_mean: number;
  c_use_max: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
  misses: Array<{ id: string; missing: string[]; injected: string[] }>;
  perQuery: RecallScaleQueryResult[];
  epsilon_b: number | null;
  epsilon_b_note?: string;
  epsilon_s: number;
  theorem_held: boolean;
  tree_ready?: boolean;
}

export interface RecallScaleReport {
  points: RecallScalePoint[];
  nightly: boolean;
  scope: "project";
  projects: number;
  seedMs: number;
  dbBytes: number;
  sigma: number;
  epsilon_b: number | null;
  epsilon_b_note?: string;
  epsilon_s: number;
  theorem_held: boolean;
  tree_ready?: boolean;
}

export interface RecallScaleBenchOptions {
  ns?: number[];
  projects?: number;
  memories?: BenchMemory[];
  queries?: BenchQuery[];
}

const round = (n: number, digits = 3) => Number(n.toFixed(digits));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Small deterministic PRNG (mulberry32) so runs are comparable. */
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

export function resolveRecallScaleNs(env: NodeJS.ProcessEnv = process.env): number[] {
  const raw = env.KNOX_RECALL_SCALE_NS?.trim();
  let ns = raw
    ? raw.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [...RECALL_SCALE_NS];
  if (env.KNOX_SCALE_NIGHTLY === "1" && !ns.includes(RECALL_SCALE_NIGHTLY_N)) {
    ns.push(RECALL_SCALE_NIGHTLY_N);
  }
  const capRaw = env.KNOX_SCALE_ITEMS;
  if (capRaw !== undefined && capRaw !== "" && Number.isFinite(Number(capRaw))) {
    const cap = Math.max(1, Math.floor(Number(capRaw)));
    ns = ns.filter((n) => n <= cap);
    if (ns.length === 0) ns = [cap];
  }
  return [...new Set(ns.map((n) => Math.floor(n)))].sort((a, b) => a - b);
}

function sqliteBytes(dir: string): number {
  const memoryDir = path.join(dir, "memory");
  const name = fs.readdirSync(memoryDir).find((f) => f.endsWith(".sqlite"));
  if (!name) return 0;
  return fs.statSync(path.join(memoryDir, name)).size;
}

export async function runRecallScaleBench(
  options: RecallScaleBenchOptions = {},
): Promise<RecallScaleReport> {
  const memories = options.memories ?? BENCH_MEMORIES;
  const queries = options.queries ?? BENCH_QUERIES;
  const projects = Math.max(2, Math.floor(options.projects ?? RECALL_SCALE_PROJECTS));
  const requested = options.ns ?? resolveRecallScaleNs();
  const minN = memories.length;
  const ns = requested.map((n) => Math.max(minN, n));
  const nightly = ns.includes(RECALL_SCALE_NIGHTLY_N);

  const dir = path.join(os.tmpdir(), `brain-recall-scale-${process.pid}-${Date.now()}`);
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

    const querySession = "recall-scale-query";
    const sessionIds = [querySession];
    await BrainManager.trackSession(querySession, "Recall scale query", path.join(dir, "project-query"));
    for (let i = 1; i < projects; i++) {
      const id = `recall-scale-d${i}`;
      sessionIds.push(id);
      await BrainManager.trackSession(id, `Recall scale distractor ${i}`, path.join(dir, `project-d${i}`));
    }

    const idByTitle = new Map<string, string>();
    const keyById = new Map<number, string>();
    const goldLeaves: Array<{ type: "semantic"; id: number }> = [];
    for (const memory of memories) {
      const id = await BrainManager.store({
        category: memory.category,
        title: memory.title,
        content: memory.content,
        keywords: memory.keywords,
        session_id: querySession,
        importance: memory.importance,
      });
      idByTitle.set(memory.title, memory.key);
      if (Number.isFinite(id) && id > 0) {
        keyById.set(id, memory.key);
        goldLeaves.push({ type: "semantic", id });
      }
    }

    const db = await get();
    const rand = rng(1234);
    const seedStart = performance.now();
    const points: RecallScalePoint[] = [];

    const { ingestSessionLeaves, insertTreeLeaf } = await import("../brain/SummaryTree.js");

    for (const n of ns) {
      await seedFillersTo(db, n, sessionIds, rand);
      const nQ = await countLiveSemantic(db, [querySession]);
      if (nQ <= TREE_INGEST_CAP) {
        await ingestSessionLeaves(querySession, { db });
      } else {
        for (const leaf of goldLeaves) {
          await insertTreeLeaf(
            { type: "semantic", id: leaf.id, text: memories.find((m) => keyById.get(leaf.id) === m.key)?.content ?? "gold" },
            { sessionId: querySession, db },
          );
        }
      }
      points.push(
        await measurePoint({
          MemoryPipeline,
          db,
          queries,
          idByTitle,
          keyById,
          goldLeaves,
          querySession,
        }),
      );
    }

    const theorem = rollupScaleErrors(points);
    return {
      points,
      nightly,
      scope: "project",
      projects,
      seedMs: Math.round(performance.now() - seedStart),
      dbBytes: sqliteBytes(dir),
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

async function countLiveSemantic(
  db: { get: (sql: string, params?: unknown[]) => Promise<{ n?: number } | undefined> },
  sessionIds?: string[],
): Promise<number> {
  const live = `(tombstoned_at IS NULL OR tombstoned_at = '')`;
  if (!sessionIds) {
    const row = await db.get(`SELECT COUNT(*) AS n FROM brain_semantic WHERE ${live}`);
    return Number(row?.n ?? 0);
  }
  if (sessionIds.length === 0) return 0;
  const placeholders = sessionIds.map(() => "?").join(",");
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM brain_semantic
     WHERE ${live} AND source_session_id IN (${placeholders})`,
    sessionIds,
  );
  return Number(row?.n ?? 0);
}

async function countsBySession(
  db: { all: (sql: string, params?: unknown[]) => Promise<Array<{ sid: string; n: number }>> },
  sessionIds: string[],
): Promise<Map<string, number>> {
  const live = `(tombstoned_at IS NULL OR tombstoned_at = '')`;
  const rows = await db.all(
    `SELECT source_session_id AS sid, COUNT(*) AS n
     FROM brain_semantic WHERE ${live} GROUP BY source_session_id`,
  );
  const map = new Map(sessionIds.map((id) => [id, 0]));
  for (const row of rows) {
    if (map.has(row.sid)) map.set(row.sid, Number(row.n) || 0);
  }
  return map;
}

async function seedFillersTo(
  db: any,
  n: number,
  sessionIds: string[],
  rand: () => number,
): Promise<void> {
  const counts = await countsBySession(db, sessionIds);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const toAdd = Math.max(0, n - total);
  if (toAdd === 0) return;

  const running = new Map(counts);
  const assignments: string[] = [];
  for (let i = 0; i < toAdd; i++) {
    let best = sessionIds[0];
    let bestN = running.get(best) ?? 0;
    for (const sessionId of sessionIds) {
      const current = running.get(sessionId) ?? 0;
      if (current < bestN) {
        best = sessionId;
        bestN = current;
      }
    }
    assignments.push(best);
    running.set(best, bestN + 1);
  }

  const pick = () => VOCAB[Math.floor(rand() * VOCAB.length)];
  const words = (count: number) => Array.from({ length: count }, pick).join(" ");
  const categories = ["fact", "decision", "preference"];

  await db.exec("BEGIN");
  const insert = await db.prepare?.(
    `INSERT INTO brain_semantic (category, title, content, source_session_id, keywords, importance_score, salience)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    for (let i = 0; i < assignments.length; i++) {
      const params = [
        categories[i % 3],
        `${words(4)} note ${total + i}`,
        `${words(24)}.`,
        assignments[i],
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

async function measurePoint(args: {
  MemoryPipeline: typeof import("../brain/MemoryPipeline.js").MemoryPipeline;
  db: any;
  queries: BenchQuery[];
  idByTitle: Map<string, string>;
  keyById: Map<number, string>;
  goldLeaves: Array<{ type: "semantic"; id: number }>;
  querySession: string;
}): Promise<RecallScalePoint> {
  const n = await countLiveSemantic(args.db);
  const nQ = await countLiveSemantic(args.db, [args.querySession]);
  const sigma = n ? nQ / n : 0;
  const gold = args.queries.filter((q) => q.expected.length > 0);

  if (gold[0]) {
    await args.MemoryPipeline.runPreTurn({
      message: gold[0].message,
      session_id: args.querySession,
      goal: gold[0].message,
    });
  }

  const recs: number[] = [];
  const cUses: number[] = [];
  const latencies: number[] = [];
  const misses: RecallScalePoint["misses"] = [];
  const perQuery: RecallScaleQueryResult[] = [];
  const samples: import("./errors").QueryErrorSample[] = [];
  let hits = 0;
  let expectedTotal = 0;
  const { measureTreeBeamMiss } = await import("../brain/SummaryTree.js");

  for (const query of gold) {
    const t0 = performance.now();
    const result = await args.MemoryPipeline.runPreTurn({
      message: query.message,
      session_id: args.querySession,
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
      sessionId: args.querySession,
      includeEpisodic: false,
      relevantLeaves,
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
      n_q: nQ,
      ms: round(ms, 1),
      candidates: candidateKeys,
      epsilon_b: beam.epsilonB,
      epsilon_s: round(select.epsilonS),
    });
    samples.push({
      epsilonB: beam.epsilonB,
      epsilonBNote: beam.epsilonBNote,
      epsilonBOpportunities: beam.opportunities,
      epsilonBMisses: beam.misses,
      epsilonS: select.epsilonS,
      epsilonSOpportunities: select.opportunities,
      epsilonSMisses: select.misses,
      n_q: nQ,
      n,
      rec,
    });
  }

  latencies.sort((a, b) => a - b);
  const theorem = aggregateQueryErrors(samples, { rec: mean(recs), n_q: nQ, b: RECALL_SCALE_TREE_B });
  return {
    n,
    n_q: nQ,
    sigma: round(sigma, 4),
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

function rollupScaleErrors(points: RecallScalePoint[]): TheoremErrorReport {
  const measured = points.filter((p) => p.epsilon_b != null);
  const epsilonB = measured.length ? mean(measured.map((p) => p.epsilon_b as number)) : null;
  return buildTheoremErrorReport({
    sigma: mean(points.map((p) => p.sigma)),
    epsilonB,
    epsilonS: mean(points.map((p) => p.epsilon_s)),
    treeReady: measured.length > 0,
    epsilonBNote: measured.length ? undefined : points[0]?.epsilon_b_note,
    points: points.map((p) => ({ n_q: p.n_q, rec: p.rec })),
    b: RECALL_SCALE_TREE_B,
  });
}
