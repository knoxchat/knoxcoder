/**
 * MC-48 / MEM-43: point the health analysis and threshold sweep at the Knox
 * repo itself and write findings to `docs/self-improve/`.
 *
 * The report leads with the theorem (Rec vs N, ε_S, false-inject, attribution
 * coverage, recipe wrongApplyRate). `git log` churn is labeled commitChurn,
 * not a workspace / brain checkpoint. `proposeThresholds` fits θ and w_s from
 * `brain_attribution` when a brain sqlite or `--history` dump is supplied.
 *
 * Manual only: `npm run mc:self-improve`. Local only: no network, no `gh`, no issue is opened.
 * The output is a draft for a maintainer to read; it changes nothing but its own file.
 */
import fs from "fs";
import path from "path";

import { redactSecrets } from "../../../util/redactSecrets";
import { loadTheoremErrors, type TheoremErrorReport } from "../bench/errors";
import { loadAttributionFromBrain } from "./attributionLoad";
import {
  attributionCoverage,
  formatTheoremReport,
  readRecVsNPoints,
  type AttributionSample,
  type RecVsNPoint,
} from "./attributionStats";
import {
  buildHealthReport,
  gatherRecipeHealth,
  scanMarkers,
  type CommitChurn,
  type HealthInputs,
  type RecipeHealth,
} from "./healthReport";
import { loadRecipeHealthFromBrain } from "./recipeHealthLoad";
import {
  formatTuningReport,
  proposeThresholds,
  type AttributionRefitInput,
  type RelevanceSample,
  type ReplaySample,
  type TuningHistory,
} from "./thresholdTuning";

export interface SelfAnalysisHistory extends TuningHistory {
  relevance?: RelevanceSample[];
  replays?: ReplaySample[];
  attribution?: AttributionSample[];
  current?: AttributionRefitInput;
}

export interface SelfAnalysisOptions {
  /** Repository root (contains `.git`). */
  repoRoot: string;
  /** Directories under `repoRoot` that make up "Knox itself". */
  scanDirs: string[];
  /** Package whose `package.json` and `docs/known-issues.md` describe the project. */
  packageDir: string;
  /** Output directory, usually `<packageDir>/docs/self-improve`. */
  outDir: string;
  /** `git log` output (`--name-only --pretty=format:@@%h`) supplied by the caller. */
  gitLog: string;
  history?: SelfAnalysisHistory;
  baseline?: {
    recallAtK: number;
    precision: number;
    falseInjectRate: number;
    tokensMean: number;
    sigma?: number;
    epsilon_b?: number | null;
    epsilon_b_note?: string;
    epsilon_s?: number;
    theorem_held?: boolean;
  };
  /** Scale-bench sibling of baseline.json (MEM-42). Preferred for ε_B and Rec vs N. */
  theoremErrors?: TheoremErrorReport | Record<string, unknown>;
  /** Rec vs N points when they are not already on `theoremErrors`. */
  recallScale?: { points?: RecVsNPoint[] } | Record<string, unknown>;
  now?: Date;
  /** Pre-gathered recipe stats. Takes precedence over `brainSqlitePath`. */
  recipes?: RecipeHealth;
  /** Live Memory Brain sqlite. Loaded only when `recipes` / history attribution is omitted. */
  brainSqlitePath?: string;
  /** Checkpoint `events.jsonl` for capture-skip / near-miss extras. */
  auditEventsPath?: string;
}

export { gatherRecipeHealth, loadRecipeHealthFromBrain };

/** One git commit is one commitChurn entry, limited to `prefixes`. */
export function parseGitLog(output: string, prefixes: readonly string[]): CommitChurn[] {
  const out: CommitChurn[] = [];
  let current: CommitChurn | undefined;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("@@")) {
      current = { commitId: line.slice(2), changedPaths: [] };
      out.push(current);
    } else if (current && prefixes.some((p) => line.startsWith(p)) && !/(^|\/)package-lock\.json$/.test(line)) {
      current.changedPaths.push(line);
    }
  }
  return out.filter((c) => c.changedPaths.length > 0);
}

function hasTuningHistory(history: SelfAnalysisHistory | undefined): history is SelfAnalysisHistory {
  if (!history) return false;
  return Boolean(
    history.relevance?.length ||
      history.replays?.length ||
      history.attribution?.length,
  );
}

