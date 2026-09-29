/**
 * Language-agnostic unit-test support for `builtin_build action:"test"`.
 *
 * - detect the project's test runner (cargo, vitest/jest/mocha/node:test,
 *   pytest/unittest, go test) from workspace files,
 * - compose a non-interactive command (never watch mode),
 * - parse the output into counts + failing tests so the model reads
 *   "2 failed: foo > adds" instead of scrolling a raw log.
 */

import { stripAnsi } from "./parseDiagnostics";
import {
  composeCargoActionCommand,
} from "./verifyCommand";

export type TestRunnerKind =
  | "cargo"
  | "vitest"
  | "jest"
  | "mocha"
  | "node-test"
  | "node-script"
  | "pytest"
  | "unittest"
  | "go";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface DetectedTestRunner {
  kind: TestRunnerKind;
  /** Human label, e.g. "vitest (pnpm)". */
  label: string;
  /** Binary that must be on PATH. */
  binary: string;
  /** Non-interactive base command (no target / filter yet). */
  base: string;
  /** Flag that selects tests by name, when the runner has one. */
  filterFlag?: string;
  /** How extra args are separated from the base (`--` for npm scripts). */
  argSeparator?: string;
  /** True when `base` is `<pm> test` (project script) rather than a direct runner. */
  viaScript?: boolean;
  packageManager?: PackageManager;
}

export interface WorkspaceFacts {
  /** Top-level entry names of the project directory. */
  entries: string[];
  /** Read a top-level text file; undefined when missing. */
  readText(name: string): Promise<string | undefined>;
}

const posix = () => process.platform !== "win32";

function has(entries: Set<string>, ...names: string[]): boolean {
  return names.some((name) => entries.has(name));
}

/* ------------------------------------------------------------------ */
/* Detection                                                          */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_SCRIPT = /no test specified/i;
const WATCH_SCRIPT = /(?:^|\s)(?:--watch\b|--watchAll\b|-w\b)|\bwatch\b/;

