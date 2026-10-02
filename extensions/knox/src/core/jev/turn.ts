/**
 * Per-turn Jev judgments: model route + skill hint.
 *
 * Fail-open to the existing regex / token-overlap heuristics.
 */

import {
  resolveAgentProfile,
  workspaceHintsDisagree,
  type AgentProfileSetting,
  type ResolvedAgentProfile,
  type WorkspaceProfileHints,
} from "../config/agentProfile";
import type { SkillInfo } from "../skills/types";
import {
  formatMatchedSkillsHint,
  matchSkillsByIntent,
} from "../skills/skillMatcher";
import { analyzeForViewReadModel } from "../tools/modelRouting";
import { createKnoxLogger } from "../util/knoxLog";
import { asChoice, asNoul, asScore } from "./answers";
import { isCjkHeavy } from "./cjk";
import { JevClientError, resolveJevClient } from "./client";
import { setJevConfirmedProfile, setJevUserMessage } from "./config";
import {
  composeGuardrail,
  guardrailInputQuestions,
  type GuardrailResult,
} from "./guardrail";
import { composeAutoProfile, shouldConfirmAutoProfile } from "./profileConfirm";
import {
  DIFFICULTY_ESCALATE,
  NEEDS_MUTATION_OVERRIDE,
  ROUTE_CONFIDENCE_FLOOR,
  CLARIFY_HINT,
  difficultyQuestion,
  needsMutationQuestion,
  profileQuestion,
  routeQuestion,
  type JevRouteChoice,
} from "./questions";
import { skillTurnQuestions, suggestSkill } from "./skillSuggest";
import type { JevAnswer, JevClient, JevJson, JevQuestion, JevRuntime } from "./types";

const log = createKnoxLogger("jev");

export type AgentTurnSource = "jev" | "heuristic";

export interface AgentTurnJudgment {
  source: AgentTurnSource;
  shouldUseViewRead: boolean;
  route: JevRouteChoice | "heuristic";
  confidence: number;
  reason: string;
  skillHint: string;
  skillName?: string;
  clarifyHint?: string;
  profile?: ResolvedAgentProfile;
  difficulty?: number;
  guardrail?: GuardrailResult;
}

export interface EvaluateAgentTurnInput {
  userMessage: string;
  /** Prior user/assistant turns so short follow-ups still classify correctly. */
  recentContext?: JevJson;
  skills?: SkillInfo[];
  hasViewRead: boolean;
  hasContext?: boolean;
  agentProfileSetting?: AgentProfileSetting;
  workspaceHints?: boolean | WorkspaceProfileHints;
  runtime: JevRuntime;
  client?: JevClient;
  abortSignal?: AbortSignal;
}

/**
 * Session tools: Jev `chat` / `chat_high` keep tools; `view_read` / `clarify`
 * drop them. When Jev is off (or judgment failed open to heuristics), Agent
 * tools stay on.
 */
export function jevTurnUsesAgentTools(
  jevEnabled: boolean,
  judgment: Pick<AgentTurnJudgment, "source" | "route"> | undefined,
): boolean {
  if (!jevEnabled) {
    return true;
  }
  if (judgment?.source !== "jev") {
    return true;
  }
  return judgment.route === "chat" || judgment.route === "chat_high";
}

const RECENT_CONTEXT_TURNS = 4;
const RECENT_CONTEXT_CHARS = 600;

/** Compact prior chat turns for Jev state. Empty when this is the first message. */
export function recentContextFromTurns(
  turns: Array<{ role: string; text: string }>,
): JevJson {
  return turns
    .filter((turn) => turn.text.trim())
    .slice(-RECENT_CONTEXT_TURNS)
    .map((turn) => ({
      role: turn.role,
      text: turn.text.replace(/\s+/g, " ").trim().slice(0, RECENT_CONTEXT_CHARS),
    }));
}

function heuristicProfile(
  input: EvaluateAgentTurnInput,
): ResolvedAgentProfile | undefined {
  if (input.agentProfileSetting !== "auto") {
    setJevConfirmedProfile(undefined);
    return undefined;
  }
  const profile = resolveAgentProfile("auto", input.workspaceHints ?? false);
  setJevConfirmedProfile(profile);
  return profile;
}

function heuristicJudgment(input: EvaluateAgentTurnInput): AgentTurnJudgment {
  const analysis = analyzeForViewReadModel(
    input.userMessage,
    input.hasContext ?? false,
  );
  const matches = matchSkillsByIntent(input.userMessage, input.skills ?? [], {
    limit: 3,
    minScore: 0.18,
  });
  return {
    source: "heuristic",
    shouldUseViewRead: Boolean(input.hasViewRead && analysis.shouldUseViewRead),
    route: analysis.shouldUseViewRead ? "view_read" : "chat",
    confidence: analysis.confidence,
    reason: analysis.reason,
    skillHint: formatMatchedSkillsHint(matches),
    skillName: matches[0]?.skill.name,
    profile: heuristicProfile(input),
  };
}

