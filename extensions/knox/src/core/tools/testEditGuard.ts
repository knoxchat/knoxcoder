/**
 * Non-Rust test-weakening warnings (TS/JS, Python, Go).
 *
 * Rust has a hard reject in `rustEditGuard.ts`. For other languages a rewrite
 * of a test file is often legitimate, so this only WARNS: fewer assertions,
 * fewer test cases, or a newly added skip / focus marker. The model sees it on
 * the same tool result and must justify it or fix the code instead.
 */

import type { ContextItem } from "..";

export const TEST_WEAKENING_MARKER = "test file change may weaken the tests";

const TEST_PATH_RES = [
  /(^|\/)(?:__tests__|tests?|spec|specs)\//i,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /_test\.py$/i,
  /_test\.go$/i,
];

/** Test files handled here (Rust `.rs` is covered by rustEditGuard). */
export function isNonRustTestPath(filePath: string): boolean {
  const posix = filePath.replace(/\\/g, "/");
  if (/\.rs$/i.test(posix)) {
    return false;
  }
  if (!/\.(?:[cm]?[jt]sx?|py|go|vue|svelte)$/i.test(posix)) {
    return false;
  }
  return TEST_PATH_RES.some((re) => re.test(posix));
}

const ASSERT_RES = [
  /\bexpect\s*\(/g,
  /\bassert\w*\s*[.(]/g,
  /^\s*assert\s+\S/gm,
  /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(/g,
  /\brequire\.\w+\s*\(/g,
];

const CASE_RES = [
  /\b(?:x?it|x?test)(?:\.(?:skip|only|todo|concurrent))?\s*(?:\.each\s*\([^)]*\))?\s*\(/g,
  /^\s*(?:async\s+)?def\s+test_\w+/gm,
  /^\s*func\s+Test\w+\s*\(/gm,
];

const SKIP_RES = [
  /\b(?:it|test|describe)\.(?:skip|todo)\b/g,
  /\bx(?:it|test|describe)\s*\(/g,
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/g,
  /@unittest\.skip\w*/g,
  /\bpytest\.skip\s*\(/g,
  /\bt\.Skip(?:f|Now)?\s*\(/g,
  /\b(?:it|test|describe)\.only\s*\(/g,
  /\bfit\s*\(|\bfdescribe\s*\(/g,
];

function count(text: string, res: RegExp[]): number {
  return res.reduce((sum, re) => sum + (text.match(re) ?? []).length, 0);
}

export interface TestEditFinding {
  assertsRemoved: number;
  casesRemoved: number;
  skipsAdded: number;
}

export function analyzeTestEdit(
  oldText: string,
  newText: string,
): TestEditFinding {
  return {
    assertsRemoved: Math.max(0, count(oldText, ASSERT_RES) - count(newText, ASSERT_RES)),
    casesRemoved: Math.max(0, count(oldText, CASE_RES) - count(newText, CASE_RES)),
    skipsAdded: Math.max(0, count(newText, SKIP_RES) - count(oldText, SKIP_RES)),
  };
}

/** Warnings for a non-Rust test file edit. Empty for new files and other paths. */
export function evaluateTestEditWarnings(opts: {
  filePath: string;
  oldText: string;
  newText: string;
}): ContextItem[] {
  if (!opts.oldText.trim() || !isNonRustTestPath(opts.filePath)) {
    return [];
  }
  const { assertsRemoved, casesRemoved, skipsAdded } = analyzeTestEdit(
    opts.oldText,
    opts.newText,
  );
  const reasons: string[] = [];
  if (assertsRemoved) {
    reasons.push(`${assertsRemoved} fewer assertion(s)`);
  }
  if (casesRemoved) {
    reasons.push(`${casesRemoved} fewer test case(s)`);
  }
  if (skipsAdded) {
    reasons.push(`${skipsAdded} new skip / xfail / .only marker(s)`);
  }
  if (!reasons.length) {
    return [];
  }
  return [
    {
      name: "Test guard",
      description: "warning",
      content:
        `${TEST_WEAKENING_MARKER}: ${opts.filePath} has ${reasons.join(", ")}. ` +
        "Fix the code under test instead. Only weaken a test when the user asked to change it, and say so explicitly.",
    },
  ];
}
