/**
 * K-035: Memory Brain benchmark.
 *
 * Seeds a throwaway brain with `BENCH_MEMORIES`, runs `BENCH_QUERIES` through the
 * real pre-turn pipeline and reports:
 *   - recall@k   fraction of expected memories that were injected
 *   - precision  fraction of injected memories that were expected
 *   - falseInjectRate  unrelated queries that still got memories
 *   - injected tokens per turn (mean / max) and the hard cap
 *   - retrieval latency per turn (p50 / p95 / max)
 *   - seedMs     time to store the fixtures
 *
 * Run `npm run bench:memory` to rewrite `baseline.json`.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { BENCH_MEMORIES, BENCH_QUERIES, type BenchMemory, type BenchQuery } from "./fixtures";

export interface BenchQueryResult {
  id: string;
  expected: string[];
  injected: string[];
  tokens: number;
  ms: number;
}

export interface BenchReport {
  memories: number;
  queries: number;
  recallAtK: number;
  precision: number;
  falseInjectRate: number;
  tokensMean: number;
  tokensMax: number;
  tokenCap: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
  seedMs: number;
  perQuery: BenchQueryResult[];
}

const round = (n: number, digits = 3) => Number(n.toFixed(digits));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface BenchFixtures {
  memories: BenchMemory[];
  queries: BenchQuery[];
}

export async function runMemoryBench(
  fixtures: BenchFixtures = { memories: BENCH_MEMORIES, queries: BENCH_QUERIES },
): Promise<BenchReport> {
  const BENCH_MEMORIES = fixtures.memories;
  const BENCH_QUERIES = fixtures.queries;
  const dir = path.join(os.tmpdir(), `brain-bench-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = dir;

  const { BrainManager } = await import("../brain/BrainManager.js");
  const { BrainStore } = await import("../brain/BrainStore.js");
  const { MemoryPipeline } = await import("../brain/MemoryPipeline.js");
  const { getMemoryInjectHardCap } = await import("../brain/memoryConfigAccess.js");

  try {
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "project");

    const sessionId = "bench-session";
    await BrainManager.trackSession(sessionId, "Bench", dir);

    const idByKey = new Map<string, string>();
    const seedStart = performance.now();
    for (const m of BENCH_MEMORIES) {
      await BrainManager.store({
        category: m.category,
        title: m.title,
        content: m.content,
        keywords: m.keywords,
        session_id: sessionId,
        importance: m.importance,
      });
      idByKey.set(m.title, m.key);
    }
    const seedMs = performance.now() - seedStart;

    const perQuery: BenchQueryResult[] = [];
    let hits = 0;
    let expectedTotal = 0;
    let injectedTotal = 0;
    let injectedCorrect = 0;
    let unrelated = 0;
    let falseInjects = 0;

    for (const q of BENCH_QUERIES) {
      const start = performance.now();
      const result = await MemoryPipeline.runPreTurn({
        message: q.message,
        session_id: sessionId,
        goal: q.message,
      });
      const ms = performance.now() - start;

      const items = result.context?.items ?? [];
      const injected = items
        .filter((i) => i.kind === "semantic")
        .map((i) => idByKey.get(i.title))
        .filter((k): k is string => Boolean(k));
      const text = result.context?.context ?? "";
      const tokens = Math.ceil(text.length / 4);

      perQuery.push({ id: q.id, expected: q.expected, injected, tokens, ms: round(ms, 1) });

      if (q.expected.length === 0) {
        unrelated++;
        if (injected.length > 0) falseInjects++;
      } else {
        expectedTotal += q.expected.length;
        hits += q.expected.filter((k) => injected.includes(k)).length;
        injectedTotal += injected.length;
        injectedCorrect += injected.filter((k) => q.expected.includes(k)).length;
      }
    }

    const lat = perQuery.map((r) => r.ms).sort((a, b) => a - b);
    const tok = perQuery.map((r) => r.tokens);
    return {
      memories: BENCH_MEMORIES.length,
      queries: BENCH_QUERIES.length,
      recallAtK: round(expectedTotal ? hits / expectedTotal : 1),
      precision: round(injectedTotal ? injectedCorrect / injectedTotal : 1),
      falseInjectRate: round(unrelated ? falseInjects / unrelated : 0),
      tokensMean: Math.round(tok.reduce((a, b) => a + b, 0) / Math.max(1, tok.length)),
      tokensMax: Math.max(0, ...tok),
      tokenCap: getMemoryInjectHardCap(),
      latencyP50Ms: round(percentile(lat, 0.5), 1),
      latencyP95Ms: round(percentile(lat, 0.95), 1),
      latencyMaxMs: round(lat[lat.length - 1] ?? 0, 1),
      seedMs: Math.round(seedMs),
      perQuery,
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // temp dir cleanup is best effort
    }
  }
}
