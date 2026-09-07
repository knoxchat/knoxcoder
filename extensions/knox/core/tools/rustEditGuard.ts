/**
 * Rust mutating-edit guards (RL-32 / RL-34 / RL-36).
 *
 * Test-tamper is a hard reject on the rust profile unless the user asked
 * to change tests. Needless clone/Arc and bare `unsafe` are warnings.
 */

import type { ContextItem } from "..";
import {
  isRustPolicyEnabled,
  rustUserAllowsTestEdits,
} from "../context/rustPolicy";

export const TEST_TAMPER_MARKER =
  "test file change looks like verifier weakening";
export const CLONE_DENSITY_MARKER = "unjustified clone/Arc";
export const UNSAFE_SAFETY_MARKER = "unsafe without SAFETY";

const CLONE_JUSTIFY_RE = /\/\/\s*(share|owned):/i;
const ASSERT_RE = /\bassert(?:_eq|_ne|_matches)?!\s*\(/g;

export function isRustTestPath(filePath: string): boolean {
  const posix = filePath.replace(/\\/g, "/");
  const base = posix.split("/").pop() ?? posix;
  return /(^|\/)tests\//.test(posix) || /_test\.rs$/i.test(base);
}

function countAsserts(text: string): number {
  return (text.match(ASSERT_RE) ?? []).length;
}

const UNSAFE_SITE_RE = /\bunsafe\s*(?:\{|fn\b|impl\b|trait\b)/;

export function countUnsafeSites(text: string): number {
  return (text.match(/\bunsafe\s*(?:\{|fn\b|impl\b|trait\b)/g) ?? []).length;
}

export function blobTouchedUnsafe(text: string): boolean {
  return UNSAFE_SITE_RE.test(text);
}

export function looksLikeTestTamper(oldText: string, newText: string): boolean {
  if (countAsserts(oldText) > countAsserts(newText)) {
    return true;
  }
  if (/#\[ignore\]/.test(newText) && !/#\[ignore\]/.test(oldText)) {
    return true;
  }
  const addedTodo =
    /\b(?:todo|unimplemented)!\s*\(/.test(newText) &&
    !/\b(?:todo|unimplemented)!\s*\(/.test(oldText);
  if (addedTodo && countAsserts(oldText) > 0) {
    return true;
  }
  return false;
}

export function shouldGuardTestTamper(filePath: string, oldText: string, newText: string): boolean {
  if (!looksLikeTestTamper(oldText, newText)) {
    return false;
  }
  if (isRustTestPath(filePath)) {
    return true;
  }
  return /#\[cfg\s*\(\s*test\s*\)\]/.test(oldText) ||
    /#\[cfg\s*\(\s*test\s*\)\]/.test(newText);
}

const SHARE_PATTERNS: Array<[RegExp, string]> = [
  [/\.clone\s*\(/, ".clone()"],
  [/\bArc::new\s*\(/, "Arc::new"],
  [/\bMutex::new\s*\(/, "Mutex"],
  [/\bRefCell::new\s*\(/, "RefCell"],
  [/\bRc::new\s*\(/, "Rc"],
];

export function unjustifiedShareConstructs(
  oldText: string,
  newText: string,
): string[] {
  const oldLines = new Set(oldText.split("\n").map((line) => line.trim()));
  const lines = newText.split("\n");
  const hits = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (oldLines.has(line.trim())) {
      continue;
    }
    const justified =
      CLONE_JUSTIFY_RE.test(line) ||
      (i > 0 && CLONE_JUSTIFY_RE.test(lines[i - 1]));
    if (justified) {
      continue;
    }
    for (const [re, label] of SHARE_PATTERNS) {
      if (re.test(line)) {
        hits.add(label);
      }
    }
  }
  return [...hits];
}

export function missingUnsafeSafety(oldText: string, newText: string): boolean {
  if (countUnsafeSites(newText) <= countUnsafeSites(oldText)) {
    return false;
  }
  return !/\/\/\s*SAFETY:/i.test(newText);
}

export interface RustEditGuardResult {
  block?: ContextItem;
  warnings: ContextItem[];
}

export function evaluateRustEditGuard(opts: {
  filePath: string;
  oldText: string;
  newText: string;
  enabled?: boolean;
}): RustEditGuardResult {
  const enabled = opts.enabled ?? isRustPolicyEnabled();
  if (!enabled) {
    return { warnings: [] };
  }

  if (
    shouldGuardTestTamper(opts.filePath, opts.oldText, opts.newText) &&
    !rustUserAllowsTestEdits()
  ) {
    return {
      block: {
        name: "Rust test guard",
        description: "test-tamper",
        content: `Rejected edit to ${opts.filePath}: ${TEST_TAMPER_MARKER}. Do not delete assert! / assert_eq!, add #[ignore], or todo!/unimplemented! to go green. Change tests only if the user explicitly asked.`,
      },
      warnings: [],
    };
  }

  const warnings: ContextItem[] = [];
  const clones = unjustifiedShareConstructs(opts.oldText, opts.newText);
  if (clones.length) {
    warnings.push({
      name: "Rust clone density",
      description: "warning",
      content: `${CLONE_DENSITY_MARKER} in ${opts.filePath}: ${clones.join(", ")}. Add \`// share:\` or \`// owned:\` if this is intentional; prefer split borrows / mem::take.`,
    });
  }
  if (missingUnsafeSafety(opts.oldText, opts.newText)) {
    warnings.push({
      name: "Rust unsafe",
      description: "needs review",
      content: `${UNSAFE_SAFETY_MARKER} in ${opts.filePath}. Every unsafe block / fn / impl / trait needs \`// SAFETY: <invariant>\`. Do not claim soundness without miri + human review.`,
    });
  }
  return { warnings };
}
