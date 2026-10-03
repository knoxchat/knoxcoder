/**
 * K-034: pick a verification command from project files.
 *
 * Pure function over the root directory listing (and optionally the text of
 * package.json / pyproject.toml), so it is easy to test. Order matters: C/Make
 * and Cargo are handled by `detectBuildCommand`; this covers the rest.
 */

export interface OracleProbe {
  entries: string[];
  packageJson?: string;
  pyproject?: string;
}

export interface OracleChoice {
  ecosystem: "node" | "python" | "go" | "rust";
  command: string;
  reason: string;
}

export function detectOracleCommand(probe: OracleProbe): OracleChoice | undefined {
  const has = (name: string) => probe.entries.includes(name);

  if (has("Cargo.toml")) {
    return { ecosystem: "rust", command: "cargo check --workspace", reason: "Cargo.toml" };
  }
  if (has("go.mod")) {
    return { ecosystem: "go", command: "go vet ./...", reason: "go.mod" };
  }
  if (has("package.json")) {
    let scripts: Record<string, string> = {};
    try {
      scripts = JSON.parse(probe.packageJson ?? "{}").scripts ?? {};
    } catch {
      scripts = {};
    }
    if (scripts.typecheck) {
      return { ecosystem: "node", command: "npm run typecheck", reason: "package.json typecheck script" };
    }
    if (has("tsconfig.json")) {
      return { ecosystem: "node", command: "npx tsc --noEmit", reason: "tsconfig.json" };
    }
    if (scripts.lint) {
      return { ecosystem: "node", command: "npm run lint", reason: "package.json lint script" };
    }
    return undefined;
  }
  const pythonProject =
    has("pyproject.toml") || has("setup.py") || has("setup.cfg") || has("pytest.ini") || has("tox.ini");
  if (pythonProject) {
    const usesRuff = /\[tool\.ruff\b/.test(probe.pyproject ?? "") || has("ruff.toml");
    const usesPytest =
      has("pytest.ini") || /\[tool\.pytest\b/.test(probe.pyproject ?? "") || has("tests");
    if (usesPytest) {
      return { ecosystem: "python", command: "python -m pytest -x -q", reason: "pytest config or tests/" };
    }
    if (usesRuff) {
      return { ecosystem: "python", command: "ruff check .", reason: "ruff config" };
    }
    return { ecosystem: "python", command: "python -m compileall -q .", reason: "python project" };
  }
  return undefined;
}

const shellSafe = (p: string) => /^[\w@%+=:,./-]+$/.test(p);

/**
 * Narrow an auto-detected oracle to the edited file's package when that is safe.
 * Only commands that exactly equal a detected default are rewritten, so a
 * user-supplied verify command is never touched. Returns the input otherwise.
 */
export function scopeOracleCommand(command: string, filePath?: string): string {
  if (!filePath) {
    return command;
  }
  const file = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (file.startsWith("/") || file.split("/").includes("..") || !shellSafe(file)) {
    return command;
  }
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  const base = file.slice(file.lastIndexOf("/") + 1);

  if (command === "go vet ./..." && base.endsWith(".go")) {
    return dir ? `go vet ./${dir}/` : "go vet .";
  }
  if (command === "python -m pytest -x -q" && /^(test_.*|.*_test)\.py$/.test(base)) {
    return `python -m pytest -x -q ${file}`;
  }
  if (command === "ruff check ." && base.endsWith(".py")) {
    return `ruff check ${file}`;
  }
  return command;
}

/** Result line from parsed diagnostics, used when the runner gives no exit code. */
export function oracleSummaryLine(command: string, errorCount: number): string {
  return errorCount === 0
    ? `oracle: ${command} -> pass`
    : `oracle: ${command} -> fail (${errorCount} error${errorCount === 1 ? "" : "s"})`;
}

/** One structured line the agent (and UI) can parse: `oracle: <cmd> -> pass|fail (exit N)`. */
export function oracleResultLine(command: string, exitCode: number | null): string {
  const status = exitCode === 0 ? "pass" : "fail";
  return `oracle: ${command} -> ${status}${exitCode === null ? "" : ` (exit ${exitCode})`}`;
}