function detectPackageManager(
  entries: Set<string>,
  pkg: Record<string, unknown>,
): PackageManager {
  const field =
    typeof pkg.packageManager === "string" ? pkg.packageManager : "";
  const named = field.match(/^(npm|pnpm|yarn|bun)@/)?.[1] as
    | PackageManager
    | undefined;
  if (named) {
    return named;
  }
  if (has(entries, "pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (has(entries, "yarn.lock")) {
    return "yarn";
  }
  if (has(entries, "bun.lockb", "bun.lock")) {
    return "bun";
  }
  return "npm";
}

function execPrefix(pm: PackageManager): string {
  switch (pm) {
    case "pnpm":
      return "pnpm exec";
    case "yarn":
      return "yarn";
    case "bun":
      return "bunx";
    default:
      return "npx --no-install";
  }
}

function scriptCommand(pm: PackageManager): { base: string; sep?: string } {
  switch (pm) {
    case "pnpm":
      return { base: "pnpm run test" };
    case "yarn":
      return { base: "yarn test" };
    case "bun":
      return { base: "bun run test" };
    default:
      return { base: "npm test", sep: "--" };
  }
}

type NodeFramework = "vitest" | "jest" | "mocha" | "node-test";

function frameworkFromScript(script: string): NodeFramework | undefined {
  if (/\bvitest\b/.test(script)) {
    return "vitest";
  }
  if (/\bjest\b/.test(script)) {
    return "jest";
  }
  if (/\bmocha\b/.test(script)) {
    return "mocha";
  }
  if (/\bnode\b[^&|;]*--test\b/.test(script)) {
    return "node-test";
  }
  return undefined;
}

const NODE_FILTER_FLAG: Record<NodeFramework, string> = {
  vitest: "-t",
  jest: "-t",
  mocha: "--grep",
  "node-test": "--test-name-pattern",
};

function detectNode(
  entries: Set<string>,
  packageJson: string | undefined,
): DetectedTestRunner | undefined {
  if (!packageJson) {
    return undefined;
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(packageJson) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
  const script = typeof scripts.test === "string" ? scripts.test.trim() : "";
  const realScript = script !== "" && !PLACEHOLDER_SCRIPT.test(script);
  const deps = {
    ...((pkg.dependencies ?? {}) as Record<string, unknown>),
    ...((pkg.devDependencies ?? {}) as Record<string, unknown>),
  };
  const framework: NodeFramework | undefined =
    (realScript ? frameworkFromScript(script) : undefined) ??
    (deps.vitest
      ? "vitest"
      : deps.jest
        ? "jest"
        : deps.mocha
          ? "mocha"
          : undefined);
  if (!realScript && !framework) {
    return undefined;
  }

  const pm = detectPackageManager(entries, pkg);
  const viaScript = realScript && !WATCH_SCRIPT.test(script);
  const ci = posix() ? "CI=1 " : "";

  if (viaScript) {
    const { base, sep } = scriptCommand(pm);
    return {
      kind: framework ?? "node-script",
      label: `${framework ?? "npm test script"} (${pm})`,
      binary: pm,
      base: `${ci}${base}`,
      filterFlag: framework ? NODE_FILTER_FLAG[framework] : undefined,
      argSeparator: sep,
      viaScript: true,
      packageManager: pm,
    };
  }

  // No usable script (or it watches): call the runner directly, run-once.
  const fw: NodeFramework = framework ?? "vitest";
  const exec = execPrefix(pm);
  const direct: Record<NodeFramework, string> = {
    vitest: `${exec} vitest run`,
    jest: `${exec} jest --ci`,
    mocha: `${exec} mocha`,
    "node-test": "node --test",
  };
  return {
    kind: fw,
    label: `${fw} (${fw === "node-test" ? "node" : pm})`,
    binary: fw === "node-test" ? "node" : pm === "npm" ? "npx" : pm === "bun" ? "bunx" : pm,
    base: `${ci}${direct[fw]}`,
    filterFlag: NODE_FILTER_FLAG[fw],
    packageManager: pm,
  };
}

function detectPython(
  entries: Set<string>,
  texts: { pyproject?: string; requirements?: string },
): DetectedTestRunner | undefined {
  const py = posix() ? "python3" : "python";
  const pytestConfigured =
    has(entries, "pytest.ini", "conftest.py") ||
    /\[tool\.pytest|pytest/.test(texts.pyproject ?? "") ||
    /^\s*pytest\b/m.test(texts.requirements ?? "");
  const hasTests =
    has(entries, "tests", "test") ||
    [...entries].some((name) => /^test_.*\.py$|.*_test\.py$/.test(name));
  const isPython =
    has(
      entries,
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "tox.ini",
      "pytest.ini",
      "conftest.py",
    ) ||
    hasTests;
  if (!isPython) {
    return undefined;
  }
  if (pytestConfigured || (has(entries, "tox.ini", "setup.cfg") && hasTests)) {
    const prefix = has(entries, "uv.lock")
      ? "uv run"
      : has(entries, "poetry.lock")
        ? "poetry run"
        : `${py} -m`;
    return {
      kind: "pytest",
      label: "pytest",
      binary: prefix.split(" ")[0] === py ? py : prefix.split(" ")[0],
      base: `${prefix} pytest -q --color=no`,
      filterFlag: "-k",
    };
  }
  if (hasTests) {
    return {
      kind: "unittest",
      label: "unittest",
      binary: py,
      base: `${py} -m unittest`,
      filterFlag: "-k",
    };
  }
  return undefined;
}

/**
 * Runners this project supports, best first. Cargo wins over Node so a Rust
 * repo with a tooling package.json still tests with cargo.
 */
export async function detectTestRunners(
  facts: WorkspaceFacts,
): Promise<DetectedTestRunner[]> {
  const entries = new Set(facts.entries);
  const out: DetectedTestRunner[] = [];

  if (entries.has("Cargo.toml")) {
    out.push({
      kind: "cargo",
      label: "cargo test",
      binary: "cargo",
      base: "cargo test",
    });
  }
  const node = detectNode(entries, entries.has("package.json") ? await facts.readText("package.json") : undefined);
  if (node) {
    out.push(node);
  }
  const python = detectPython(entries, {
    pyproject: entries.has("pyproject.toml") ? await facts.readText("pyproject.toml") : undefined,
    requirements: entries.has("requirements.txt") ? await facts.readText("requirements.txt") : undefined,
  });
  if (python) {
    out.push(python);
  }
  if (entries.has("go.mod")) {
    out.push({
      kind: "go",
      label: "go test",
      binary: "go",
      base: "go test",
      filterFlag: "-run",
    });
  }
  return out;
}

/** Prefer the runner that matches the file / package the model asked about. */
export function pickTestRunner(
  runners: DetectedTestRunner[],
  target?: string,
): DetectedTestRunner | undefined {
  const t = (target ?? "").trim().toLowerCase().split("::")[0];
  const byKind = (...kinds: TestRunnerKind[]) =>
    runners.find((r) => kinds.includes(r.kind));
  if (/\.rs$/.test(t)) {
    return byKind("cargo") ?? runners[0];
  }
  if (/\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(t)) {
    return (
      byKind("vitest", "jest", "mocha", "node-test", "node-script") ?? runners[0]
    );
  }
  if (/\.py$/.test(t)) {
    return byKind("pytest", "unittest") ?? runners[0];
  }
  if (/\.go$/.test(t) || (/^\.\/[\w./-]*$/.test(t) && byKind("go"))) {
    return byKind("go") ?? runners[0];
  }
  return runners[0];
}

/* ------------------------------------------------------------------ */
/* Command composition                                                */
/* ------------------------------------------------------------------ */

/** Single-quote for POSIX shells; double-quote on Windows. */
export function shellQuote(value: string): string {
  if (/^[\w@%+=:,./\\-]+$/.test(value)) {
    return value;
  }
  if (!posix()) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface TestCommandOptions {
  /** File, directory, package or test id (runner-specific). */
  target?: string;
  /** Test-name pattern. */
  filter?: string;
  extraArgs?: string;
  jobs?: number;
  docTests?: boolean;
}

export interface ComposedTestCommand {
  command: string;
  notes: string[];
}

export function composeTestCommand(
  runner: DetectedTestRunner,
  opts: TestCommandOptions = {},
): ComposedTestCommand {
  const notes: string[] = [];
  const target = opts.target?.trim() ?? "";
  const filter = opts.filter?.trim() ?? "";
  const extra = opts.extraArgs?.trim() ?? "";

  if (runner.kind === "cargo") {
    const base = composeCargoActionCommand("test", {
      target,
      extraArgs: extra,
      jobs: opts.jobs,
      docTests: opts.docTests,
    }) as string;
    // libtest filters go after `--`; keep any `--` the model already supplied.
    const command = filter
      ? /\s--\s/.test(` ${base} `)
        ? `${base} ${shellQuote(filter)}`
        : `${base} -- ${shellQuote(filter)}`
      : base;
    return { command, notes };
  }

  const parts: string[] = [runner.base];
  const args: string[] = [];

  if (runner.kind === "go") {
    args.push(target ? shellQuote(target) : "./...");
    if (filter) {
      args.push("-run", shellQuote(filter));
    }
  } else if (runner.kind === "unittest") {
    if (target) {
      args.push(shellQuote(target));
    } else {
      args.push("discover", "-v");
    }
    if (filter) {
      args.push("-k", shellQuote(filter));
    }
  } else {
    if (target) {
      args.push(shellQuote(target));
    }
    if (filter) {
      if (runner.filterFlag) {
        args.push(runner.filterFlag, shellQuote(filter));
      } else {
        notes.push(
          `filter ignored: ${runner.label} has no known name-filter flag; use target or extraArgs.`,
        );
      }
    }
  }
  if (extra) {
    args.push(extra);
  }
  if (args.length && runner.argSeparator) {
    parts.push(runner.argSeparator);
  }
  parts.push(...args);
  return { command: parts.join(" "), notes };
}

/* ------------------------------------------------------------------ */
/* Output parsing                                                     */
/* ------------------------------------------------------------------ */

export interface TestFailure {
  name: string;
  file?: string;
  line?: number;
  message?: string;
}

export interface ParsedTestRun {
  framework: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  failures: TestFailure[];
  /** Compile / collection error that stopped tests from running. */
  runError?: string;
}

function num(match: RegExpMatchArray | null, group = 1): number | undefined {
  return match ? Number(match[group]) : undefined;
}

function sum(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  return defined.length ? defined.reduce((a, b) => a + b, 0) : undefined;
}

function firstLines(lines: string[], from: number, count = 3): string {
  const out: string[] = [];
  for (let i = from; i < lines.length && out.length < count; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (out.length) {
        break;
      }
      continue;
    }
    if (/^(?:---- |failures:|thread '|note: )/.test(line) && out.length) {
      break;
    }
    out.push(line);
  }
  return out.join(" ⏎ ").slice(0, 400);
}

function parseCargo(lines: string[]): ParsedTestRun | undefined {
  let passed: number | undefined;
  let failed: number | undefined;
  let skipped: number | undefined;
  let saw = false;
  for (const line of lines) {
    const m = line.match(
      /^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/,
    );
    if (m) {
      saw = true;
      passed = sum(passed, Number(m[1]));
      failed = sum(failed, Number(m[2]));
      skipped = sum(skipped, Number(m[3]));
    }
  }
  const compileFailed = lines.some((l) =>
    /^error(?:\[E\d{4}\])?: could not compile/.test(l),
  );
  if (!saw && !compileFailed) {
    return undefined;
  }
  const names = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^test\s+(\S+)\s+\.\.\.\s+FAILED\b/);
    if (m) {
      names.add(m[1]);
    }
  }
  const failures: TestFailure[] = [...names].map((name) => {
    const failure: TestFailure = { name };
    const header = lines.findIndex((l) => l.trim() === `---- ${name} stdout ----`);
    if (header >= 0) {
      for (let i = header + 1; i < Math.min(lines.length, header + 12); i++) {
        const p = lines[i].match(
          /panicked at ([^:\s]+(?::[^:\s]+)*?):(\d+):(\d+)/,
        );
        if (p) {
          failure.file = p[1];
          failure.line = Number(p[2]);
          failure.message = firstLines(lines, i + 1);
          break;
        }
      }
    }
    return failure;
  });
  return {
    framework: "cargo test",
    passed,
    failed: failed ?? failures.length,
    skipped,
    failures,
    runError: !saw && compileFailed ? "cargo could not compile the crate for testing" : undefined,
  };
}

function parseVitestLike(lines: string[]): ParsedTestRun | undefined {
  const vitestTests = lines.find((l) => /^\s*Tests\s{2,}.*\(\d+\)/.test(l));
  const jestTests = lines.find((l) => /^\s*Tests:\s+.*\btotal\b/.test(l));
  const summary = vitestTests ?? jestTests;
  if (!summary) {
    return undefined;
  }
  const framework = vitestTests ? "vitest" : "jest";
  const count = (word: string) => num(summary.match(new RegExp(`(\\d+) ${word}`)));
  const failures: TestFailure[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let name: string | undefined;
    let file: string | undefined;
    const v = line.match(/^\s*FAIL\s+(\S+?)\s+>\s+(.+?)\s*$/);
    const j = line.match(/^\s*●\s+(?!Console\b)(.+?)\s*$/);
    if (framework === "vitest" && v) {
      file = v[1];
      name = v[2];
    } else if (framework === "jest" && j) {
      name = j[1];
    }
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const failure: TestFailure = { name, file };
    for (let k = i + 1; k < Math.min(lines.length, i + 30); k++) {
      const l = lines[k];
      if (!failure.message && /(?:Error|expect\(|Expected|Received)/.test(l)) {
        failure.message = l.trim().slice(0, 300);
      }
      const at =
        l.match(/^\s*[❯>]\s+(\S+?):(\d+):(\d+)/) ??
        l.match(/\bat .*?\(?([^\s()]+\.[cm]?[jt]sx?):(\d+):(\d+)\)?/);
      if (at && !at[1].includes("node_modules")) {
        failure.file = failure.file ?? at[1];
        failure.line = Number(at[2]);
        break;
      }
    }
    failures.push(failure);
  }
  return {
    framework,
    passed: count("passed"),
    failed: count("failed") ?? failures.length,
    skipped: sum(count("skipped"), count("todo")),
    failures,
  };
}

function parseMocha(lines: string[]): ParsedTestRun | undefined {
  const passing = lines.find((l) => /^\s*\d+ passing\b/.test(l));
  const failingLine = lines.find((l) => /^\s*\d+ failing\b/.test(l));
  if (!passing && !failingLine) {
    return undefined;
  }
  const failures: TestFailure[] = [];
  const start = lines.findIndex((l) => /^\s*\d+ failing\b/.test(l));
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\s+\d+\)\s+(.+)$/);
      if (m) {
        failures.push({
          name: [m[1], lines[i + 1]?.trim().replace(/:$/, "")].filter(Boolean).join(" "),
          message: firstLines(lines, i + 2, 2),
        });
      }
    }
  }
  return {
    framework: "mocha",
    passed: num(passing?.match(/(\d+) passing/) ?? null),
    failed: num(failingLine?.match(/(\d+) failing/) ?? null) ?? 0,
    skipped: num(lines.find((l) => /\d+ pending/.test(l))?.match(/(\d+) pending/) ?? null),
    failures,
  };
}