export function buildSelfAnalysisReport(
  health: HealthInputs,
  extras: Pick<SelfAnalysisOptions, "history" | "baseline" | "theoremErrors" | "recallScale">,
): string {
  const theorem = loadTheoremErrors({
    baseline: extras.baseline,
    theoremErrors: extras.theoremErrors,
  });
  const scalePoints = [
    ...readRecVsNPoints(extras.recallScale),
    ...readRecVsNPoints(extras.theoremErrors),
  ].filter((point, i, all) => all.findIndex((other) => other.n === point.n) === i);
  const coverage = extras.history?.attribution
    ? attributionCoverage(extras.history.attribution)
    : undefined;

  const healthMd = buildHealthReport(health).trimEnd();
  const introMatch = healthMd.match(/^# [^\n]+\n\nGenerated [^\n]+\n/);
  const intro = introMatch?.[0]?.trimEnd() ?? `# Project health: ${health.projectName}\n\nGenerated ${health.generatedAt}. Local only; nothing was sent anywhere.`;
  const rest = (introMatch ? healthMd.slice(introMatch[0].length) : healthMd).replace(/^\n+/, "");
  const parts = [
    intro,
    "",
    formatTheoremReport({
      scalePoints,
      theorem,
      theoremErrors: extras.theoremErrors,
      falseInjectRate: extras.baseline?.falseInjectRate,
      attribution: coverage,
      wrongApplyRate: health.recipes?.wrongApplyRate,
    }).trimEnd(),
    "",
    rest,
    "",
    "## Memory bench baseline",
    "",
  ];
  if (extras.baseline) {
    const b = extras.baseline;
    parts.push(`- recallAtK ${b.recallAtK}, precision ${b.precision}, falseInjectRate ${b.falseInjectRate}, tokensMean ${b.tokensMean}`);
  } else {
    parts.push("- No baseline supplied.");
  }
  parts.push("");
  parts.push("## Threshold tuning", "");
  if (hasTuningHistory(extras.history)) {
    parts.push(formatTuningReport(proposeThresholds(extras.history), health.generatedAt).replace(/^# .*\n+/, ""));
  } else {
    parts.push("No recorded history or brain_attribution log was supplied, so no threshold proposal was made. Pass `--history <file.json>` with `{ relevance, replays, attribution }` or a live `--brain` sqlite.");
  }
  parts.push("", "## Next steps", "", "- Read the theorem numbers, hot files, and flaky tests above; open issues by hand if they are real.", "- Nothing in this file was sent anywhere.", "");
  return redactSecrets(parts.join("\n"));
}

/** Gathers inputs, writes `<outDir>/<date>-self-improve.md`, returns its path. */
export async function runSelfAnalysis(options: SelfAnalysisOptions): Promise<string> {
  const now = options.now ?? new Date();
  const prefixes = options.scanDirs.map((d) => d.replace(/\\/g, "/").replace(/\/?$/, "/"));

  const markers: HealthInputs["markers"] = [];
  let scannedFiles = 0;
  let scannedLines = 0;
  for (const dir of options.scanDirs) {
    const scan = scanMarkers(path.join(options.repoRoot, dir));
    for (const m of scan.markers) markers.push({ ...m, file: `${dir.replace(/\/$/, "")}/${m.file}` });
    scannedFiles += scan.scannedFiles;
    scannedLines += scan.scannedLines;
  }

  let pkg: { name?: string; dependencies?: object; devDependencies?: object } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(options.packageDir, "package.json"), "utf8"));
  } catch {
    // keep defaults
  }
  let knownIssuesDoc: string | undefined;
  try {
    knownIssuesDoc = fs.readFileSync(path.join(options.packageDir, "docs", "known-issues.md"), "utf8");
  } catch {
    // optional
  }

  const recipes =
    options.recipes ??
    (options.brainSqlitePath
      ? await loadRecipeHealthFromBrain(options.brainSqlitePath, options.auditEventsPath)
      : undefined);

  const loadedAttribution =
    options.history?.attribution != null
      ? undefined
      : options.brainSqlitePath
        ? await loadAttributionFromBrain(options.brainSqlitePath)
        : undefined;

  const history: SelfAnalysisHistory | undefined = (() => {
    const relevance = options.history?.relevance;
    const replays = options.history?.replays;
    const attribution = options.history?.attribution ?? loadedAttribution?.rows;
    const current = options.history?.current ?? loadedAttribution?.current;
    if (!relevance?.length && !replays?.length && !attribution?.length) return undefined;
    return { relevance, replays, attribution, current };
  })();

  const health: HealthInputs = {
    projectName: pkg.name ?? path.basename(options.repoRoot),
    generatedAt: now.toISOString(),
    dependencies: { runtime: Object.keys(pkg.dependencies ?? {}).length, dev: Object.keys(pkg.devDependencies ?? {}).length },
    testRuns: [],
    commitChurn: parseGitLog(options.gitLog, prefixes),
    markers,
    scannedFiles,
    scannedLines,
    knownIssuesDoc,
    observedIssues: [],
    ...(recipes ? { recipes } : {}),
  };

  fs.mkdirSync(options.outDir, { recursive: true });
  const file = path.join(options.outDir, `${now.toISOString().slice(0, 10)}-self-improve.md`);
  fs.writeFileSync(file, buildSelfAnalysisReport(health, {
    history,
    baseline: options.baseline,
    theoremErrors: options.theoremErrors,
    recallScale: options.recallScale,
  }));
  return file;
}
