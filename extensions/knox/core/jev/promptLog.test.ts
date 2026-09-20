import { describe, expect, it } from "vitest";

import { jevLogFromTurn, mergeJevPromptLog } from "./promptLog";
import type { AgentTurnJudgment } from "./turn";
import type { GuardrailResult } from "./guardrail";

describe("jev PromptLog snapshots", () => {
  it("records turn routing and merges output screens", () => {
    const judgment: AgentTurnJudgment = {
      source: "jev",
      shouldUseViewRead: true,
      route: "view_read",
      confidence: 0.9,
      reason: "Jev classified the turn as view/read",
      skillHint: "",
      guardrail: {
        source: "jev",
        side: "input",
        action: "pass",
        reason: "no hazard",
        jailbreak: 0.02,
        secretExfil: 0.01,
        offRepoAttack: 0.01,
        harm: 0.1,
      },
    };
    const log = jevLogFromTurn(judgment);
    expect(log.turn?.route).toBe("view_read");
    expect(log.guardrails?.input?.action).toBe("pass");

    const output: GuardrailResult = {
      source: "jev",
      side: "output",
      action: "block",
      reason: "secret_exfil=0.92",
      jailbreak: 0.1,
      secretExfil: 0.92,
      offRepoAttack: 0.05,
      harm: 2.6,
    };
    const merged = mergeJevPromptLog(log, {
      outputGuardrail: output,
      citations: [
        {
          source: "heuristic",
          verdict: "fabricated",
          confidence: null,
          auto: true,
          reason: "quote missing",
          path: "mm/filemap.c",
        },
      ],
    });
    expect(merged.guardrails?.output?.action).toBe("block");
    expect(merged.citations?.[0].verdict).toBe("fabricated");
  });
});