function parseNodeTest(lines: string[]): ParsedTestRun | undefined {
  const get = (label: string) =>
    num(
      lines
        .map((l) => l.match(new RegExp(`^(?:ℹ|#)\\s+${label}\\s+(\\d+)\\s*$`)))
        .find(Boolean) ?? null,
    );
  const tests = get("tests");
  if (tests === undefined) {
    return undefined;
  }
  const names = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^\s*✖\s+(.+?)(?:\s+\([\d.]+m?s\))?\s*$/);
    if (m && !/^failing tests:?$/i.test(m[1])) {
      names.add(m[1]);
    }
    const tap = line.match(/^\s*not ok \d+ - (.+?)\s*$/);
    if (tap) {
      names.add(tap[1]);
    }
  }
  const locations = [
    ...lines.join("\n").matchAll(/test at (\S+?):(\d+):\d+/g),
  ];
  const failures: TestFailure[] = [...names].map((name, i) => ({
    name,
    ...(locations.length === names.size
      ? { file: locations[i][1].replace(/^file:\/\//, ""), line: Number(locations[i][2]) }
      : {}),
  }));
  return {
    framework: "node:test",
    passed: get("pass"),
    failed: get("fail") ?? failures.length,
    skipped: sum(get("skipped"), get("todo")),
    failures,
  };
}

function parsePytest(lines: string[]): ParsedTestRun | undefined {
  const summary = [...lines]
    .reverse()
    .find((l) =>
      /^(?:\d+ (?:failed|passed|skipped|error|errors|xfailed|xpassed|deselected)(?:,\s*)?)+.* in [\d.]+s/.test(
        l.replace(/^[=\s]+/, ""),
      ),
    );
  const noTests = lines.some((l) => /no tests ran/.test(l));
  if (!summary && !noTests) {
    return undefined;
  }
  const s = summary ?? "";
  const count = (word: string) => num(s.match(new RegExp(`(\\d+) ${word}\\b`)));
  const failures: TestFailure[] = [];
  const locations = new Map<string, number>();
  for (const line of lines) {
    const loc = line.match(/^(\S+\.py):(\d+): /);
    if (loc && !locations.has(loc[1])) {
      locations.set(loc[1], Number(loc[2]));
    }
  }
  for (const line of lines) {
    const m = line.match(/^(FAILED|ERROR)\s+(\S+?)(?:\s+-\s+(.*))?$/);
    if (m) {
      const file = m[2].split("::")[0];
      failures.push({
        name: m[2],
        file,
        line: locations.get(file),
        message: m[3]?.slice(0, 300),
      });
    }
  }
  return {
    framework: "pytest",
    passed: count("passed") ?? (noTests ? 0 : undefined),
    failed: sum(count("failed"), count("errors?")) ?? failures.length,
    skipped: count("skipped"),
    failures,
    runError: lines.some((l) => /^ERROR collecting|Interrupted: \d+ error/.test(l))
      ? "pytest could not collect tests (import / syntax error)"
      : undefined,
  };
}

function parseUnittest(lines: string[]): ParsedTestRun | undefined {
  const ran = lines.find((l) => /^Ran \d+ tests? in /.test(l));
  if (!ran) {
    return undefined;
  }
  const total = num(ran.match(/^Ran (\d+)/)) ?? 0;
  const result = lines.find((l) => /^(?:OK|FAILED)\b/.test(l)) ?? "";
  const failedN = num(result.match(/failures=(\d+)/)) ?? 0;
  const errorN = num(result.match(/errors=(\d+)/)) ?? 0;
  const skippedN = num(result.match(/skipped=(\d+)/)) ?? 0;
  const failures: TestFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(FAIL|ERROR): (\S+) \(([^)]+)\)/);
    if (m) {
      const frame = lines
        .slice(i, i + 12)
        .map((l) => l.match(/File "([^"]+)", line (\d+)/))
        .filter(Boolean)
        .pop();
      const msg = lines
        .slice(i + 1, i + 14)
        .find((l) => /^\w*(?:Error|Exception)\b|AssertionError/.test(l));
      failures.push({
        // Python <=3.10: `test_x (mod.Class)`; newer: `test_x (mod.Class.test_x)`.
        name: m[3].endsWith(`.${m[2]}`) ? m[3] : `${m[3]}.${m[2]}`,
        file: frame?.[1],
        line: frame ? Number(frame[2]) : undefined,
        message: msg?.slice(0, 300),
      });
    }
  }
  return {
    framework: "unittest",
    passed: Math.max(0, total - failedN - errorN - skippedN),
    failed: failedN + errorN,
    skipped: skippedN,
    failures,
  };
}

