/**
 * MC-43: project health report. `buildHealthReport` is pure (markdown from collected inputs);
 * `gatherHealthInputs` does the bounded filesystem scan; `writeHealthReport` saves under
 * `<global>/reports/`. Nothing here touches the network: audit status is passed in by the caller.
 */
import fs from "fs";
import path from "path";

import { redactSecrets } from "../../../util/redactSecrets";

export interface AuditSummary {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

export interface TestRun {
  name: string;
  passed: boolean;
  sessionId: string;
}

/** One `git log` commit. This is commit churn, not a workspace / brain checkpoint. */
export interface CommitChurn {
  commitId: string;
  changedPaths: string[];
}

export interface RecipeHealth {
  verified: number;
  candidate: number;
  quarantined: number;
  unlinkedVerified: number;
  wrongReuse: number;
  replays: number;
  /** (failed verify + revert) / replays, or 0 when there were no replays. */
  wrongApplyRate: number;
  skips: number;
  skipReasons: Record<string, number>;
  nearMisses: number;
}

export interface HealthInputs {
  projectName: string;
  generatedAt: string;
  dependencies: { runtime: number; dev: number };
  audit?: AuditSummary;
  testRuns: TestRun[];
  commitChurn: CommitChurn[];
  markers: { file: string; todo: number; fixme: number }[];
  scannedFiles: number;
  scannedLines: number;
  knownIssuesDoc?: string;
  /** Issues observed in history that the known-issues doc does not mention. */
  observedIssues: string[];
  recipes?: RecipeHealth;
}

export interface FlakyTest {
  name: string;
  passes: number;
  failures: number;
  sessions: number;
}

export interface HotFile {
  path: string;
  changes: number;
}

/** A test is flaky when it both passed and failed, and the results span at least two sessions. */
export function findFlakyTests(runs: TestRun[]): FlakyTest[] {
  const by = new Map<string, { passes: number; failures: number; sessions: Set<string> }>();
  for (const r of runs) {
    const e = by.get(r.name) ?? { passes: 0, failures: 0, sessions: new Set<string>() };
    if (r.passed) e.passes++;
    else e.failures++;
    e.sessions.add(r.sessionId);
    by.set(r.name, e);
  }
  return [...by.entries()]
    .filter(([, e]) => e.passes > 0 && e.failures > 0 && e.sessions.size >= 2)
    .map(([name, e]) => ({ name, passes: e.passes, failures: e.failures, sessions: e.sessions.size }))
    .sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name));
}

export function findHotFiles(churn: CommitChurn[], limit = 10): HotFile[] {
  const counts = new Map<string, number>();
  for (const c of churn) {
    for (const p of new Set(c.changedPaths)) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([p, changes]) => ({ path: p, changes }))
    .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** Observed issues whose key words never appear in the known-issues doc. */
export function undocumentedIssues(observed: string[], knownIssuesDoc = ""): string[] {
  const doc = knownIssuesDoc.toLowerCase();
  return observed.filter((o) => {
    const words = o.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    return words.length > 0 && !words.every((w) => doc.includes(w));
  });
}

export function markerDensity(inputs: Pick<HealthInputs, "markers" | "scannedLines">): {
  todo: number;
  fixme: number;
  per1kLines: number;
} {
  const todo = inputs.markers.reduce((n, m) => n + m.todo, 0);
  const fixme = inputs.markers.reduce((n, m) => n + m.fixme, 0);
  const per1kLines = inputs.scannedLines ? Math.round(((todo + fixme) / inputs.scannedLines) * 10000) / 10 : 0;
  return { todo, fixme, per1kLines };
}

export function buildHealthReport(inputs: HealthInputs): string {
  const lines: string[] = [];
  lines.push(`# Project health: ${inputs.projectName}`, "", `Generated ${inputs.generatedAt}. Local only; nothing was sent anywhere.`, "");

  lines.push("## Dependencies", "");
  lines.push(`- Runtime: ${inputs.dependencies.runtime}, dev: ${inputs.dependencies.dev}`);
  if (inputs.audit) {
    const a = inputs.audit;
    lines.push(`- Audit: ${a.critical} critical, ${a.high} high, ${a.moderate} moderate, ${a.low} low`);
  } else {
    lines.push("- Audit: not run (provide `npm audit --json` output to include it)");
  }
  lines.push("");

  const flaky = findFlakyTests(inputs.testRuns);
  lines.push("## Flaky tests", "");
  if (flaky.length === 0) lines.push("None seen across sessions.");
  for (const f of flaky) lines.push(`- \`${f.name}\`: ${f.failures} fail / ${f.passes} pass over ${f.sessions} sessions`);
  lines.push("");

  const hot = findHotFiles(inputs.commitChurn);
  lines.push("## Hot files (commit churn)", "");
  if (hot.length === 0) lines.push("No file changed in more than one commit.");
  for (const h of hot) lines.push(`- \`${h.path}\`: ${h.changes} commits`);
  lines.push("");

  const d = markerDensity(inputs);
  lines.push("## TODO / FIXME density", "");
  lines.push(`- ${d.todo} TODO, ${d.fixme} FIXME in ${inputs.scannedFiles} files (${d.per1kLines} per 1000 lines)`);
  for (const m of [...inputs.markers].sort((a, b) => b.todo + b.fixme - (a.todo + a.fixme) || a.file.localeCompare(b.file)).slice(0, 5)) {
    lines.push(`- \`${m.file}\`: ${m.todo} TODO, ${m.fixme} FIXME`);
  }
  lines.push("");

  const undoc = undocumentedIssues(inputs.observedIssues, inputs.knownIssuesDoc);
  lines.push("## Undocumented known issues", "");
  if (undoc.length === 0) lines.push("Every observed issue is covered by `docs/known-issues.md`.");
  for (const u of undoc) lines.push(`- ${u}`);
  lines.push("");

  lines.push("## Recipes", "");
  if (!inputs.recipes) {
    lines.push("Not collected (pass recipe stats from Memory Brain to include them).");
  } else {
    const r = inputs.recipes;
    lines.push(`- Verified: ${r.verified}, candidate: ${r.candidate}, quarantined: ${r.quarantined}`);
    lines.push(`- Unlinked verified (no workflow memory): ${r.unlinkedVerified}`);
    lines.push(`- Replays: ${r.replays}, wrong-reuse (failed verify + revert): ${r.wrongReuse}, wrongApplyRate ${r.wrongApplyRate}`);
    lines.push(`- Capture skips: ${r.skips}${formatSkipReasons(r.skipReasons)}`);
    lines.push(`- Matcher near-misses: ${r.nearMisses}`);
  }
  lines.push("");

  return redactSecrets(lines.join("\n"));
}

function formatSkipReasons(reasons: Record<string, number>): string {
  const parts = Object.entries(reasons)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k} ${n}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export function gatherRecipeHealth(
  recipes: readonly {
    status: string;
    memoryId?: number;
    stats: { replays: number; reverted: number; failedVerify: number };
  }[],
  extra: { skips?: number; skipReasons?: Record<string, number>; nearMisses?: number; wrongApplyRate?: number } = {},
): RecipeHealth {
  let verified = 0;
  let candidate = 0;
  let quarantined = 0;
  let unlinkedVerified = 0;
  let wrongReuse = 0;
  let replays = 0;
  for (const r of recipes) {
    if (r.status === "verified") {
      verified++;
      if (r.memoryId == null) unlinkedVerified++;
    } else if (r.status === "candidate") candidate++;
    else if (r.status === "quarantined") quarantined++;
    replays += r.stats.replays;
    wrongReuse += r.stats.reverted + r.stats.failedVerify;
  }
  return {
    verified,
    candidate,
    quarantined,
    unlinkedVerified,
    wrongReuse,
    replays,
    wrongApplyRate:
      extra.wrongApplyRate ?? (replays === 0 ? 0 : Math.min(1, wrongReuse / replays)),
    skips: extra.skips ?? 0,
    skipReasons: extra.skipReasons ?? {},
    nearMisses: extra.nearMisses ?? 0,
  };
}

const SKIP_DIRS = new Set(["node_modules", ".git", "out", "dist", "build", "target", ".next"]);
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|c|h|cpp|java|md)$/i;

