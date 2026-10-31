/**
 * MEM-43: theorem numbers for the self-improve report.
 *
 * Rec vs N, ε_S, false-inject, attribution coverage (% of injects with an
 * outcome), recipe wrongApplyRate. Dependency-free so the CLI bundle and
 * tests can import it without opening sqlite.
 */
import {
  formatTheoremErrorsLine,
  readTheoremErrors,
  type TheoremErrorReport,
} from "../bench/errors";

export interface AttributionSample {
  injected: number;
  cited?: number;
  helpful: number | null;
  channel?: string | null;
  score?: number | null;
  mem_type?: string;
  mem_id?: string;
}

export interface AttributionCoverage {
  injected: number;
  withOutcome: number;
  /** withOutcome / injected, or 0 when there were no injects. */
  coverage: number;
}

export interface RecVsNPoint {
  n: number;
  rec: number;
  n_q?: number;
  sigma?: number;
  epsilon_b?: number | null;
  epsilon_s?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** Share of injected memories that later got a helpful / unhelpful outcome. */
export function attributionCoverage(
  rows: readonly Pick<AttributionSample, "injected" | "helpful">[],
): AttributionCoverage {
  let injected = 0;
  let withOutcome = 0;
  for (const row of rows) {
    if (Number(row.injected) !== 1) continue;
    injected += 1;
    if (row.helpful != null) withOutcome += 1;
  }
  return {
    injected,
    withOutcome,
    coverage: injected === 0 ? 0 : withOutcome / injected,
  };
}

export function formatAttributionCoverage(stats: AttributionCoverage): string {
  if (stats.injected === 0) return "n/a (no injects)";
  const pct = Math.round(stats.coverage * 1000) / 10;
  return `${pct}% (${stats.withOutcome}/${stats.injected} injects have an outcome)`;
}

export function readRecVsNPoints(raw: unknown): RecVsNPoint[] {
  const rec = asRecord(raw);
  const list = Array.isArray(raw) ? raw : rec?.points;
  if (!Array.isArray(list)) return [];
  const out: RecVsNPoint[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const n = readFinite(row.n);
    const recall = readFinite(row.rec ?? row.recall ?? row.recallAtK);
    if (n == null || n <= 0 || recall == null) continue;
    const point: RecVsNPoint = { n, rec: recall };
    const nQ = readFinite(row.n_q ?? row.nQ);
    if (nQ != null) point.n_q = nQ;
    const sigma = readFinite(row.sigma);
    if (sigma != null) point.sigma = sigma;
    const epsilonS = readFinite(row.epsilon_s ?? row.epsilonS);
    if (epsilonS != null) point.epsilon_s = epsilonS;
    if (row.epsilon_b === null || row.epsilonB === null) point.epsilon_b = null;
    else {
      const epsilonB = readFinite(row.epsilon_b ?? row.epsilonB);
      if (epsilonB != null) point.epsilon_b = epsilonB;
    }
    out.push(point);
  }
  return out.sort((a, b) => a.n - b.n);
}

export function formatRecVsN(points: readonly RecVsNPoint[]): string {
  if (points.length === 0) return "not published";
  return points.map((p) => `N=${p.n} Rec=${r3(p.rec)}`).join("; ");
}

export interface TheoremReportInput {
  scalePoints?: readonly RecVsNPoint[];
  theorem?: TheoremErrorReport;
  theoremErrors?: unknown;
  falseInjectRate?: number;
  attribution?: AttributionCoverage;
  wrongApplyRate?: number;
}

export function formatTheoremReport(input: TheoremReportInput): string {
  const theorem = input.theorem ?? readTheoremErrors(input.theoremErrors);
  const points = input.scalePoints?.length
    ? input.scalePoints
    : readRecVsNPoints(input.theoremErrors);
  const lines = ["## Theorem", ""];
  lines.push(`- Rec vs N: ${formatRecVsN(points)}`);
  if (theorem) lines.push(`- ${formatTheoremErrorsLine(theorem)}`);
  else lines.push("- σ / ε_B / ε_S: not published");
  lines.push(
    `- false-inject: ${input.falseInjectRate == null ? "not published" : input.falseInjectRate}`,
  );
  lines.push(
    `- attribution coverage: ${
      input.attribution ? formatAttributionCoverage(input.attribution) : "not collected"
    }`,
  );
  lines.push(
    `- recipe wrongApplyRate: ${
      input.wrongApplyRate == null ? "not collected" : input.wrongApplyRate
    }`,
  );
  lines.push("");
  return lines.join("\n");
}