function parseGo(lines: string[]): ParsedTestRun | undefined {
  const pkgOk = lines.filter((l) => /^ok\s+\S+/.test(l)).length;
  const pkgFail = lines.filter((l) => /^FAIL\s+\S+/.test(l)).length;
  const noFiles = lines.filter((l) => /^\?\s+\S+\s+\[no test files\]/.test(l)).length;
  const failNames = lines.filter((l) => /^\s*--- FAIL: /.test(l));
  if (!pkgOk && !pkgFail && !failNames.length && !noFiles) {
    return undefined;
  }
  const failures: TestFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*--- FAIL: (\S+)/);
    if (m) {
      const loc = lines
        .slice(i + 1, i + 8)
        .map((l) => l.match(/^\s+(\S+_test\.go):(\d+):\s*(.*)$/))
        .find(Boolean);
      failures.push({
        name: m[1],
        file: loc?.[1],
        line: loc ? Number(loc[2]) : undefined,
        message: loc?.[3]?.slice(0, 300),
      });
    }
  }
  const buildFailed = lines.some((l) => /^FAIL\s+\S+\s+\[(?:build|setup) failed\]/.test(l));
  return {
    framework: "go test",
    // go test only lists failing tests without -v, so exact pass counts are unknown.
    passed: undefined,
    failed: failures.length || (pkgFail ? pkgFail : 0),
    skipped: undefined,
    failures,
    runError: buildFailed ? "go could not build the package for testing" : undefined,
  };
}

