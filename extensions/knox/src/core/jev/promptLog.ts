/**
 * Structured Jev answers attached to PromptLog (use-case: log check results).
 */

import type { AgentTurnJudgment } from "./turn";
import type { CitationCheckResult } from "./citation";
import type { GuardrailResult } from "./guardrail";

export interface JevPromptLogTurn {
  source: "jev" | "heuristic";
  route: string;
  confidence: number;
  skill?: string;
  profile?: string;
  reason: string;
}

export interface JevPromptLogGuardrail {
  side: "input" | "output";
  action: "pass" | "warn" | "block";
  reason: string;
  jailbreak: number;
  secretExfil: number;
  offRepoAttack: number;
  harm: number;
}

export interface JevPromptLogCitation {
  verdict: string;
  path?: string;
  reason: string;
}

export interface JevPromptLog {
  turn?: JevPromptLogTurn;
  guardrails?: {
    input?: JevPromptLogGuardrail;
    output?: JevPromptLogGuardrail;
  };
  citations?: JevPromptLogCitation[];
}

function snapshotGuardrail(result: GuardrailResult): JevPromptLogGuardrail {
  return {
    side: result.side,
    action: result.action,
    reason: result.reason,
    jailbreak: result.jailbreak,
    secretExfil: result.secretExfil,
    offRepoAttack: result.offRepoAttack,
    harm: result.harm,
  };
}

export function jevLogFromTurn(
  judgment: AgentTurnJudgment | undefined,
): JevPromptLog {
  if (!judgment) {
    return {};
  }
  const log: JevPromptLog = {
    turn: {
      source: judgment.source,
      route: judgment.route,
      confidence: judgment.confidence,
      skill: judgment.skillName,
      profile: judgment.profile,
      reason: judgment.reason,
    },
  };
  if (judgment.guardrail) {
    log.guardrails = { input: snapshotGuardrail(judgment.guardrail) };
  }
  return log;
}

export function mergeJevPromptLog(
  base: JevPromptLog,
  extra: {
    outputGuardrail?: GuardrailResult;
    citations?: CitationCheckResult[];
  },
): JevPromptLog {
  const next: JevPromptLog = { ...base };
  if (extra.outputGuardrail) {
    next.guardrails = {
      ...next.guardrails,
      output: snapshotGuardrail(extra.outputGuardrail),
    };
  }
  if (extra.citations && extra.citations.length > 0) {
    next.citations = extra.citations.map((item) => ({
      verdict: item.verdict,
      path: item.path,
      reason: item.reason,
    }));
  }
  return next;
}
