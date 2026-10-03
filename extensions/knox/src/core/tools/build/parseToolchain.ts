/**
 * K-034: line parsers for non-C toolchains (tsc, Go, pytest, ruff).
 *
 * `parseBuildOutput` was shaped around gcc/rustc/make. These parsers return the
 * same `BuildDiagnostic` shape so the doom-loop signature, the build-verify
 * circuit breaker and `formatBuildDiagnostics` work for Node, Go and Python too.
 */

import type { BuildDiagnostic } from "./parseDiagnostics";

// src/a.ts(3,5): error TS2322: Type ...
const TSC_PAREN_RE =
  /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;
// src/a.ts:3:5 - error TS2322: Type ...  (tsc --pretty)
const TSC_PRETTY_RE =
  /^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.*)$/;
// ./main.go:12:3: undefined: x
const GO_RE = /^(?:\.\/)?([\w./\\-]+\.go):(\d+):(\d+):\s+(.*)$/;
// --- FAIL: TestFoo (0.00s)
const GO_TEST_FAIL_RE = /^--- FAIL:\s+(\S+)/;
// FAILED tests/test_a.py::test_x - AssertionError: ...
const PYTEST_FAILED_RE = /^(FAILED|ERROR)\s+(\S+?\.py)(?:::(\S+))?(?:\s+-\s+(.*))?$/;
// tests/test_a.py:12: AssertionError
const PYTEST_TRACE_RE = /^(\S+\.py):(\d+):\s+((?:\w+\.)*\w*(?:Error|Exception|Failed)\b.*)$/;
// path.py:3:1: E501 Line too long  (ruff concise / flake8)
const RUFF_RE = /^(\S+\.py):(\d+):(\d+):\s+([A-Z]{1,4}\d{2,4})\s+(.*)$/;
// *** Error compiling 'x.py'...
const COMPILEALL_RE = /^\*\*\*\s+Error compiling '([^']+)'/;

export function parseToolchainLine(line: string): BuildDiagnostic | null {
  const text = line.trim();
  if (!text) {
    return null;
  }

  const tsc = text.match(TSC_PAREN_RE) ?? text.match(TSC_PRETTY_RE);
  if (tsc) {
    return {
      file: tsc[1].trim(),
      line: Number(tsc[2]),
      column: Number(tsc[3]),
      kind: tsc[4] === "warning" ? "warning" : "error",
      code: tsc[5],
      message: tsc[6].trim(),
      raw: line,
    };
  }

  const ruff = text.match(RUFF_RE);
  if (ruff) {
    return {
      file: ruff[1],
      line: Number(ruff[2]),
      column: Number(ruff[3]),
      kind: "error",
      code: ruff[4],
      message: ruff[5].trim(),
      raw: line,
    };
  }

  const go = text.match(GO_RE);
  if (go) {
    return {
      file: go[1],
      line: Number(go[2]),
      column: Number(go[3]),
      kind: "error",
      message: go[4].trim(),
      raw: line,
    };
  }

  const goTest = text.match(GO_TEST_FAIL_RE);
  if (goTest) {
    return {
      kind: "error",
      code: "gotest",
      message: `--- FAIL: ${goTest[1]}`,
      raw: line,
    };
  }

  const pytest = text.match(PYTEST_FAILED_RE);
  if (pytest) {
    return {
      file: pytest[2],
      kind: "error",
      code: "pytest",
      message: [pytest[3], pytest[4]].filter(Boolean).join(" - ") || pytest[1],
      raw: line,
    };
  }

  const trace = text.match(PYTEST_TRACE_RE);
  if (trace) {
    return {
      file: trace[1],
      line: Number(trace[2]),
      kind: "error",
      code: "python",
      message: trace[3].trim(),
      raw: line,
    };
  }

  const compileall = text.match(COMPILEALL_RE);
  if (compileall) {
    return {
      file: compileall[1],
      kind: "error",
      code: "python",
      message: "failed to compile",
      raw: line,
    };
  }
  return null;
}