function composeRoute(
  answers: Record<string, JevAnswer>,
  hasViewRead: boolean,
): Pick<AgentTurnJudgment, "shouldUseViewRead" | "route" | "confidence" | "reason"> {
  const route = asChoice(answers, "route");
  const needsMutation = asNoul(answers, "needs_mutation");
  const difficulty = asScore(answers, "difficulty");
  if (!route) {
    throw new JevClientError("Jev turn is missing route");
  }

  const choice = route.choice as JevRouteChoice;
  const confidence = route.confidence;
  if (confidence < ROUTE_CONFIDENCE_FLOOR) {
    return {
      shouldUseViewRead: false,
      route: "chat",
      confidence,
      reason: `Jev route confidence ${confidence.toFixed(2)} below ${ROUTE_CONFIDENCE_FLOOR}; using chat`,
    };
  }
  if (
    (choice === "view_read" || choice === "clarify") &&
    (needsMutation?.noul ?? 0) >= NEEDS_MUTATION_OVERRIDE
  ) {
    return {
      shouldUseViewRead: false,
      route: "chat",
      confidence,
      reason: `Jev needs_mutation ${needsMutation?.noul.toFixed(2)} overrides ${choice}`,
    };
  }
  if ((difficulty?.score ?? 0) >= DIFFICULTY_ESCALATE) {
    return {
      shouldUseViewRead: false,
      route: choice === "chat_high" ? "chat_high" : "chat",
      confidence,
      reason: `Jev difficulty ${difficulty?.score.toFixed(2)} stays on chat`,
    };
  }
  if (choice === "view_read" && hasViewRead) {
    return {
      shouldUseViewRead: true,
      route: "view_read",
      confidence,
      reason: "Jev classified the turn as view/read",
    };
  }
  if (choice === "clarify") {
    return {
      shouldUseViewRead: false,
      route: "clarify",
      confidence,
      reason: "Jev asked to clarify before acting",
    };
  }
  return {
    shouldUseViewRead: false,
    route: choice === "chat_high" ? "chat_high" : "chat",
    confidence,
    reason: `Jev classified the turn as ${choice}`,
  };
}

function resolveClient(input: EvaluateAgentTurnInput): JevClient | undefined {
  return resolveJevClient(input.runtime, input.client);
}

export async function evaluateAgentTurn(
  input: EvaluateAgentTurnInput,
): Promise<AgentTurnJudgment> {
  setJevUserMessage(input.userMessage);
  const fallback = () => heuristicJudgment(input);
  const client = resolveClient(input);
  if (!input.runtime.enabled || !client) {
    if (input.runtime.enabled && !client) {
      log.warn(
        "Jev is enabled but has no Knox API key; using heuristics. Sign in with KnoxStudio or set jev.apiKey.",
      );
    }
    return fallback();
  }

  const skills = input.skills ?? [];
  const askProfile = shouldConfirmAutoProfile(
    input.agentProfileSetting,
    input.workspaceHints ?? false,
  );
  const questions: Record<string, JevQuestion> = {
    route: routeQuestion(),
    needs_mutation: needsMutationQuestion(),
    difficulty: difficultyQuestion(),
    ...skillTurnQuestions(skills),
    ...guardrailInputQuestions(),
  };
  if (askProfile) {
    questions.profile = profileQuestion();
  }

  const recentContext = input.recentContext ?? [];
  const state: JevJson = {
    user_message: input.userMessage.slice(0, 8_000),
    recent_context: recentContext,
    ...(askProfile ? { workspace_hints: (input.workspaceHints ?? {}) as JevJson } : {}),
  };

  try {
    const started = Date.now();
    const result = await client.systemOne(
      {
        model: input.runtime.model,
        state,
        questions,
      },
      { signal: input.abortSignal, timeoutMs: input.runtime.timeoutMs },
    );
    const routeAnswer = asChoice(result.answers, "route");
    if (
      isCjkHeavy(input.userMessage) &&
      (routeAnswer?.confidence ?? 0) < ROUTE_CONFIDENCE_FLOOR
    ) {
      log.info(
        `CJK turn confidence ${routeAnswer?.confidence ?? 0}; using heuristic`,
      );
      return fallback();
    }
    const routed = composeRoute(result.answers, input.hasViewRead);
    const remainingMs = Math.max(
      0,
      input.runtime.timeoutMs - (Date.now() - started),
    );
    const skill = await suggestSkill({
      answers: result.answers,
      skills,
      userMessage: input.userMessage,
      recentContext,
      client,
      runtime: input.runtime,
      abortSignal: input.abortSignal,
      timeoutMs: remainingMs,
    });
    const difficulty = asScore(result.answers, "difficulty");
    const clarifyHint = routed.route === "clarify" ? CLARIFY_HINT : undefined;
    let profile: ResolvedAgentProfile | undefined;
    if (input.agentProfileSetting === "auto") {
      const heuristic = resolveAgentProfile(
        "auto",
        input.workspaceHints ?? false,
      );
      if (askProfile) {
        const choice = asChoice(result.answers, "profile");
        profile = composeAutoProfile({
          heuristic,
          hintsDisagree: workspaceHintsDisagree(input.workspaceHints ?? false),
          choice: choice?.choice,
          confidence: choice?.confidence,
          difficulty: difficulty?.score,
        });
      } else {
        profile = heuristic;
      }
      setJevConfirmedProfile(profile);
    } else {
      setJevConfirmedProfile(undefined);
    }
    const guardrail = composeGuardrail(result.answers, "input");
    const judgment: AgentTurnJudgment = {
      source: "jev",
      ...routed,
      ...skill,
      clarifyHint,
      profile,
      difficulty: difficulty?.score,
      guardrail,
    };
    log.info(
      `turn source=jev route=${judgment.route} viewRead=${judgment.shouldUseViewRead} skill=${judgment.skillName ?? "none"} profile=${judgment.profile ?? "-"} guardrail=${guardrail.action} confidence=${judgment.confidence.toFixed(2)}`,
    );
    return judgment;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!input.runtime.failOpen) {
      throw error;
    }
    log.warn(`Jev turn failed open: ${message}`);
    return fallback();
  }
}
