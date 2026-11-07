/**
 * MEM-79: answer accuracy bench. Seeds each case's memories, runs pre-turn,
 * and grades retrieved context against the gold answer lexically.
 *
 * Datasets are never vendored. Without KNOX_*_PATH the synthetic fixture
 * still runs so CI has a number. Gate: no regression vs accuracy/baseline.json.
 */
import fs from "fs";
import os from "os";
import path from "path";

import type { AccuracySummary } from "../gate.js";
import { loadAccuracyCases, type AccuracyCase } from "./adapters.js";
import { lexicalGrade, meanScore } from "./grader.js";

export interface AccuracyCaseResult {
  id: string;
  suite: AccuracyCase["suite"];
  score: number;
  method: string;
}

export interface AccuracyBenchReport extends AccuracySummary {
  cases: AccuracyCaseResult[];
  seedMs: number;
}

export const ACCURACY_BASELINE_FILENAME = "baseline.json";

export function accuracyBaselinePath(): string {
  return path.join(__dirname, ACCURACY_BASELINE_FILENAME);
}

export function loadAccuracyBaseline(filePath = accuracyBaselinePath()): AccuracySummary | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as AccuracySummary;
    if (!Number.isFinite(raw.overall)) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export async function runAccuracyBench(
  cases?: AccuracyCase[],
): Promise<AccuracyBenchReport> {
  const loaded = cases ? { cases, skipped: [] as string[] } : loadAccuracyCases();
  const dir = path.join(os.tmpdir(), `brain-accuracy-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  const prevGlobal = process.env.KNOX_GLOBAL_DIR;
  process.env.KNOX_GLOBAL_DIR = dir;

  const { close } = await import("../../brain/store/connection.js");
  await close();
  const { BrainManager } = await import("../../brain/BrainManager.js");
  const { BrainStore } = await import("../../brain/BrainStore.js");
  const { MemoryPipeline } = await import("../../brain/MemoryPipeline.js");

  const seedStart = performance.now();
  const results: AccuracyCaseResult[] = [];
  try {
    await BrainStore.get();
    await BrainStore.saveConfig("auto_extract_enabled", "false");
    await BrainStore.saveConfig("enable_knowledge_extraction", "false");
    const sessionId = "accuracy-bench";
    await BrainManager.trackSession(sessionId, "Accuracy bench", dir);

    const bySuite = new Map<string, number[]>();
    for (const item of loaded.cases) {
      const db = await BrainStore.get();
      await db.exec("DELETE FROM brain_semantic");
      await db.exec("DELETE FROM brain_summary_tree");
      for (const memory of item.memories) {
        await BrainManager.store({
          category: "fact",
          title: memory.title,
          content: memory.content,
          keywords: memory.keywords ?? "",
          session_id: sessionId,
          importance: 0.8,
        });
      }
      const result = await MemoryPipeline.runPreTurn({
        message: item.question,
        session_id: sessionId,
        goal: item.question,
      });
      const context = result.context?.context ?? "";
      const grade = lexicalGrade(context, item.answer);
      results.push({ id: item.id, suite: item.suite, score: grade.score, method: grade.method });
      const bucket = bySuite.get(item.suite) ?? [];
      bucket.push(grade.score);
      bySuite.set(item.suite, bucket);
    }

    const overall = meanScore(results.map((r) => r.score));
    return {
      longmemeval: bySuite.has("longmemeval") ? meanScore(bySuite.get("longmemeval")!) : undefined,
      locomo: bySuite.has("locomo") ? meanScore(bySuite.get("locomo")!) : undefined,
      heldOut: bySuite.has("heldout") ? meanScore(bySuite.get("heldout")!) : undefined,
      overall,
      skipped: loaded.skipped,
      cases: results,
      seedMs: Math.round(performance.now() - seedStart),
    };
  } finally {
    try {
      await close();
    } catch {
      // best effort
    }
    if (prevGlobal === undefined) delete process.env.KNOX_GLOBAL_DIR;
    else process.env.KNOX_GLOBAL_DIR = prevGlobal;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // temp dir cleanup is best effort
    }
  }
}
