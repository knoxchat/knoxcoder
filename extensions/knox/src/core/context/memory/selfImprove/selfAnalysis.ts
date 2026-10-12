/**
 * MC-48: point the MC-43 health analysis (and, when history is supplied, the MC-47 threshold sweep)
 * at the Knox repo itself and write findings to `docs/self-improve/`.
 *
 * Manual only: `npm run mc:self-improve`. Local only: no network, no `gh`, no issue is opened.
 * The output is a draft for a maintainer to read; it changes nothing but its own file.
 */
import fs from "fs";
import path from "path";

import { redactSecrets } from "../../../util/redactSecrets";
import {
  buildHealthReport,
  scanMarkers,
  type CheckpointChange,
  type HealthInputs,
} from "./healthReport";
import {
  formatTuningReport,
  proposeThresholds,
  type RelevanceSample,
  type ReplaySample,
} from "./thresholdTuning";

export interface SelfAnalysisHistory {
  relevance: RelevanceSample[];
  replays: ReplaySample[];
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
  baseline?: { recallAtK: number; precision: number; falseInjectRate: number; tokensMean: number };
  now?: Date;
}

/** One commit is one "checkpoint" of churn, limited to `prefixes`. */
export function parseGitLog(output: string, prefixes: readonly string[]): CheckpointChange[] {
  const out: CheckpointChange[] = [];
  let current: CheckpointChange | undefined;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("@@")) {
      current = { checkpointId: line.slice(2), changedPaths: [] };
      out.push(current);
    } else if (current && prefixes.some((p) => line.startsWith(p)) && !/(^|\/)package-lock\.json$/.test(line)) {
      current.changedPaths.push(line);
    }
  }
  return out.filter((c) => c.changedPaths.length > 0);
}

export function buildSelfAnalysisReport(
  health: HealthInputs,
  extras: Pick<SelfAnalysisOptions, "history" | "baseline">,
): string {
  const parts = [buildHealthReport(health).trimEnd(), ""];
  parts.push("## Memory bench baseline", "");
  if (extras.baseline) {
    const b = extras.baseline;
    parts.push(`- recallAtK ${b.recallAtK}, precision ${b.precision}, falseInjectRate ${b.falseInjectRate}, tokensMean ${b.tokensMean}`);
  } else {
    parts.push("- No baseline supplied.");
  }
  parts.push("");
  parts.push("## Threshold tuning", "");
  if (extras.history) {
    parts.push(formatTuningReport(proposeThresholds(extras.history), health.generatedAt).replace(/^# .*\n+/, ""));
  } else {
    parts.push("No recorded history was supplied, so no threshold proposal was made. Pass `--history <file.json>` with `{ relevance, replays }` samples.");
  }
  parts.push("", "## Next steps", "", "- Read the hot files and flaky tests above; open issues by hand if they are real.", "- Nothing in this file was sent anywhere.", "");
  return redactSecrets(parts.join("\n"));
}

/** Gathers inputs, writes `<outDir>/<date>-self-improve.md`, returns its path. */
export function runSelfAnalysis(options: SelfAnalysisOptions): string {
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

  const health: HealthInputs = {
    projectName: pkg.name ?? path.basename(options.repoRoot),
    generatedAt: now.toISOString(),
    dependencies: { runtime: Object.keys(pkg.dependencies ?? {}).length, dev: Object.keys(pkg.devDependencies ?? {}).length },
    testRuns: [],
    checkpoints: parseGitLog(options.gitLog, prefixes),
    markers,
    scannedFiles,
    scannedLines,
    knownIssuesDoc,
    observedIssues: [],
  };

  fs.mkdirSync(options.outDir, { recursive: true });
  const file = path.join(options.outDir, `${now.toISOString().slice(0, 10)}-self-improve.md`);
  fs.writeFileSync(file, buildSelfAnalysisReport(health, options));
  return file;
}