/** Parse any supported runner's output. Undefined when nothing recognizable. */
export function parseTestOutput(text: string): ParsedTestRun | undefined {
  if (!text) {
    return undefined;
  }
  const lines = stripAnsi(text).split(/\r?\n/);
  return (
    parseCargo(lines) ??
    parseVitestLike(lines) ??
    parseNodeTest(lines) ??
    parseMocha(lines) ??
    parsePytest(lines) ??
    parseUnittest(lines) ??
    parseGo(lines)
  );
}

export function testExitCode(text: string): number | undefined {
  const m = text.match(/\bExit:\s*(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** True when the log says tests failed, did not run, or the command failed. */
export function testsRed(text: string): boolean {
  const exit = testExitCode(text);
  if (exit !== undefined && exit !== 0) {
    return true;
  }
  const parsed = parseTestOutput(text);
  if (!parsed) {
    return false;
  }
  return (
    (parsed.failed ?? 0) > 0 ||
    Boolean(parsed.runError) ||
    (parsed.passed === 0 && (parsed.failed ?? 0) === 0)
  );
}

export const TEST_TAMPER_REMINDER =
  "Fix the code under test. Do not delete, skip (.skip / #[ignore] / t.Skip), or weaken a failing test unless the user asked to change tests.";

export function formatTestResults(
  text: string,
  detected?: DetectedTestRunner,
): string {
  const parsed = parseTestOutput(text);
  const exit = testExitCode(text);
  if (!parsed) {
    return exit === 0
      ? `Test results (${detected?.label ?? "unknown runner"}): command exited 0 but no test summary was recognized. Confirm from the log that tests actually ran.`
      : `Test results (${detected?.label ?? "unknown runner"}): no test summary recognized${exit !== undefined ? ` (exit ${exit})` : ""}. Read the log above; this may be a config, install or compile error.`;
  }
  const counts = [
    parsed.passed !== undefined ? `${parsed.passed} passed` : undefined,
    `${parsed.failed ?? 0} failed`,
    parsed.skipped ? `${parsed.skipped} skipped` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const lines = [`Test results (${parsed.framework}): ${counts}.`];
  if (parsed.runError) {
    lines.push(`Tests did not run: ${parsed.runError}. Fix that first.`);
  }
  if (parsed.passed === 0 && (parsed.failed ?? 0) === 0 && !parsed.runError) {
    lines.push("0 tests ran — this is not a pass. Check the target / filter and test discovery.");
  }
  if (parsed.failures.length) {
    lines.push("Failing tests:");
    for (const f of parsed.failures.slice(0, 30)) {
      const loc = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : "";
      lines.push(`- ${f.name}${loc}${f.message ? `\n    ${f.message}` : ""}`);
    }
    if (parsed.failures.length > 30) {
      lines.push(`- … ${parsed.failures.length - 30} more`);
    }
    lines.push(TEST_TAMPER_REMINDER);
  } else if (exit !== undefined && exit !== 0 && !parsed.runError) {
    lines.push(
      `The command exited ${exit} but no failing test was parsed; read the log above.`,
    );
  }
  return lines.join("\n");
}
