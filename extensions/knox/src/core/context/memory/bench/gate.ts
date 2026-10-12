/**
 * MC-46: self-eval gate. Dependency-free so `scripts/mc-gate.mts` can import it directly.
 * Compares a fresh memory-bench summary with `baseline.json`; any regression fails the gate.
 */
export interface GateSummary {
  recallAtK: number;
  precision: number;
  falseInjectRate: number;
  tokensMean: number;
}

export interface GateTolerances {
  /** Recall must not drop at all. */
  recall: number;
  /** Tie-breaking differs a little between platforms (see memoryBench.test.ts). */
  precision: number;
  falseInject: number;
  tokensRatio: number;
  tokensSlack: number;
  /** MC-50 absolute targets. */
  maxFalseInject: number;
  minRecall: number;
}

export const DEFAULT_GATE_TOLERANCES: GateTolerances = {
  recall: 0,
  precision: 0.1,
  falseInject: 0.05,
  tokensRatio: 1.25,
  tokensSlack: 20,
  maxFalseInject: 0.15,
  minRecall: 1,
};

export interface GateResult {
  ok: boolean;
  failures: string[];
}

export function compareToBaseline(
  current: GateSummary,
  baseline: GateSummary,
  tol: GateTolerances = DEFAULT_GATE_TOLERANCES,
): GateResult {
  const failures: string[] = [];
  const check = (bad: boolean, msg: string) => {
    if (bad) failures.push(msg);
  };
  check(current.recallAtK < baseline.recallAtK - tol.recall, `recallAtK ${current.recallAtK} < baseline ${baseline.recallAtK}`);
  check(current.precision < baseline.precision - tol.precision, `precision ${current.precision} < baseline ${baseline.precision} - ${tol.precision}`);
  check(
    current.falseInjectRate > baseline.falseInjectRate + tol.falseInject,
    `falseInjectRate ${current.falseInjectRate} > baseline ${baseline.falseInjectRate} + ${tol.falseInject}`,
  );
  const tokenCeiling = Math.ceil(baseline.tokensMean * tol.tokensRatio) + tol.tokensSlack;
  check(current.tokensMean > tokenCeiling, `tokensMean ${current.tokensMean} > ceiling ${tokenCeiling}`);
  check(current.falseInjectRate > tol.maxFalseInject, `falseInjectRate ${current.falseInjectRate} > target ${tol.maxFalseInject}`);
  check(current.recallAtK < tol.minRecall, `recallAtK ${current.recallAtK} < target ${tol.minRecall}`);
  return { ok: failures.length === 0, failures };
}
