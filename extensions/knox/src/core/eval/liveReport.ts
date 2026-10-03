/** Aggregation and gate for the live-model comparison (K-010). */

export type LivePath = "loop" | "chatTurn";

export interface LiveRun {
  taskId: string;
  path: LivePath;
  pass: boolean;
  reason?: string;
  stoppedReason: string;
  steps: number;
  promptTokens: number;
  completionTokens: number;
  ms: number;
}

export interface PathSummary {
  runs: number;
  passes: number;
  passRate: number;
  avgSteps: number;
  avgTokens: number;
}

export function summarize(runs: LiveRun[]): PathSummary {
  const n = runs.length || 1;
  const passes = runs.filter((r) => r.pass).length;
  return {
    runs: runs.length,
    passes,
    passRate: runs.length ? passes / runs.length : 0,
    avgSteps: runs.reduce((a, r) => a + r.steps, 0) / n,
    avgTokens:
      runs.reduce((a, r) => a + r.promptTokens + r.completionTokens, 0) / n,
  };
}

export interface ParityVerdict {
  ok: boolean;
  loop: PathSummary;
  chatTurn: PathSummary;
  /** Tasks where the chat-turn path passed fewer runs than the loop. */
  regressions: { taskId: string; loop: number; chatTurn: number }[];
  /** Total pass-count drop allowed before the gate fails (default 1). */
  allowedDrop: number;
}

export function compareParity(
  runs: LiveRun[],
  allowedDrop = 1,
): ParityVerdict {
  const loop = runs.filter((r) => r.path === "loop");
  const chat = runs.filter((r) => r.path === "chatTurn");
  const regressions: ParityVerdict["regressions"] = [];
  for (const id of new Set(runs.map((r) => r.taskId))) {
    const a = loop.filter((r) => r.taskId === id && r.pass).length;
    const b = chat.filter((r) => r.taskId === id && r.pass).length;
    if (b < a) {
      regressions.push({ taskId: id, loop: a, chatTurn: b });
    }
  }
  const sl = summarize(loop);
  const sc = summarize(chat);
  return {
    ok: sl.passes - sc.passes <= allowedDrop,
    loop: sl,
    chatTurn: sc,
    regressions,
    allowedDrop,
  };
}

export function renderReport(runs: LiveRun[], verdict: ParityVerdict): string {
  const lines = ["task | loop | chatTurn"];
  for (const id of [...new Set(runs.map((r) => r.taskId))]) {
    const cell = (p: LivePath) => {
      const rs = runs.filter((r) => r.taskId === id && r.path === p);
      return `${rs.filter((r) => r.pass).length}/${rs.length}`;
    };
    lines.push(`${id} | ${cell("loop")} | ${cell("chatTurn")}`);
  }
  const f = (s: PathSummary) =>
    `${s.passes}/${s.runs} pass, ${s.avgSteps.toFixed(1)} steps, ${Math.round(s.avgTokens)} tok/run`;
  lines.push("", `loop:     ${f(verdict.loop)}`, `chatTurn: ${f(verdict.chatTurn)}`);
  lines.push(`gate (drop <= ${verdict.allowedDrop}): ${verdict.ok ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}

// ---- trend tracking (K-053) ----------------------------------------------

/** One line of `eval/results/history.jsonl`: a model's result on one date. */
export interface HistoryEntry {
  date: string;
  model: string;
  /** "full" or "defer" catalog variant. */
  variant: string;
  passRate: number;
  avgSteps: number;
  avgTokens: number;
  /** USD for the whole run, or null when the model's price is unknown. */
  costUsd: number | null;
  perTask: Record<string, number>;
}

export function toHistoryEntry(
  runs: LiveRun[],
  meta: { date: string; model: string; variant: string; costUsd: number | null },
): HistoryEntry {
  const s = summarize(runs);
  const perTask: Record<string, number> = {};
  for (const id of new Set(runs.map((r) => r.taskId))) {
    const rs = runs.filter((r) => r.taskId === id);
    perTask[id] = rs.filter((r) => r.pass).length / rs.length;
  }
  return {
    ...meta,
    passRate: s.passRate,
    avgSteps: s.avgSteps,
    avgTokens: s.avgTokens,
    perTask,
  };
}

export interface TrendVerdict {
  ok: boolean;
  /** Tasks whose pass rate fell by more than `tolerance` against the previous entry. */
  regressed: { taskId: string; from: number; to: number }[];
  tokenGrowth: number | null;
}

/** Compare against the most recent earlier entry for the same model + variant. */
export function checkTrend(
  history: HistoryEntry[],
  latest: HistoryEntry,
  tolerance = 0.34,
  maxTokenGrowth = 0.5,
): TrendVerdict {
  const prev = [...history]
    .reverse()
    .find((h) => h.model === latest.model && h.variant === latest.variant);
  if (!prev) {
    return { ok: true, regressed: [], tokenGrowth: null };
  }
  const regressed = Object.entries(latest.perTask)
    .filter(([id, rate]) => (prev.perTask[id] ?? rate) - rate > tolerance)
    .map(([taskId, to]) => ({ taskId, from: prev.perTask[taskId], to }));
  const tokenGrowth = prev.avgTokens
    ? latest.avgTokens / prev.avgTokens - 1
    : null;
  return {
    ok: regressed.length === 0 && (tokenGrowth ?? 0) <= maxTokenGrowth,
    regressed,
    tokenGrowth,
  };
}

export function parseHistory(text: string): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as HistoryEntry);
    } catch {
      // skip a damaged line; history is append-only
    }
  }
  return out;
}
