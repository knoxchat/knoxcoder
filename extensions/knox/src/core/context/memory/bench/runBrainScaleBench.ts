/**
 * P1-5: Memory Brain retrieval latency at scale.
 *
 * Seeds the 20 benchmark memories (the needles) plus N generated filler memories directly into
 * the throwaway brain DB (one transaction, FTS triggers still fire), then runs the benchmark
 * queries through the real pre-turn pipeline and `searchSemantic`.
 *
 *   KNOX_SCALE_ITEMS=100000 npx vitest run context/memory/bench/brainScale
 *
 * Filler text is built from a shared vocabulary that overlaps the query words ("token", "database",
 * "test", "deploy" ...), so lexical search has many partial candidates, as in a real long-lived brain.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { BENCH_MEMORIES, BENCH_QUERIES } from "./fixtures";

export interface ScaleReport {
  items: number;
  seedMs: number;
  dbBytes: number;
  recallAtK: number;
  preTurnP50Ms: number;
  preTurnP95Ms: number;
  preTurnMaxMs: number;
  searchP50Ms: number;
  searchP95Ms: number;
  searchMaxMs: number;
  episodicSearchP95Ms: number;
  /** Queries whose expected memories were not all injected. */
  misses: Array<{ id: string; missing: string[]; injected: string[] }>;
}

const round = (n: number, d = 1) => Number(n.toFixed(d));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))];
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

export async function runBrainScaleBench(items: number): Promise<ScaleReport> {
  const dir = path.join(os.tmpdir(), `brain-scale-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  process.env.KNOX_GLOBAL_DIR = dir;
  // The size cap prunes on open and on each tick; 100k rows must not be pruned mid-measurement.
  process.env.KNOX_BRAIN_MAX_BYTES = "0";

  const { BrainManager } = await import("../brain/BrainManager.js");
  const { BrainStore } = await import("../brain/BrainStore.js");
  const { MemoryPipeline } = await import("../brain/MemoryPipeline.js");
  const { searchSemantic } = await import("../brain/store/semantic.js");
  const { searchEpisodic } = await import("../brain/store/episodic.js");
  const { get } = await import("../brain/store/connection.js");

  try {
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    await BrainStore.saveConfig("memory_scope", "project");

    const sessionId = "scale-session";
    await BrainManager.trackSession(sessionId, "Scale", dir);

    const idByTitle = new Map<string, string>();
    for (const m of BENCH_MEMORIES) {
      await BrainManager.store({
        category: m.category,
        title: m.title,
        content: m.content,
        keywords: m.keywords,
        session_id: sessionId,
        importance: m.importance,
      });
      idByTitle.set(m.title, m.key);
    }

    const db = await get();
    const rand = rng(1234);
    const pick = () => VOCAB[Math.floor(rand() * VOCAB.length)];
    const words = (n: number) => Array.from({ length: n }, pick).join(" ");
    const categories = ["fact", "decision", "preference"];

    const seedStart = performance.now();
    await db.exec("BEGIN");
    const fillers = Math.max(0, items - BENCH_MEMORIES.length);
    // Filler is project-scoped to the same session so scope filters do not hide it.
    const insert = await (db as any).prepare?.(
      `INSERT INTO brain_semantic (category, title, content, source_session_id, keywords, importance_score, salience)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
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
      else
        await db.run(
          `INSERT INTO brain_semantic (category, title, content, source_session_id, keywords, importance_score, salience)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          params,
        );
    }
    if (insert) await insert.finalize();
    // Episodic history (the other table `searchEpisodic` reads): one third as many rows.
    const episodicRows = Math.floor(fillers / 3);
    for (let i = 0; i < episodicRows; i++) {
      await db.run(
        `INSERT INTO brain_episodic (session_id, content, importance_score) VALUES (?, ?, ?)`,
        [sessionId, `${words(30)}.`, 0.2 + rand() * 0.5],
      );
    }
    await db.exec("COMMIT");
    const seedMs = performance.now() - seedStart;

    const dbBytes = fs.statSync(path.join(dir, "memory", fs.readdirSync(path.join(dir, "memory")).find((f) => f.endsWith(".sqlite")) ?? "")).size;

    const preTurn: number[] = [];
    const search: number[] = [];
    const episodic: number[] = [];
    let hits = 0;
    let expectedTotal = 0;
    const misses: ScaleReport["misses"] = [];

    // One untimed pass warms SQLite's page cache the way a running session would.
    await MemoryPipeline.runPreTurn({ message: BENCH_QUERIES[0].message, session_id: sessionId, goal: BENCH_QUERIES[0].message });

    for (const q of BENCH_QUERIES) {
      const t0 = performance.now();
      const result = await MemoryPipeline.runPreTurn({ message: q.message, session_id: sessionId, goal: q.message });
      preTurn.push(performance.now() - t0);
      if (process.env.KNOX_SCALE_DEBUG) console.log("[scale-ms]", q.id, round(performance.now() - t0));

      const injected = (result.context?.items ?? [])
        .filter((i) => i.kind === "semantic")
        .map((i) => idByTitle.get(i.title))
        .filter((k): k is string => Boolean(k));
      expectedTotal += q.expected.length;
      hits += q.expected.filter((k) => injected.includes(k)).length;
      const missing = q.expected.filter((k) => !injected.includes(k));
      if (missing.length) {
        misses.push({ id: q.id, missing, injected });
        if (process.env.KNOX_SCALE_DEBUG) console.log("[scale-miss]", q.id, JSON.stringify(result.context?.items ?? []).slice(0, 1500), result.phases.map((p: any) => `${p.phase}:${p.detail ?? ""}`).join(" | "));
      }

      const t1 = performance.now();
      await searchSemantic(q.message, undefined, 10);
      search.push(performance.now() - t1);

      const t2 = performance.now();
      await searchEpisodic(q.message, sessionId, 10);
      episodic.push(performance.now() - t2);
    }

    preTurn.sort((a, b) => a - b);
    search.sort((a, b) => a - b);
    episodic.sort((a, b) => a - b);
    return {
      episodicSearchP95Ms: round(percentile(episodic, 0.95)),
      items,
      seedMs: Math.round(seedMs),
      dbBytes,
      recallAtK: round(expectedTotal ? hits / expectedTotal : 1, 3),
      preTurnP50Ms: round(percentile(preTurn, 0.5)),
      preTurnP95Ms: round(percentile(preTurn, 0.95)),
      preTurnMaxMs: round(preTurn[preTurn.length - 1] ?? 0),
      searchP50Ms: round(percentile(search, 0.5)),
      searchP95Ms: round(percentile(search, 0.95)),
      searchMaxMs: round(search[search.length - 1] ?? 0),
      misses,
    };
  } finally {
    try {
      const { BrainStore: S } = await import("../brain/BrainStore.js");
      await (S as any).close?.();
    } catch {
      // best effort
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // temp dir cleanup is best effort
    }
  }
}