export interface ScanLimits {
  maxFiles: number;
  maxFileBytes: number;
}

/** Bounded walk: stops at `maxFiles`, skips big files and vendor dirs. No symlink following. */
export function scanMarkers(
  root: string,
  limits: ScanLimits = { maxFiles: 5000, maxFileBytes: 512 * 1024 },
): Pick<HealthInputs, "markers" | "scannedFiles" | "scannedLines"> {
  const markers: HealthInputs["markers"] = [];
  let scannedFiles = 0;
  let scannedLines = 0;
  const stack = [root];
  while (stack.length && scannedFiles < limits.maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (scannedFiles >= limits.maxFiles) break;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile() || !SOURCE_RE.test(e.name)) continue;
      try {
        if (fs.statSync(full).size > limits.maxFileBytes) continue;
        const text = fs.readFileSync(full, "utf8");
        scannedFiles++;
        scannedLines += text.split("\n").length;
        const todo = (text.match(/\bTODO\b/g) ?? []).length;
        const fixme = (text.match(/\bFIXME\b/g) ?? []).length;
        if (todo + fixme > 0) markers.push({ file: path.relative(root, full).split(path.sep).join("/"), todo, fixme });
      } catch {
        // unreadable file: skip
      }
    }
  }
  return { markers, scannedFiles, scannedLines };
}

export function gatherHealthInputs(
  root: string,
  extra: Partial<Pick<HealthInputs, "audit" | "testRuns" | "commitChurn" | "observedIssues" | "generatedAt" | "recipes">> = {},
): HealthInputs {
  let pkg: { name?: string; dependencies?: object; devDependencies?: object } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    // not a node project
  }
  let knownIssuesDoc: string | undefined;
  try {
    knownIssuesDoc = fs.readFileSync(path.join(root, "docs", "known-issues.md"), "utf8");
  } catch {
    // optional
  }
  return {
    projectName: pkg.name ?? path.basename(root),
    generatedAt: extra.generatedAt ?? new Date().toISOString(),
    dependencies: { runtime: Object.keys(pkg.dependencies ?? {}).length, dev: Object.keys(pkg.devDependencies ?? {}).length },
    audit: extra.audit,
    testRuns: extra.testRuns ?? [],
    commitChurn: extra.commitChurn ?? [],
    observedIssues: extra.observedIssues ?? [],
    knownIssuesDoc,
    ...(extra.recipes ? { recipes: extra.recipes } : {}),
    ...scanMarkers(root),
  };
}

/** Parses `npm audit --json` (v7+ `metadata.vulnerabilities`). */
export function parseNpmAudit(json: string): AuditSummary | undefined {
  try {
    const v = JSON.parse(json)?.metadata?.vulnerabilities;
    if (!v) return undefined;
    return { critical: v.critical ?? 0, high: v.high ?? 0, moderate: v.moderate ?? 0, low: v.low ?? 0 };
  } catch {
    return undefined;
  }
}

export function writeHealthReport(markdown: string, reportsDir: string, projectName: string, now = new Date()): string {
  fs.mkdirSync(reportsDir, { recursive: true });
  const safe = projectName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "project";
  const file = path.join(reportsDir, `health-${safe}-${now.toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(file, markdown);
  return file;
}
