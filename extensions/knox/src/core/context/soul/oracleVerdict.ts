/**
 * Turn the context items a mutating tool returned into one structured oracle
 * verdict (MC-13). Recipes (see `memory/recipes/README.md`) may only be built
 * from work that has a *passing* verdict, so an unknown outcome must never be
 * reported as a pass: when nothing recognisable ran, this returns undefined.
 */

import type { ContextItem } from "../../index.js";

export type SoulOracleKind = "build" | "test" | "lsp" | "user";

export interface SoulOracle {
  kind: SoulOracleKind;
  passed: boolean;
  /** Command for build/test oracles. */
  command?: string;
  /** Failure signature when known (compiler error signature). */
  signature?: string;
}

/** `oracle: <cmd> -> pass|fail ...` (see `oracleSummaryLine` / `oracleResultLine`). */
const ORACLE_LINE_RE = /^oracle:\s+(.+?)\s+->\s+(pass|fail)\b/im;

const TEST_COMMAND_RE =
  /\b(test|tests|pytest|vitest|jest|mocha|nextest|go\s+test|ctest|rspec|phpunit)\b/i;

/** Marker the host adds when LSP verification ran and found nothing wrong. */
export const LSP_CLEAN_MARKER = "Auto-verification: no diagnostics.";

export function oracleKindForCommand(command: string): "build" | "test" {
  return TEST_COMMAND_RE.test(command) ? "test" : "build";
}

function fromItem(item: ContextItem): SoulOracle | undefined {
  const content = item.content ?? "";

  if (item.name === "Oracle") {
    const match = ORACLE_LINE_RE.exec(content);
    if (match) {
      const command = match[1].trim();
      return {
        kind: oracleKindForCommand(command),
        passed: match[2].toLowerCase() === "pass",
        command,
      };
    }
    return undefined;
  }

  if (item.name === "Auto-Verification Result") {
    const clean =
      content.includes(LSP_CLEAN_MARKER) ||
      /File is now clean\./.test(content);
    return { kind: "lsp", passed: clean };
  }

  return undefined;
}

/**
 * Combine every oracle item from one tool call. Any failure wins; otherwise the
 * first pass is returned. Skipped, refused, or errored verification yields no
 * verdict (undefined), never a pass.
 */
export function deriveEditOracle(
  items: readonly ContextItem[],
): SoulOracle | undefined {
  const verdicts = items
    .map(fromItem)
    .filter((verdict): verdict is SoulOracle => verdict !== undefined);
  if (verdicts.length === 0) {
    return undefined;
  }
  return verdicts.find((verdict) => !verdict.passed) ?? verdicts[0];
}

/** Build/QEMU oracle events from `classifyOracleEvent` as a structured verdict. */
export function oracleFromBuildEvent(
  kind: string,
  signature: string,
): SoulOracle | undefined {
  if (kind === "build:pass") {
    return { kind: "build", passed: true };
  }
  if (kind === "build:fail") {
    return { kind: "build", passed: false, signature };
  }
  return undefined;
}
